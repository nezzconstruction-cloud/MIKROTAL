/**
 * Implementasi protokol RouterOS API (port 8728 / 8729 SSL).
 * Referensi: https://help.mikrotik.com/docs/display/ROS/API
 *
 * Setiap "sentence" terdiri dari beberapa "word" yang diawali panjang (length-encoded)
 * dan diakhiri word kosong (byte 0x00).
 */

export function encodeLength(len: number): Buffer {
  if (len < 0 || !Number.isInteger(len)) throw new RangeError(`Panjang word tidak valid: ${len}`);
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const v = len | 0x8000;
    return Buffer.from([(v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x200000) {
    const v = len | 0xc00000;
    return Buffer.from([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x10000000) {
    const v = (len | 0xe0000000) >>> 0;
    return Buffer.from([(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  return Buffer.from([0xf0, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

/** Mengembalikan [panjang, jumlah byte header] atau null jika buffer belum cukup. */
export function decodeLength(buf: Buffer, offset = 0): [number, number] | null {
  if (buf.length <= offset) return null;
  const c = buf[offset];
  if ((c & 0x80) === 0x00) return [c, 1];
  if ((c & 0xc0) === 0x80) {
    if (buf.length < offset + 2) return null;
    return [((c & 0x3f) << 8) | buf[offset + 1], 2];
  }
  if ((c & 0xe0) === 0xc0) {
    if (buf.length < offset + 3) return null;
    return [((c & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2], 3];
  }
  if ((c & 0xf0) === 0xe0) {
    if (buf.length < offset + 4) return null;
    return [(c & 0x0f) * 0x1000000 + (buf[offset + 1] << 16) + (buf[offset + 2] << 8) + buf[offset + 3], 4];
  }
  if (c === 0xf0) {
    if (buf.length < offset + 5) return null;
    return [buf.readUInt32BE(offset + 1), 5];
  }
  throw new Error(`Byte panjang tidak dikenal: 0x${c.toString(16)}`);
}

export function encodeSentence(words: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const w of words) {
    const b = Buffer.from(w, 'utf8');
    parts.push(encodeLength(b.length), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/** Parser inkremental: masukkan potongan data TCP, keluarkan sentence lengkap. */
export class SentenceParser {
  private buf: Buffer = Buffer.alloc(0);
  private words: string[] = [];

  push(chunk: Buffer): string[][] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const sentences: string[][] = [];
    for (;;) {
      const header = decodeLength(this.buf, 0);
      if (!header) break;
      const [len, size] = header;
      if (this.buf.length < size + len) break;
      if (len === 0) {
        sentences.push(this.words);
        this.words = [];
      } else {
        this.words.push(this.buf.subarray(size, size + len).toString('utf8'));
      }
      this.buf = this.buf.subarray(size + len);
    }
    return sentences;
  }
}

export interface ParsedReply {
  type: string;
  tag?: string;
  attrs: Record<string, string>;
}

export function parseReply(words: string[]): ParsedReply {
  const [type, ...rest] = words;
  const attrs: Record<string, string> = {};
  let tag: string | undefined;
  for (const w of rest) {
    if (w.startsWith('.tag=')) {
      tag = w.slice(5);
    } else if (w.startsWith('=')) {
      const i = w.indexOf('=', 1);
      if (i === -1) attrs[w.slice(1)] = '';
      else attrs[w.slice(1, i)] = w.slice(i + 1);
    } else {
      const i = w.indexOf('=');
      if (i > 0) attrs[w.slice(0, i)] = w.slice(i + 1);
    }
  }
  return { type, tag, attrs };
}

export type ParamValue = string | number | boolean | null | undefined;

export function formatValue(v: ParamValue): string {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (v === null || v === undefined) return '';
  return String(v);
}

export function buildWords(command: string, params: Record<string, ParamValue> = {}, queries: string[] = []): string[] {
  const words = [command];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    words.push(`=${k}=${formatValue(v)}`);
  }
  for (const q of queries) words.push(q.startsWith('?') ? q : `?${q}`);
  return words;
}

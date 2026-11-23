import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { buildWords, encodeSentence, parseReply, SentenceParser } from './protocol.js';
import {
  ConnectionError,
  RouterOSError,
  type RosParams,
  type RosRow,
  type RouterConnection,
  type RouterCredentials,
} from './types.js';

interface Pending {
  command: string;
  rows: RosRow[];
  trap?: Record<string, string>;
  resolve: (rows: RosRow[]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Klien RouterOS API native (tanpa dependensi), mendukung banyak perintah paralel via tag. */
export class RouterOSClient extends EventEmitter implements RouterConnection {
  private socket?: net.Socket;
  private parser = new SentenceParser();
  private pending = new Map<string, Pending>();
  private seq = 0;
  private _connected = false;
  private readonly timeoutMs: number;

  constructor(private readonly creds: RouterCredentials) {
    super();
    this.timeoutMs = creds.timeoutMs ?? 10000;
  }

  get connected() {
    return this._connected;
  }

  get localAddress() {
    return this.socket?.localAddress?.replace(/^::ffff:/, '');
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const { host, port } = this.creds;
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new ConnectionError(humanizeSocketError(err, host, port)));
      };
      const socket: net.Socket = this.creds.tls
        ? tls.connect({ host, port, rejectUnauthorized: false, servername: net.isIP(host) ? undefined : host })
        : net.connect({ host, port });
      socket.setNoDelay(true);
      socket.setTimeout(this.timeoutMs, () => fail(new Error('ETIMEDOUT')));
      socket.once('error', fail);
      socket.once(this.creds.tls ? 'secureConnect' : 'connect', () => {
        if (settled) return;
        settled = true;
        socket.setTimeout(0);
        socket.off('error', fail);
        socket.on('error', (e) => this.handleClose(e));
        socket.on('close', () => this.handleClose());
        socket.on('data', (d: Buffer) => this.onData(d));
        socket.setKeepAlive(true, 30000);
        this.socket = socket;
        resolve();
      });
    });

    try {
      const rows = await this.exec('/login', { name: this.creds.username, password: this.creds.password });
      const challenge = rows[0]?.ret;
      if (challenge) {
        // RouterOS lama (< 6.43) memakai challenge-response MD5
        const md5 = crypto.createHash('md5');
        md5.update(Buffer.from([0]));
        md5.update(Buffer.from(this.creds.password, 'utf8'));
        md5.update(Buffer.from(challenge, 'hex'));
        await this.exec('/login', { name: this.creds.username, response: '00' + md5.digest('hex') });
      }
      this._connected = true;
    } catch (err) {
      this.close();
      if (err instanceof RouterOSError) {
        throw new ConnectionError(`Login ditolak router: ${err.message}`);
      }
      throw err;
    }
  }

  exec(command: string, params: RosParams = {}, queries: string[] = []): Promise<RosRow[]> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new ConnectionError('Tidak terhubung ke router'));
    const tag = String(++this.seq);
    const words = [...buildWords(command, params, queries), `.tag=${tag}`];
    return new Promise<RosRow[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(tag)) return;
        this.pending.delete(tag);
        this.write(['/cancel', `=tag=${tag}`]);
        reject(new ConnectionError(`Perintah ${command} timeout setelah ${this.timeoutMs / 1000} detik`));
      }, this.timeoutMs);
      this.pending.set(tag, { command, rows: [], resolve, reject, timer });
      this.write(words);
    });
  }

  private write(words: string[]) {
    if (this.socket && !this.socket.destroyed) this.socket.write(encodeSentence(words));
  }

  private onData(chunk: Buffer) {
    let sentences: string[][];
    try {
      sentences = this.parser.push(chunk);
    } catch (err) {
      this.handleClose(err as Error);
      return;
    }
    for (const words of sentences) this.handleSentence(words);
  }

  private handleSentence(words: string[]) {
    const reply = parseReply(words);
    if (reply.type === '!fatal') {
      const msg = Object.values(reply.attrs)[0] || words.slice(1).join(' ') || 'fatal';
      this.handleClose(new ConnectionError(`Router memutus koneksi: ${msg}`));
      return;
    }
    const p = reply.tag ? this.pending.get(reply.tag) : undefined;
    if (!p) return;
    switch (reply.type) {
      case '!re':
        p.rows.push(reply.attrs);
        break;
      case '!trap':
        p.trap = reply.attrs;
        break;
      case '!empty':
        break;
      case '!done': {
        clearTimeout(p.timer);
        this.pending.delete(reply.tag!);
        if (p.trap) {
          p.reject(new RouterOSError(p.trap.message || 'Perintah gagal', p.trap.category, p.command));
        } else {
          if (p.rows.length === 0 && Object.keys(reply.attrs).length > 0) p.rows.push(reply.attrs);
          p.resolve(p.rows);
        }
        break;
      }
    }
  }

  private handleClose(err?: Error) {
    const wasOpen = this.socket !== undefined;
    this._connected = false;
    if (this.socket) {
      this.socket.removeAllListeners('data');
      this.socket.destroy();
      this.socket = undefined;
    }
    const reason = err instanceof ConnectionError ? err : new ConnectionError(err ? humanizeSocketError(err) : 'Koneksi ke router terputus');
    for (const [tag, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(reason);
      this.pending.delete(tag);
    }
    if (wasOpen) this.emit('close');
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.write(['/quit']);
      } catch {
        /* abaikan */
      }
    }
    this.handleClose();
  }
}

function humanizeSocketError(err: Error & { code?: string }, host?: string, port?: number): string {
  const where = host ? ` ${host}:${port}` : '';
  const code = err.code ?? err.message;
  switch (code) {
    case 'ECONNREFUSED':
      return `Koneksi ditolak${where}. Pastikan service API aktif (IP > Services > api/api-ssl).`;
    case 'ETIMEDOUT':
      return `Router${where} tidak merespons (timeout). Periksa IP, port, dan firewall.`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Router${where} tidak dapat dijangkau dari server.`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Nama host${where} tidak ditemukan.`;
    case 'ECONNRESET':
      return `Koneksi${where} direset oleh router.`;
    default:
      return err.message || String(err);
  }
}

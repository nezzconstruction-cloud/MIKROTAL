import net from 'node:net';

/**
 * Klien FTP minimal (mode pasif, biner) untuk mengunggah berkas ke router MikroTik.
 * Dipakai bila router tidak bisa menjangkau server MIKROTAL: arah koneksinya sama dengan API
 * (MIKROTAL → router), jadi tetap jalan di belakang NAT.
 */
export interface FtpOptions {
  host: string;
  port?: number;
  user: string;
  password: string;
  timeoutMs?: number;
}

class Control {
  private buf = '';
  private waiters: ((line: { code: number; text: string }) => void)[] = [];
  private queue: { code: number; text: string }[] = [];
  private error?: Error;
  private multi: string | null = null;

  constructor(
    private readonly socket: net.Socket,
    private readonly timeoutMs: number,
  ) {
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => this.onData(d));
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new Error('Koneksi FTP ditutup router')));
  }

  private fail(e: Error) {
    this.error ??= e;
    for (const w of this.waiters.splice(0)) w({ code: -1, text: e.message });
  }

  private onData(d: string) {
    this.buf += d;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      const m = line.match(/^(\d{3})([ -])(.*)$/);
      if (this.multi) {
        if (m && m[1] === this.multi && m[2] === ' ') {
          this.multi = null;
          this.push({ code: Number(m[1]), text: m[3] });
        }
        continue;
      }
      if (!m) continue;
      if (m[2] === '-') {
        this.multi = m[1];
        continue;
      }
      this.push({ code: Number(m[1]), text: m[3] });
    }
  }

  private push(r: { code: number; text: string }) {
    const w = this.waiters.shift();
    if (w) w(r);
    else this.queue.push(r);
  }

  read(): Promise<{ code: number; text: string }> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Router tidak menjawab FTP (timeout)')), this.timeoutMs);
      this.waiters.push((r) => {
        clearTimeout(t);
        if (r.code === -1) reject(new Error(r.text));
        else resolve(r);
      });
    });
  }

  async cmd(line: string, expect: number[]): Promise<{ code: number; text: string }> {
    this.socket.write(line + '\r\n');
    const r = await this.read();
    if (!expect.includes(r.code)) {
      const shown = line.startsWith('PASS ') ? 'PASS ***' : line;
      throw new Error(`FTP ${shown.split(' ')[0]} ditolak: ${r.code} ${r.text}`);
    }
    return r;
  }
}

function connect(host: string, port: number, timeoutMs: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => {
      s.destroy();
      reject(new Error(`Tidak bisa terhubung ke FTP ${host}:${port} (timeout)`));
    }, timeoutMs);
    s.once('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.once('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(t);
      reject(new Error(e.code === 'ECONNREFUSED' ? `FTP ${host}:${port} menolak koneksi (layanan ftp mati atau dibatasi address)` : `FTP ${host}:${port}: ${e.message}`));
    });
  });
}

export async function ftpUpload(opts: FtpOptions, files: { path: string; data: Buffer }[]) {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const socket = await connect(opts.host, opts.port ?? 21, timeoutMs);
  const c = new Control(socket, timeoutMs);
  try {
    const hello = await c.read();
    if (hello.code !== 220) throw new Error(`FTP tidak siap: ${hello.code} ${hello.text}`);
    const u = await c.cmd(`USER ${opts.user}`, [230, 331]);
    if (u.code === 331) await c.cmd(`PASS ${opts.password}`, [230]);
    await c.cmd('TYPE I', [200]);
    for (const f of files) {
      const pasv = await c.cmd('PASV', [227]);
      const m = pasv.text.match(/(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
      if (!m) throw new Error(`Jawaban PASV tidak dikenal: ${pasv.text}`);
      // pakai host kontrol, bukan IP di jawaban PASV (bisa IP lain di balik NAT)
      const data = await connect(opts.host, Number(m[5]) * 256 + Number(m[6]), timeoutMs);
      const closed = new Promise<void>((resolve, reject) => {
        data.once('close', () => resolve());
        data.once('error', reject);
      });
      await c.cmd(`STOR ${f.path}`, [125, 150]);
      data.end(f.data);
      await closed;
      const done = await c.read();
      if (done.code !== 226 && done.code !== 250) throw new Error(`Unggah ${f.path} gagal: ${done.code} ${done.text}`);
    }
    await c.cmd('QUIT', [221]).catch(() => undefined);
  } finally {
    socket.destroy();
  }
}

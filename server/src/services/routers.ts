import type { DB } from '../db/index.js';
import { RouterOSClient } from '../lib/routeros/client.js';
import { SimulatedRouter } from '../lib/routeros/simulator.js';
import { ftpUpload } from '../lib/ftp.js';
import { ConnectionError, type RosParams, type RosRow, type RouterConnection } from '../lib/routeros/types.js';
import type { SecretBox } from '../lib/security.js';

export interface RouterRecord {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password_enc: string;
  use_tls: number;
  simulate: number;
  location: string;
  wan_interface: string;
  hotspot_dns: string;
  notes: string;
  enabled: number;
  status: string;
  status_message: string;
  identity: string;
  version: string;
  board: string;
  last_seen_at: string | null;
  created_at: string;
}

export function publicRouter(r: RouterRecord) {
  const { password_enc, ...rest } = r;
  return { ...rest, use_tls: !!r.use_tls, simulate: !!r.simulate, enabled: !!r.enabled, has_password: !!password_enc };
}

export interface ConnectOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  simulate: boolean;
  key?: string;
  name?: string;
}

/** Mengelola koneksi persisten ke setiap router (satu koneksi, banyak perintah paralel). */
export class RouterManager {
  private conns = new Map<number, RouterConnection>();
  private connecting = new Map<number, Promise<RouterConnection>>();
  private lastFailure = new Map<number, { at: number; error: Error }>();

  constructor(
    private readonly db: DB,
    private readonly box: SecretBox,
    private readonly dataDir?: string,
  ) {}

  list(): RouterRecord[] {
    return this.db.all<RouterRecord>('SELECT * FROM routers ORDER BY name COLLATE NOCASE');
  }

  get(id: number): RouterRecord | undefined {
    return this.db.get<RouterRecord>('SELECT * FROM routers WHERE id = ?', [id]);
  }

  require(id: number): RouterRecord {
    const r = this.get(id);
    if (!r) throw Object.assign(new Error('Router tidak ditemukan'), { statusCode: 404 });
    return r;
  }

  createConnection(opts: ConnectOptions): RouterConnection {
    if (opts.simulate) {
      return new SimulatedRouter(opts.key ?? `${opts.host}:${opts.port}`, opts.name ?? 'MikroTik-Sim', {
        dataDir: opts.key ? this.dataDir : undefined,
        username: opts.username,
      });
    }
    return new RouterOSClient({ host: opts.host, port: opts.port, username: opts.username, password: opts.password, tls: opts.tls, timeoutMs: 10000 });
  }

  async connection(id: number): Promise<RouterConnection> {
    const existing = this.conns.get(id);
    if (existing?.connected) return existing;
    const inflight = this.connecting.get(id);
    if (inflight) return inflight;

    const p = (async () => {
      const r = this.require(id);
      const conn = this.createConnection({
        host: r.host,
        port: r.port,
        username: r.username,
        password: this.box.decrypt(r.password_enc),
        tls: !!r.use_tls,
        simulate: !!r.simulate,
        key: String(r.id),
        name: r.name,
      });
      try {
        await conn.connect();
      } catch (err) {
        this.lastFailure.set(id, { at: Date.now(), error: err as Error });
        throw err;
      }
      this.lastFailure.delete(id);
      conn.on('close', () => {
        if (this.conns.get(id) === conn) this.conns.delete(id);
      });
      this.conns.set(id, conn);
      return conn;
    })();
    this.connecting.set(id, p);
    try {
      return await p;
    } finally {
      this.connecting.delete(id);
    }
  }

  async exec(id: number, command: string, params?: RosParams, queries?: string[]): Promise<RosRow[]> {
    let conn = await this.connection(id);
    try {
      return await conn.exec(command, params, queries);
    } catch (err) {
      if (err instanceof ConnectionError && !conn.connected) {
        // satu kali coba sambung ulang
        this.disconnect(id);
        conn = await this.connection(id);
        return conn.exec(command, params, queries);
      }
      throw err;
    }
  }

  /** IP server MIKROTAL sebagaimana terlihat dari router (sisi lokal koneksi API). */
  async localAddress(id: number) {
    return (await this.connection(id)).localAddress;
  }

  /** Unggah berkas ke router lewat FTP memakai akun yang sama dengan API. */
  async uploadFiles(id: number, port: number, files: { path: string; data: Buffer }[]) {
    const r = this.require(id);
    if (r.simulate) return ((await this.connection(id)) as SimulatedRouter).ftpPut(files, port);
    return ftpUpload({ host: r.host, port, user: r.username, password: this.box.decrypt(r.password_enc), timeoutMs: 15000 }, files);
  }

  isConnected(id: number) {
    return !!this.conns.get(id)?.connected;
  }

  disconnect(id: number) {
    const c = this.conns.get(id);
    this.conns.delete(id);
    c?.close();
  }

  disconnectAll() {
    for (const id of [...this.conns.keys()]) this.disconnect(id);
  }

  async test(opts: ConnectOptions) {
    const conn = this.createConnection({ ...opts, key: opts.simulate ? `test-${opts.host}` : undefined });
    const started = Date.now();
    await conn.connect();
    try {
      const [identity] = await conn.exec('/system/identity/print');
      const [res] = await conn.exec('/system/resource/print');
      const ifaces = await conn.exec('/interface/print', { '.proplist': 'name,type,running' });
      return {
        latencyMs: Date.now() - started,
        identity: identity?.name ?? '',
        version: res?.version ?? '',
        board: res?.['board-name'] ?? '',
        uptime: res?.uptime ?? '',
        interfaces: ifaces.map((i) => ({ name: i.name, type: i.type, running: i.running === 'true' })),
      };
    } finally {
      conn.close();
    }
  }
}

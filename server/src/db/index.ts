import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from '../config.js';
import { migrations } from './migrations.js';

export type Row = Record<string, any>;
type Value = SQLInputValue | boolean | undefined;
export type Params = Record<string, Value> | Value[];

export class DB {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private normalize(params?: Params): any[] {
    if (params === undefined) return [];
    if (Array.isArray(params)) return params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
    const out: Record<string, SQLInputValue> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      out[k] = typeof v === 'boolean' ? (v ? 1 : 0) : (v as SQLInputValue);
    }
    return [out];
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    return this.raw.prepare(sql).all(...this.normalize(params)) as T[];
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    return this.raw.prepare(sql).get(...this.normalize(params)) as T | undefined;
  }

  run(sql: string, params?: Params) {
    const r = this.raw.prepare(sql).run(...this.normalize(params));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  private migrate() {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      this.transaction(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
      });
    }
  }

  close() {
    this.raw.close();
  }
}

export function openDatabase(file?: string) {
  return new DB(file ?? config.dbFile ?? path.join(config.dataDir, 'mikrotal.db'));
}

import path from 'node:path';
import fs from 'node:fs';

function loadDotEnv() {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '..', '.env')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m || line.trim().startsWith('#')) continue;
      const key = m[1];
      let value = m[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    break;
  }
}

loadDotEnv();

const env = process.env;

function bool(v: string | undefined, def: boolean) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? '0.0.0.0',
  appSecret: env.APP_SECRET ?? 'mikrotal-dev-secret-change-me-please-0000',
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  dbFile: env.DB_FILE,
  adminUsername: env.ADMIN_USERNAME ?? 'admin',
  adminPassword: env.ADMIN_PASSWORD ?? 'admin123',
  seedDemo: bool(env.SEED_DEMO, true),
  disableJobs: bool(env.DISABLE_JOBS, false),
  webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : undefined,
  logLevel: env.LOG_LEVEL ?? 'info',
  isProduction: env.NODE_ENV === 'production',
};

export type AppConfig = typeof config;

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config as defaultConfig, type AppConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/index.js';
import { ConnectionError, RouterOSError } from './lib/routeros/types.js';
import { hashPassword, SecretBox } from './lib/security.js';
import { AlertService, AuditService, Hub } from './services/alerts.js';
import { BackupService } from './services/backup.js';
import { MonitorService } from './services/monitor.js';
import { RouterManager } from './services/routers.js';
import { SettingsService } from './services/settings.js';
import { HttpError, VoucherService } from './services/vouchers.js';
import { authRoutes } from './routes/auth.js';
import { routerRoutes } from './routes/routers.js';
import { hotspotRoutes } from './routes/hotspot.js';
import { voucherRoutes } from './routes/vouchers.js';
import { businessRoutes } from './routes/business.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';

export interface BuildOptions {
  config?: Partial<AppConfig>;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const config: AppConfig = { ...defaultConfig, ...opts.config };
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  const db = openDatabase(config.dbFile ?? path.join(config.dataDir, 'mikrotal.db'));
  const box = new SecretBox(config.appSecret);
  const hub = new Hub();
  const settings = new SettingsService(db);
  const routers = new RouterManager(db, box, config.dbFile === ':memory:' ? undefined : config.dataDir);
  const alerts = new AlertService(db, settings, hub, app.log);
  const audit = new AuditService(db);
  const monitor = new MonitorService(db, routers, settings, alerts, hub, app.log);
  const vouchers = new VoucherService(db, routers, settings, hub, app.log);
  const backup = new BackupService(db, routers, settings, alerts);
  const ctx: AppContext = { config, db, box, hub, settings, routers, monitor, vouchers, alerts, audit, backup };

  seed(ctx);

  if (config.isProduction && config.appSecret === defaultConfig.appSecret && !process.env.APP_SECRET) {
    app.log.warn('APP_SECRET belum diatur! Ganti di file .env untuk keamanan produksi.');
  }

  await app.register(fastifyJwt, { secret: config.appSecret });
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyWebsocket);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue?.path?.join('.');
      return reply.status(400).send({ error: issue ? `${field ? field + ': ' : ''}${issue.message}` : 'Data tidak valid', issues: err.issues });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    if (err instanceof RouterOSError) return reply.status(400).send({ error: `Router: ${err.message}` });
    if (err instanceof ConnectionError) return reply.status(502).send({ error: err.message });
    if (err.statusCode === 429) return reply.status(429).send({ error: 'Terlalu banyak percobaan, tunggu sebentar' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({ error: 'Terjadi kesalahan pada server' });
  });

  await app.register(async (api) => {
    await publicRoutes(api, ctx);
    await authRoutes(api, ctx);
    await routerRoutes(api, ctx);
    await hotspotRoutes(api, ctx);
    await voucherRoutes(api, ctx);
    await businessRoutes(api, ctx);
    await adminRoutes(api, ctx);
  });

  // Sajikan frontend hasil build (web/dist) bila ada
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = config.webDist ?? [path.resolve(here, '../../web/dist'), path.resolve(here, '../web/dist'), path.resolve(process.cwd(), 'web/dist')].find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Endpoint tidak ditemukan' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: 'Endpoint tidak ditemukan' }));
  }

  app.addHook('onClose', async () => {
    monitor.stop();
    vouchers.stop();
    backup.stop();
    routers.disconnectAll();
    db.close();
  });

  return { app, ctx };
}

export function startJobs(ctx: AppContext) {
  ctx.monitor.start();
  ctx.vouchers.start();
  ctx.backup.start();
}

function seed(ctx: AppContext) {
  const { db, config } = ctx;
  const userCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
  if (userCount === 0) {
    db.run('INSERT INTO users (username, password_hash, name, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)', [
      config.adminUsername,
      hashPassword(config.adminPassword),
      'Administrator',
      'superadmin',
      new Date().toISOString(),
    ]);
  }
  const routerCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM routers')!.n;
  if (routerCount === 0 && config.seedDemo) {
    const now = new Date().toISOString();
    const { lastId } = db.run(
      `INSERT INTO routers (name, host, port, username, password_enc, simulate, location, wan_interface, hotspot_dns, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      ['Demo Router (Simulasi)', 'simulator.local', 8728, 'admin', ctx.box.encrypt('demo'), 'Kantor Pusat', 'ether1-WAN', 'hotspot.lan', 'Router virtual untuk mencoba aplikasi. Hapus setelah menambahkan MikroTik asli.', now],
    );
    const metas: [string, number, number, string, string][] = [
      ['1JAM', 3000, 2500, '1d', '1h'],
      ['1HARI', 5000, 4000, '1d', ''],
      ['1MINGGU', 25000, 20000, '7d', ''],
      ['1BULAN', 75000, 65000, '30d', ''],
    ];
    for (const [profile, price, rprice, validity, timeLimit] of metas) {
      db.run('INSERT INTO profile_meta (router_id, profile, price, reseller_price, validity, time_limit) VALUES (?, ?, ?, ?, ?, ?)', [lastId, profile, price, rprice, validity, timeLimit]);
    }
    db.run('INSERT INTO resellers (name, phone, balance, discount, created_at) VALUES (?, ?, ?, ?, ?)', ['Konter Pulsa Jaya', '081234567890', 250000, 15, now]);
  }
}

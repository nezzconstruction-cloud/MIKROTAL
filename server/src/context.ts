import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config.js';
import type { DB } from './db/index.js';
import { hasPermission, type Permission, type Role, type SecretBox } from './lib/security.js';
import type { AlertService, AuditService, Hub } from './services/alerts.js';
import type { BackupService } from './services/backup.js';
import type { MonitorService } from './services/monitor.js';
import type { RouterManager } from './services/routers.js';
import type { SettingsService } from './services/settings.js';
import { HttpError, type VoucherService } from './services/vouchers.js';

export interface AppContext {
  config: AppConfig;
  db: DB;
  box: SecretBox;
  hub: Hub;
  settings: SettingsService;
  routers: RouterManager;
  monitor: MonitorService;
  vouchers: VoucherService;
  alerts: AlertService;
  audit: AuditService;
  backup: BackupService;
}

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  reseller_id: number | null;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number; v?: number };
    user: AuthUser;
  }
}

export function makeAuth(ctx: AppContext) {
  return (perm?: Permission) =>
    async function authGuard(req: FastifyRequest, _reply: FastifyReply) {
      let payload: { sub: number };
      try {
        payload = await req.jwtVerify<{ sub: number }>();
      } catch {
        throw new HttpError(401, 'Sesi berakhir, silakan login kembali');
      }
      const user = ctx.db.get<AuthUser & { active: number }>(
        'SELECT id, username, name, role, reseller_id, active FROM users WHERE id = ?',
        [payload.sub],
      );
      if (!user || !user.active) throw new HttpError(401, 'Akun tidak aktif');
      req.user = { id: user.id, username: user.username, name: user.name, role: user.role, reseller_id: user.reseller_id };
      if (perm && !hasPermission(user.role, perm)) throw new HttpError(403, 'Anda tidak memiliki akses untuk tindakan ini');
    };
}

export function auditFrom(ctx: AppContext, req: FastifyRequest, action: string, target = '', detail?: unknown) {
  ctx.audit.record({ userId: req.user?.id, username: req.user?.username, action, target, detail, ip: req.ip });
}

export function idParam(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID tidak valid');
  return n;
}

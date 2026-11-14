import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFrom, idParam, makeAuth, type AppContext } from '../context.js';
import { hashPassword, permissionsFor, verifyPassword, type Role } from '../lib/security.js';
import { HttpError } from '../services/vouchers.js';

const userOut = (u: any) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role as Role,
  reseller_id: u.reseller_id,
  reseller_name: u.reseller_name ?? null,
  active: !!u.active,
  last_login_at: u.last_login_at,
  created_at: u.created_at,
  permissions: permissionsFor(u.role),
});

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = makeAuth(ctx);

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
      const u = ctx.db.get<any>('SELECT * FROM users WHERE username = ?', [body.username.trim()]);
      if (!u || !verifyPassword(body.password, u.password_hash)) {
        ctx.audit.record({ username: body.username, action: 'auth.login.failed', ip: req.ip });
        throw new HttpError(401, 'Username atau password salah');
      }
      if (!u.active) throw new HttpError(403, 'Akun dinonaktifkan');
      ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), u.id]);
      ctx.audit.record({ userId: u.id, username: u.username, action: 'auth.login', ip: req.ip });
      const token = app.jwt.sign({ sub: u.id }, { expiresIn: '7d' });
      return { token, user: userOut(u) };
    },
  );

  app.get('/api/auth/me', { preHandler: auth() }, async (req) => {
    const u = ctx.db.get<any>(
      'SELECT u.*, r.name AS reseller_name FROM users u LEFT JOIN resellers r ON r.id = u.reseller_id WHERE u.id = ?',
      [req.user.id],
    );
    return userOut(u);
  });

  app.post('/api/auth/password', { preHandler: auth() }, async (req) => {
    const body = z.object({ current: z.string().min(1), password: z.string().min(6, 'Password minimal 6 karakter') }).parse(req.body);
    const u = ctx.db.get<any>('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(body.current, u.password_hash)) throw new HttpError(400, 'Password lama salah');
    ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(body.password), u.id]);
    auditFrom(ctx, req, 'auth.password.change');
    return { ok: true };
  });

  // ---- Manajemen pengguna aplikasi ----
  const userSchema = z.object({
    username: z.string().trim().min(3, 'Username minimal 3 karakter').max(32).regex(/^[a-z0-9._-]+$/i, 'Username hanya huruf, angka, titik, minus, underscore'),
    name: z.string().trim().max(64).default(''),
    role: z.enum(['superadmin', 'admin', 'operator', 'reseller']),
    reseller_id: z.number().int().positive().nullable().optional(),
    active: z.boolean().default(true),
    password: z.string().min(6, 'Password minimal 6 karakter').optional(),
  });

  app.get('/api/users', { preHandler: auth('users.manage') }, async () => {
    return ctx.db
      .all('SELECT u.*, r.name AS reseller_name FROM users u LEFT JOIN resellers r ON r.id = u.reseller_id ORDER BY u.username')
      .map(userOut);
  });

  app.post('/api/users', { preHandler: auth('users.manage') }, async (req) => {
    const b = userSchema.parse(req.body);
    if (!b.password) throw new HttpError(400, 'Password wajib diisi');
    if (b.role === 'reseller' && !b.reseller_id) throw new HttpError(400, 'Pilih reseller untuk akun reseller');
    if (ctx.db.get('SELECT id FROM users WHERE username = ?', [b.username])) throw new HttpError(409, 'Username sudah dipakai');
    const { lastId } = ctx.db.run(
      'INSERT INTO users (username, password_hash, name, role, reseller_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [b.username, hashPassword(b.password), b.name, b.role, b.role === 'reseller' ? b.reseller_id ?? null : null, b.active, new Date().toISOString()],
    );
    auditFrom(ctx, req, 'user.create', b.username, { role: b.role });
    return userOut(ctx.db.get('SELECT * FROM users WHERE id = ?', [lastId]));
  });

  app.patch('/api/users/:id', { preHandler: auth('users.manage') }, async (req) => {
    const id = idParam((req.params as any).id);
    const b = userSchema.partial().parse(req.body);
    const u = ctx.db.get<any>('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw new HttpError(404, 'Pengguna tidak ditemukan');
    if (id === req.user.id && (b.active === false || (b.role && b.role !== 'superadmin'))) {
      throw new HttpError(400, 'Tidak bisa menonaktifkan atau menurunkan peran akun sendiri');
    }
    if (b.username && b.username.toLowerCase() !== u.username.toLowerCase() && ctx.db.get('SELECT id FROM users WHERE username = ?', [b.username])) {
      throw new HttpError(409, 'Username sudah dipakai');
    }
    const role = b.role ?? u.role;
    ctx.db.run(
      'UPDATE users SET username = ?, name = ?, role = ?, reseller_id = ?, active = ? WHERE id = ?',
      [b.username ?? u.username, b.name ?? u.name, role, role === 'reseller' ? (b.reseller_id !== undefined ? b.reseller_id : u.reseller_id) : null, b.active ?? !!u.active, id],
    );
    if (b.password) ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(b.password), id]);
    auditFrom(ctx, req, 'user.update', u.username, { ...b, password: b.password ? '***' : undefined });
    return userOut(ctx.db.get('SELECT * FROM users WHERE id = ?', [id]));
  });

  app.delete('/api/users/:id', { preHandler: auth('users.manage') }, async (req) => {
    const id = idParam((req.params as any).id);
    if (id === req.user.id) throw new HttpError(400, 'Tidak bisa menghapus akun sendiri');
    const u = ctx.db.get<any>('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw new HttpError(404, 'Pengguna tidak ditemukan');
    ctx.db.run('DELETE FROM users WHERE id = ?', [id]);
    auditFrom(ctx, req, 'user.delete', u.username);
    return { ok: true };
  });
}

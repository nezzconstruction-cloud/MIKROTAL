import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

/** Enkripsi AES-256-GCM untuk menyimpan password router di database. */
export class SecretBox {
  private key: Buffer;

  constructor(secret: string) {
    this.key = crypto.createHash('sha256').update(`mikrotal:${secret}`).digest();
  }

  encrypt(plain: string): string {
    if (!plain) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${Buffer.concat([iv, tag, enc]).toString('base64')}`;
  }

  decrypt(payload: string): string {
    if (!payload) return '';
    if (!payload.startsWith('v1:')) return payload;
    const raw = Buffer.from(payload.slice(3), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}

export type Role = 'superadmin' | 'admin' | 'operator' | 'reseller';

export const PERMISSIONS = [
  'router.view',
  'router.manage',
  'config.view',
  'config.write',
  'system.danger',
  'hotspot.view',
  'hotspot.write',
  'voucher.view',
  'voucher.write',
  'reseller.view',
  'reseller.write',
  'report.view',
  'terminal',
  'users.manage',
  'settings.manage',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMS: Record<Role, Permission[] | '*'> = {
  superadmin: '*',
  admin: [
    'router.view',
    'router.manage',
    'config.view',
    'config.write',
    'system.danger',
    'hotspot.view',
    'hotspot.write',
    'voucher.view',
    'voucher.write',
    'reseller.view',
    'reseller.write',
    'report.view',
    'terminal',
    'audit.view',
  ],
  operator: ['router.view', 'config.view', 'hotspot.view', 'hotspot.write', 'voucher.view', 'voucher.write', 'report.view'],
  reseller: ['voucher.view', 'voucher.write'],
};

export function permissionsFor(role: Role): Permission[] {
  const p = ROLE_PERMS[role];
  return p === '*' ? [...PERMISSIONS] : p;
}

export function hasPermission(role: Role, perm: Permission): boolean {
  const p = ROLE_PERMS[role];
  return p === '*' || p.includes(perm);
}

import { EventEmitter } from 'node:events';
import type { DB } from '../db/index.js';
import type { SettingsService } from './settings.js';

export type AlertLevel = 'info' | 'warning' | 'critical' | 'success';

export interface AlertRow {
  id: number;
  router_id: number | null;
  level: AlertLevel;
  type: string;
  title: string;
  message: string;
  is_read: number;
  created_at: string;
}

/** Bus event realtime untuk WebSocket (status router, trafik, alert, voucher). */
export class Hub extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
}

export async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { description?: string };
      detail = body.description ?? detail;
    } catch {
      /* abaikan */
    }
    throw new Error(`Telegram menolak pesan: ${detail}`);
  }
}

const LEVEL_ICON: Record<AlertLevel, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨', success: '✅' };

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class AlertService {
  constructor(
    private readonly db: DB,
    private readonly settings: SettingsService,
    private readonly hub: Hub,
    private readonly log: { warn: (o: unknown, msg?: string) => void } = console,
  ) {}

  create(a: { routerId?: number | null; level: AlertLevel; type: string; title: string; message?: string; notify?: boolean }) {
    const createdAt = new Date().toISOString();
    const { lastId } = this.db.run(
      'INSERT INTO alerts (router_id, level, type, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [a.routerId ?? null, a.level, a.type, a.title, a.message ?? '', createdAt],
    );
    const row = this.db.get<AlertRow>('SELECT * FROM alerts WHERE id = ?', [lastId])!;
    this.hub.emit('alert', row);
    if (a.notify !== false && a.level !== 'info') void this.notify(row);
    return row;
  }

  private async notify(row: AlertRow) {
    const s = this.settings.get();
    const tg = s.alerts.telegram;
    if (!tg.enabled || !tg.botToken || !tg.chatId) return;
    const routerName = row.router_id ? this.db.get<{ name: string }>('SELECT name FROM routers WHERE id = ?', [row.router_id])?.name : undefined;
    const text = [
      `${LEVEL_ICON[row.level]} <b>${escapeHtml(row.title)}</b>`,
      routerName ? `Router: <b>${escapeHtml(routerName)}</b>` : '',
      row.message ? escapeHtml(row.message) : '',
      `<i>${escapeHtml(s.brand.name)} • ${new Date(row.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</i>`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await sendTelegram(tg.botToken, tg.chatId, text);
    } catch (err) {
      this.log.warn({ err }, 'Gagal mengirim notifikasi Telegram');
    }
  }

  list(opts: { limit?: number; unread?: boolean; routerId?: number } = {}) {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.unread) where.push('is_read = 0');
    if (opts.routerId) {
      where.push('router_id = ?');
      params.push(opts.routerId);
    }
    params.push(Math.min(opts.limit ?? 50, 500));
    return this.db.all<AlertRow>(
      `SELECT a.*, r.name AS router_name FROM alerts a LEFT JOIN routers r ON r.id = a.router_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`,
      params,
    );
  }

  unreadCount() {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM alerts WHERE is_read = 0')!.n;
  }

  markAllRead() {
    this.db.run('UPDATE alerts SET is_read = 1 WHERE is_read = 0');
  }
}

export class AuditService {
  constructor(private readonly db: DB) {}

  record(entry: { userId?: number | null; username?: string; action: string; target?: string; detail?: unknown; ip?: string }) {
    const detail = entry.detail === undefined ? '' : typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail);
    this.db.run(
      'INSERT INTO audit_logs (user_id, username, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [entry.userId ?? null, entry.username ?? '', entry.action, entry.target ?? '', detail.slice(0, 4000), entry.ip ?? '', new Date().toISOString()],
    );
  }
}

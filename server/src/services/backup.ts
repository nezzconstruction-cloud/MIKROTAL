import type { DB } from '../db/index.js';
import type { AlertService } from './alerts.js';
import type { RouterManager } from './routers.js';
import type { SettingsService } from './settings.js';

export function localParts(date: Date, offsetMinutes: number) {
  const d = new Date(date.getTime() + offsetMinutes * 60000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

/** Backup otomatis harian (file .backup + export .rsc di router). */
export class BackupService {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DB,
    private readonly routers: RouterManager,
    private readonly settings: SettingsService,
    private readonly alerts: AlertService,
  ) {}

  start() {
    this.timer = setInterval(() => void this.tick(), 5 * 60_000);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  async tick() {
    const s = this.settings.get();
    if (!s.backup.enabled) return;
    const { date, hour } = localParts(new Date(), s.brand.timezoneOffset);
    if (hour !== s.backup.hour) return;
    const last = this.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'backup_last'")?.value;
    if (last === date) return;
    this.db.run("INSERT INTO settings (key, value) VALUES ('backup_last', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [date]);
    for (const r of this.routers.list().filter((x) => x.enabled)) {
      try {
        await this.backupRouter(r.id);
      } catch (err) {
        this.alerts.create({ routerId: r.id, level: 'warning', type: 'backup.failed', title: `Backup otomatis ${r.name} gagal`, message: (err as Error).message });
      }
    }
  }

  async backupRouter(routerId: number) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const name = `mikrotal-${stamp}`;
    await this.routers.exec(routerId, '/system/backup/save', { name, 'dont-encrypt': 'yes' });
    await this.routers.exec(routerId, '/export', { file: name }).catch(() => undefined);
    return { name };
  }
}

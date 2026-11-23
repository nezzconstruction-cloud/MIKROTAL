import { config } from '../config.js';
import { CloudHost } from './host.js';

const DEFAULT_SECRET = 'mikrotal-dev-secret-change-me-please-0000';

/** Jalankan MIKROTAL Cloud: satu server untuk halaman pendaftaran, panel admin platform, dan semua pelanggan. */
export async function startCloud() {
  if (config.isProduction) {
    const problems: string[] = [];
    if (config.appSecret === DEFAULT_SECRET || config.appSecret.length < 32) problems.push('APP_SECRET harus diisi teks acak minimal 32 karakter');
    if (config.cloud.adminPassword === 'admin123' || config.cloud.adminPassword.length < 10) problems.push('PLATFORM_ADMIN_PASSWORD harus diganti (minimal 10 karakter)');
    if (config.cloud.baseDomain === 'localhost') problems.push('CLOUD_BASE_DOMAIN harus diisi domain Anda');
    if (problems.length) {
      console.error(`MIKROTAL Cloud tidak dijalankan:\n - ${problems.join('\n - ')}`);
      process.exit(1);
    }
  }
  const host = new CloudHost({
    base: config,
    baseDomain: config.cloud.baseDomain,
    publicScheme: config.cloud.publicScheme,
    publicPort: config.cloud.publicPort ?? (config.cloud.publicScheme === 'http' ? config.port : undefined),
    platformAdminUsername: config.cloud.adminUsername,
    platformAdminPassword: config.cloud.adminPassword,
    disableJobs: config.disableJobs,
  });
  await host.init();
  await host.listen(config.port, config.host);
  host.platformApp.log.info(`MIKROTAL Cloud berjalan: ${host.publicUrl()} (pelanggan di ${host.publicUrl('<alamat>')})`);

  const shutdown = async (signal: string) => {
    host.platformApp.log.info(`Menerima ${signal}, mematikan server...`);
    await host.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

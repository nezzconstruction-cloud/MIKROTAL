import { buildApp, startJobs } from './app.js';
import { config } from './config.js';

if (config.mode === 'cloud') {
  const { startCloud } = await import('./cloud/main.js');
  await startCloud();
} else {
  const { app, ctx } = await buildApp();

  if (!config.disableJobs) startJobs(ctx);

  const shutdown = async (signal: string) => {
    app.log.info(`Menerima ${signal}, mematikan server...`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`MIKROTAL berjalan di http://localhost:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

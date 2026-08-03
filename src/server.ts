import { buildApp } from './app.js';
import { assertProductionEnv, env } from './config/env.js';

async function main(): Promise<void> {
  assertProductionEnv();

  const app = await buildApp();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info(`${signal} 수신 — 서버를 종료합니다.`);
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ port: env.port, host: env.host });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

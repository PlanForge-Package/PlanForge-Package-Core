import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildApp } from '../app.js';

/** Dumps the OpenAPI document from the route schemas to openapi/planforge-core.json. */
async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();

  const spec = app.swagger();
  const outPath = resolve(process.cwd(), 'openapi/planforge-core.json');

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

  await app.close();

  console.log(`OpenAPI 문서를 ${outPath} 에 저장했습니다.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

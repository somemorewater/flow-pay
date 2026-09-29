import { buildServer } from './server.js';
import { config } from './lib/config.js';

async function main() {
  const app = await buildServer();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

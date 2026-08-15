import { createServer } from 'vite';
import { runHarness, windowsChrome } from './chrome.mjs';

const projectRoot = new URL('../..', import.meta.url).pathname;
const server = await createServer({
  root: projectRoot,
  appType: 'mpa',
  logLevel: 'error',
  server: { host: '0.0.0.0', port: 0 },
});

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP port');
  const url = `http://localhost:${address.port}/scripts/photo-orientation-check/`;
  const report = await runHarness(url);
  const output = { harnessUrl: url, chrome: windowsChrome, ...report };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (report.pass !== true) process.exitCode = 1;
} finally {
  await server.close();
}

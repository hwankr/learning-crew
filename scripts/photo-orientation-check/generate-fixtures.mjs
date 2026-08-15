import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dumpDom, resultJson } from './chrome.mjs';

const outputDirectory = new URL('./fixtures/', import.meta.url);

const generatorHtml = String.raw`<!doctype html>
<html><body><pre id="result">{"pass":false}</pre><script>
const colors = {
  red: '#dc1e1e', green: '#14a03c', blue: '#1e46dc', yellow: '#e6be14'
};
function upright() {
  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 80;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 120, 80);
  context.fillStyle = colors.red; context.fillRect(0, 0, 30, 30);
  context.fillStyle = colors.green; context.fillRect(90, 0, 30, 30);
  context.fillStyle = colors.blue; context.fillRect(0, 50, 30, 30);
  context.fillStyle = colors.yellow; context.fillRect(90, 50, 30, 30);
  return canvas;
}
function rawPixels(orientation) {
  const source = upright();
  if (orientation === 1) return source;
  const canvas = document.createElement('canvas');
  canvas.width = 80; canvas.height = 120;
  const context = canvas.getContext('2d');
  if (orientation === 6) {
    context.translate(0, 120);
    context.rotate(-Math.PI / 2);
  } else {
    context.translate(80, 0);
    context.rotate(Math.PI / 2);
  }
  context.drawImage(source, 0, 0);
  return canvas;
}
const fixtures = {};
for (const orientation of [1, 6, 8]) {
  fixtures[orientation] = rawPixels(orientation).toDataURL('image/jpeg', 0.98).split(',')[1];
}
document.querySelector('#result').textContent = JSON.stringify({ pass: true, fixtures });
</script></body></html>`;

function addExifOrientation(jpeg, orientation) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('fixture is not a JPEG');
  const app1 = Buffer.from([
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
    0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(generatorHtml);
});

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server has no TCP port');
  const report = resultJson(await dumpDom(`http://localhost:${address.port}/`, 'fixture-generator'));
  if (report.pass !== true || typeof report.fixtures !== 'object') {
    throw new Error('fixture generator page failed');
  }
  await mkdir(outputDirectory, { recursive: true });
  for (const orientation of [1, 6, 8]) {
    const encoded = report.fixtures[String(orientation)];
    if (typeof encoded !== 'string') throw new Error(`orientation ${orientation} is missing`);
    const jpeg = addExifOrientation(Buffer.from(encoded, 'base64'), orientation);
    await writeFile(new URL(`orientation-${orientation}.jpg`, outputDirectory), jpeg);
  }
  process.stdout.write('Generated EXIF orientation fixtures 1, 6, and 8.\n');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

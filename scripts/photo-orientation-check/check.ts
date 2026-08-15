import { prepareUpload } from '../../src/lib/image';

const EXPECTED_SIZE = { w: 120, h: 80 };
const EXPECTED_MARKERS = ['red', 'green', 'blue', 'yellow'] as const;
const PALETTE = {
  red: [220, 30, 30],
  green: [20, 160, 60],
  blue: [30, 70, 220],
  yellow: [230, 190, 20],
} as const;

type Marker = (typeof EXPECTED_MARKERS)[number];

interface PixelVerdict {
  rgba: [number, number, number, number];
  marker: Marker;
}

function nearestMarker(rgba: [number, number, number, number]): Marker {
  let nearest: Marker = 'red';
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const marker of EXPECTED_MARKERS) {
    const target = PALETTE[marker];
    const distance =
      (rgba[0] - target[0]) ** 2 +
      (rgba[1] - target[1]) ** 2 +
      (rgba[2] - target[2]) ** 2;
    if (distance < nearestDistance) {
      nearest = marker;
      nearestDistance = distance;
    }
  }
  return nearest;
}

async function readMarkers(blob: Blob): Promise<PixelVerdict[]> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    const positions = [
      [0.125, 0.175],
      [0.875, 0.175],
      [0.125, 0.825],
      [0.875, 0.825],
    ] as const;
    return positions.map(([xRatio, yRatio]) => {
      const x = Math.min(canvas.width - 1, Math.round(canvas.width * xRatio));
      const y = Math.min(canvas.height - 1, Math.round(canvas.height * yRatio));
      const data = context.getImageData(x, y, 1, 1).data;
      const rgba: [number, number, number, number] = [data[0]!, data[1]!, data[2]!, data[3]!];
      return { rgba, marker: nearestMarker(rgba) };
    });
  } finally {
    bitmap.close();
  }
}

async function checkOrientation(orientation: 1 | 6 | 8) {
  const name = `orientation-${orientation}.jpg`;
  const response = await fetch(`./fixtures/${name}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const input = new File([await response.blob()], name, { type: 'image/jpeg' });
  const prepared = await prepareUpload(input);
  const markers = await readMarkers(prepared.full);
  const output = { w: prepared.w, h: prepared.h };
  const pass =
    output.w === EXPECTED_SIZE.w &&
    output.h === EXPECTED_SIZE.h &&
    markers.every((value, index) => value.marker === EXPECTED_MARKERS[index]);
  return { orientation, output, markers, pass };
}

const target = document.querySelector<HTMLPreElement>('#result');
if (!target) throw new Error('#result is missing');

try {
  const results = [];
  for (const orientation of [1, 6, 8] as const) {
    results.push(await checkOrientation(orientation));
  }
  const report = {
    pass: results.every((result) => result.pass),
    browser: navigator.userAgent,
    expected: { output: EXPECTED_SIZE, markers: EXPECTED_MARKERS },
    results,
  };
  target.textContent = JSON.stringify(report);
  document.documentElement.dataset.orientationCheck = report.pass ? 'pass' : 'fail';
} catch (error) {
  target.textContent = JSON.stringify({
    pass: false,
    browser: navigator.userAgent,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  });
  document.documentElement.dataset.orientationCheck = 'fail';
}

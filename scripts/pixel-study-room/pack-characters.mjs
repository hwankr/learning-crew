/** Offline atlas packing: extracts generated pixels, registers feet, and encodes WebP with full alpha.
 * Usage: node scripts/pixel-study-room/pack-characters.mjs member base.png actions.png walk.png
 * Requires the optional local art tool `sharp`; the application has no image-processing dependency.
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const [member, base, actions, walk] = process.argv.slice(2);
if (!['sh', 'wg', 'th', 'jj', 'kj'].includes(member) || !base || !actions || !walk) {
  throw new Error('Expected a crew ID, base atlas PNG, supplementary atlas PNG, and walking atlas PNG.');
}
const WIDTH = 192, HEIGHT = 224, BASELINE = 204, BODY_HEIGHT = 160, COLS = 6;

async function extract(path, rows) {
  const { data, info: { width, height } } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let hasTransparency = false;
  for (let p = 3; p < data.length; p += 4) if (data[p] === 0) { hasTransparency = true; break; }
  if (!hasTransparency) {
    // Some generated exports bake their neutral checker into RGB. Recover only the connected
    // exterior matte; closed outlines protect ivory shoes, eyes, notebooks and clothing highlights.
    const exterior = new Uint8Array(width * height), queue = [];
    const enqueue = (p) => {
      if (p < 0 || p >= exterior.length || exterior[p]) return;
      const i = p * 4, low = Math.min(data[i], data[i + 1], data[i + 2]);
      const high = Math.max(data[i], data[i + 1], data[i + 2]);
      if (low < 125 || high - low > 32) return;
      exterior[p] = 1; queue.push(p);
    };
    for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i], x = p % width;
      data[p * 4 + 3] = 0;
      if (x > 0) enqueue(p - 1);
      if (x < width - 1) enqueue(p + 1);
      enqueue(p - width); enqueue(p + width);
    }
    if (queue.length < width * height * .35) throw new Error(`${path}: source has no usable alpha or neutral exterior matte.`);
  }
  // A generated grid can drift. Connected silhouettes locate frames without chopping off a hand.
  const labels = new Int32Array(width * height);
  const parts = [];
  for (let seed = 0; seed < labels.length; seed++) {
    if (labels[seed] || data[seed * 4 + 3] < 80) continue;
    const id = parts.length + 1, pixels = [seed];
    labels[seed] = id;
    let left = width, right = 0, top = height, bottom = 0;
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i], x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const next of [p - 1, p + 1, p - width, p + width]) {
        if (next < 0 || next >= labels.length || Math.abs(next % width - x) > 1 || labels[next] || data[next * 4 + 3] < 80) continue;
        labels[next] = id; pixels.push(next);
      }
    }
    parts.push({ id, count: pixels.length, left, right, top, bottom });
  }
  const bodies = parts.filter((p) => p.count > 1200 && p.bottom - p.top > height / rows * .48);
  if (bodies.length !== rows * COLS) throw new Error(`${path}: found ${bodies.length} silhouettes; expected ${rows * COLS}. Inspect the source.`);
  const rowGroups = Array.from({ length: rows }, () => []);
  for (const body of bodies) rowGroups[Math.min(rows - 1, Math.floor((body.top + body.bottom) / 2 / height * rows))].push(body);
  if (rowGroups.some((row) => row.length !== COLS)) throw new Error(`${path}: uneven rows; inspect the source.`);
  const ordered = rowGroups.flatMap((row) => row.sort((a, b) => a.left - b.left));
  const owners = new Map(ordered.map((body, i) => [body.id, i]));
  for (const part of parts) {
    if (owners.has(part.id)) continue;
    let nearest = -1, distance = Infinity;
    ordered.forEach((body, i) => {
      const dx = Math.max(0, body.left - part.right, part.left - body.right);
      const dy = Math.max(0, body.top - part.bottom, part.top - body.bottom);
      const d = dx * dx + dy * dy;
      if (d < distance) { distance = d; nearest = i; }
    });
    if (distance < (height / rows * .2) ** 2) owners.set(part.id, nearest);
  }
  // One scale for a whole sheet preserves real pose height and prevents breathing size jitter.
  const canonicalHeights = ordered.slice(0, COLS).map((b) => b.bottom - b.top + 1).sort((a, b) => a - b);
  const scale = BODY_HEIGHT / canonicalHeights[3];
  const frames = [];
  for (const [index, body] of ordered.entries()) {
    const attached = parts.filter((p) => owners.get(p.id) === index);
    const left = Math.max(0, Math.min(...attached.map((p) => p.left)) - 2);
    const right = Math.min(width - 1, Math.max(...attached.map((p) => p.right)) + 2);
    const top = Math.max(0, Math.min(...attached.map((p) => p.top)) - 2);
    const bottom = Math.min(height - 1, Math.max(...attached.map((p) => p.bottom)) + 2);
    const w = right - left + 1, h = bottom - top + 1;
    const cutout = Buffer.alloc(w * h * 4);
    let anchorLeft = width, anchorRight = 0;
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const p = y * width + x;
      let owner = owners.get(labels[p]);
      // Preserve the source's partially transparent edge pixels next to the silhouette.
      if (owner === undefined && data[p * 4 + 3]) {
        for (const q of [p - 1, p + 1, p - width, p + width]) if (q >= 0 && q < labels.length && owners.get(labels[q]) === index) { owner = index; break; }
      }
      if (owner !== index) continue;
      data.copy(cutout, ((y - top) * w + x - left) * 4, p * 4, p * 4 + 4);
      const anchorBand = rows === 4 && index >= 18
        ? y > body.bottom - (body.bottom - body.top) * .08
        : y < body.top + (body.bottom - body.top) * .3;
      if (labels[p] === body.id && anchorBand) {
        anchorLeft = Math.min(anchorLeft, x); anchorRight = Math.max(anchorRight, x);
      }
    }
    const resizedWidth = Math.round(w * scale), resizedHeight = Math.round(h * scale);
    const x = Math.round(WIDTH / 2 - ((anchorLeft + anchorRight) / 2 - left) * scale);
    const y = BASELINE - Math.round((body.bottom + 1 - top) * scale);
    if (resizedWidth > WIDTH || y < 0 || y + resizedHeight > HEIGHT) {
      throw new Error(`${path}: frame ${index} would be clipped (${x}, ${y}, ${resizedWidth}, ${resizedHeight}).`);
    }
    const input = await sharp(cutout, { raw: { width: w, height: h, channels: 4 } })
      .resize(resizedWidth, resizedHeight, { kernel: 'nearest' }).png().toBuffer();
    frames.push({ input, left: index % COLS * WIDTH + x, top: Math.floor(index / COLS) * HEIGHT + y, x, width: resizedWidth });
  }
  const rowOffsets = [];
  for (let row = 0; row < rows; row++) {
    const strip = frames.slice(row * COLS, (row + 1) * COLS);
    const min = Math.max(...strip.map((frame) => -frame.x));
    const max = Math.min(...strip.map((frame) => WIDTH - frame.width - frame.x));
    if (min > max) throw new Error(`${path}: row ${row} cannot fit at a shared anchor.`);
    // Fit the complete tool/drop envelope with ONE offset for the whole loop, never jitter per frame.
    const shift = Math.max(min, Math.min(0, max));
    strip.forEach((frame) => { frame.left += shift; });
    rowOffsets.push(shift);
  }
  return { frames: frames.map(({ input, left, top }) => ({ input, left, top })), source: { width, height, scale, rowOffsets, silhouettes: bodies.length, alpha: hasTransparency ? 'source' : 'recovered exterior matte' } };
}

const main = await extract(base, 8);
const extra = await extract(actions, 4);
const gait = await extract(walk, 3);
const output = `src/assets/pixel-characters/${member}-v5.webp`;
await mkdir('src/assets/pixel-characters', { recursive: true });
await sharp({ create: { width: WIDTH * COLS, height: HEIGHT * 12, channels: 4, background: '#00000000' } })
  .composite([
    ...main.frames.filter((_, index) => index < COLS || index >= COLS * 4),
    ...gait.frames.map((frame) => ({ ...frame, top: frame.top + HEIGHT })),
    ...extra.frames.map((frame) => ({ ...frame, top: frame.top + HEIGHT * 8 })),
  ])
  .webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(output);
const report = { member, output, cell: { width: WIDTH, height: HEIGHT, baseline: BASELINE }, columns: COLS, rows: 12, frames: 72, main: main.source, extra: extra.source, gait: gait.source };
await writeFile(`scripts/pixel-study-room/${member}-atlas.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));

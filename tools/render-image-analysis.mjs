import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';

const imagePaths = [];
for (let index = 2; index < process.argv.length; index += 1) {
  imagePaths.push(process.argv[index]);
}
if (!imagePaths.length) {
  console.error('Usage: node tools/render-image-analysis.mjs <image-path> [<image-path> ...]');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(tmpdir(), 'magia-path-overlays');
await mkdir(outputDirectory, { recursive: true });
const source = await readFile(resolve(here, '../image-analysis-core.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'image-analysis-core.js' });
const { detectClosedPathsJs } = context.ImageAnalysisCore;
const decoder = resolve(here, 'decode-jpeg.ps1');

for (const imagePath of imagePaths) {
  const decoded = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', decoder, '-InputPath', resolve(imagePath)], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (decoded.status !== 0 || decoded.stdout.length < 8) {
    console.error(decoded.stderr?.toString() || `JPEG decode failed: ${imagePath}`);
    process.exitCode = decoded.status || 1;
    continue;
  }

  const payload = decoded.stdout;
  const width = payload.readInt32LE(0);
  const height = payload.readInt32LE(4);
  const bgra = payload.subarray(8);
  if (bgra.length !== width * height * 4) {
    console.error(`Unexpected BGRA payload length: ${imagePath}`);
    process.exitCode = 1;
    continue;
  }
  const rgba = Buffer.alloc(bgra.length);
  for (let index = 0; index < bgra.length; index += 4) {
    rgba[index] = bgra[index + 2];
    rgba[index + 1] = bgra[index + 1];
    rgba[index + 2] = bgra[index];
    rgba[index + 3] = 255;
  }

  const paths = detectClosedPathsJs(rgba, width, height);
  const polyline = (path, color) => {
    if (!path) return '';
    const points = path.radii.map((radius, index) => {
      const theta = index / path.radii.length * Math.PI * 2;
      const x = path.x + Math.cos(theta) * radius;
      const y = path.y + Math.sin(theta) * radius;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
  };
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${polyline(paths.outer, '#00a6ff')}${polyline(paths.inner, '#f02e75')}</svg>`);
  const outputPath = resolve(outputDirectory, `${basename(imagePath).replace(/\.[^.]+$/, '')}-paths.png`);
  await sharp(rgba, { raw: { width, height, channels: 4 } }).composite([{ input: svg }]).png().toFile(outputPath);
  console.log(JSON.stringify({
    input: resolve(imagePath),
    output: outputPath,
    outer: paths.outer && { x: paths.outer.x, y: paths.outer.y, r: paths.outer.r, coverage: paths.outer.coverage },
    inner: paths.inner && { x: paths.inner.x, y: paths.inner.y, r: paths.inner.r, coverage: paths.inner.coverage },
  }));
}

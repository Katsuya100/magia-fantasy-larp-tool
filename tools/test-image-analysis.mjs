import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const imagePaths = process.argv.slice(2);
if (!imagePaths.length) {
  console.error('Usage: npm run test:image-analysis -- <image-path> [<image-path> ...]');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const analysisCoreSource = await readFile(resolve(here, '../image-analysis-core.js'), 'utf8');
const analysisContext = vm.createContext({});
vm.runInContext(analysisCoreSource, analysisContext, { filename: 'image-analysis-core.js' });
const { analyzeSigilMetricsJs, detectCirclesJs } = analysisContext.ImageAnalysisCore;
const decoder = resolve(here, 'decode-jpeg.ps1');
const expectedShapes = { attack: 'attack', defense: 'defense', guard: 'defense', support: 'support', debuff: 'debuff' };

for (const imagePath of imagePaths) {
  const decoded = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', decoder, '-InputPath', resolve(imagePath)], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (decoded.status !== 0) {
    console.error(decoded.stderr?.toString() || `JPEG decode failed: ${imagePath}`);
    process.exitCode = decoded.status || 1;
    continue;
  }

  const payload = decoded.stdout;
  if (payload.length < 8) {
    console.error(`JPEG decoder returned no pixel data: ${imagePath}`);
    process.exitCode = 1;
    continue;
  }
  const width = payload.readInt32LE(0);
  const height = payload.readInt32LE(4);
  const bgra = payload.subarray(8);
  if (bgra.length !== width * height * 4) {
    console.error(`Unexpected BGRA payload length: ${bgra.length}`);
    process.exitCode = 1;
    continue;
  }
  const rgba = Buffer.alloc(bgra.length);
  for (let index = 0; index < bgra.length; index += 4) {
    rgba[index] = bgra[index + 2];
    rgba[index + 1] = bgra[index + 1];
    rgba[index + 2] = bgra[index];
    rgba[index + 3] = bgra[index + 3];
  }

  const circle = detectCirclesJs(rgba, width, height);
  const metrics = analyzeSigilMetricsJs(rgba, width, height, circle);
  const shape = metrics.scores;
  const shapeTotal = Object.values(shape).reduce((sum, value) => sum + value, 0);
  const [top, second] = Object.entries(shape).sort((a, b) => b[1] - a[1]);
  const resonance = Math.min(1, (top[1] - second[1]) / .12);
  const stem = basename(imagePath).replace(/\.[^.]+$/, '').toLowerCase();
  const expected = expectedShapes[stem.split('_').at(-1)];
  const geometryPass = circle.outer.r > circle.inner.r && top && Math.abs(shapeTotal - 1) < 0.001 && Number.isFinite(metrics.lineStraightness);
  const calibrationPass = !expected || (top[0] === expected && resonance >= .5);
  const assertion = geometryPass && calibrationPass ? 'PASS' : 'FAIL';
  const summarizePath = path => path && ({
    x: path.x,
    y: path.y,
    r: path.r,
    coverage: path.coverage,
    radialRange: [Math.min(...path.radii.filter(radius => radius > 0)), Math.max(...path.radii)],
  });

  console.log(JSON.stringify({
    input: resolve(imagePath),
    decoded: { width, height },
    paths: { outer: summarizePath(circle.outer), inner: summarizePath(circle.inner) },
    shape,
    features: metrics.features,
    lineStraightness: metrics.lineStraightness,
    topShape: top?.[0],
    ...(expected ? { expectedShape: expected, resonance: Math.round(resonance * 100) } : {}),
  }, null, 2));
  console.log(`ASSERT image_analysis=${assertion}`);
  if (assertion !== 'PASS') process.exitCode = 1;
}

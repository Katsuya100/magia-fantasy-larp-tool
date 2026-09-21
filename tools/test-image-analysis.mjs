import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: npm run test:image-analysis -- <image-path>');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const analysisCoreSource = await readFile(resolve(here, '../image-analysis-core.js'), 'utf8');
const analysisContext = vm.createContext({});
vm.runInContext(analysisCoreSource, analysisContext, { filename: 'image-analysis-core.js' });
const { analyzeSigilJs, detectCirclesJs } = analysisContext.ImageAnalysisCore;
const decoder = resolve(here, 'decode-jpeg.ps1');
const decoded = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', decoder, '-InputPath', resolve(imagePath)], {
  encoding: null,
  maxBuffer: 64 * 1024 * 1024,
});
if (decoded.status !== 0) {
  console.error(decoded.stderr?.toString() || 'JPEG decode failed');
  process.exit(decoded.status || 1);
}

const payload = decoded.stdout;
if (payload.length < 8) {
  console.error('JPEG decoder returned no pixel data');
  process.exit(1);
}
const width = payload.readInt32LE(0);
const height = payload.readInt32LE(4);
const bgra = payload.subarray(8);
if (bgra.length !== width * height * 4) {
  console.error(`Unexpected BGRA payload length: ${bgra.length}`);
  process.exit(1);
}
const rgba = Buffer.alloc(bgra.length);
for (let i = 0; i < bgra.length; i += 4) {
  rgba[i] = bgra[i + 2];
  rgba[i + 1] = bgra[i + 1];
  rgba[i + 2] = bgra[i];
  rgba[i + 3] = bgra[i + 3];
}

const image = { data: rgba, width, height };
const circle = detectCirclesJs(rgba, width, height);
const shape = analyzeSigilJs(rgba, width, height, circle);
const shapeTotal = Object.values(shape).reduce((sum, value) => sum + value, 0);
const shapeTop = Object.entries(shape).sort((a, b) => b[1] - a[1])[0];

if (!(circle.outer.r > circle.inner.r && shapeTop && Math.abs(shapeTotal - 1) < 0.001)) {
  console.error('ASSERT image_analysis=FAIL');
  process.exit(1);
}

console.log(JSON.stringify({
  input: resolve(imagePath),
  decoded: { width: image.width, height: image.height },
  circle: {
    outer: circle.outer,
    inner: circle.inner,
    confidence: circle.confidence,
  },
  shape,
  topShape: shapeTop[0],
}, null, 2));
console.log('ASSERT image_analysis=PASS');

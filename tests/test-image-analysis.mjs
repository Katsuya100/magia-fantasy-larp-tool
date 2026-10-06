import sharp from 'sharp';
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
const analysisCoreSource = await readFile(resolve(here, '../assets/js/image-analysis-core.js'), 'utf8');
const analysisContext = vm.createContext({});
vm.runInContext(analysisCoreSource, analysisContext, { filename: 'image-analysis-core.js' });
const { analyzeSigilMetricsJs, detectCirclesJs } = analysisContext.ImageAnalysisCore;
const expectedShapes = { attack: 'attack', defense: 'defense', guard: 'defense', support: 'support', debuff: 'debuff' };

for (const imagePath of imagePaths) {
  const decoded = await sharp(resolve(imagePath)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height} = decoded.info;
  const rgba = decoded.data;

  const circle = detectCirclesJs(rgba, width, height);
  const metrics = analyzeSigilMetricsJs(rgba, width, height, circle);
  const shape = metrics.scores;
  const shapeTotal = Object.values(shape).reduce((sum, value) => sum + value, 0);
  const [top, second] = Object.entries(shape).sort((a, b) => b[1] - a[1]);
  const resonance = Math.min(1, (top[1] - second[1]) / .12);
  const stem = basename(imagePath).replace(/\.[^.]+$/, '').toLowerCase();
  const expected = expectedShapes[stem.split('_').at(-1)];
  const geometryPass = circle.outer.r > circle.inner.r && top && Math.abs(shapeTotal - 1) < 0.001 && Number.isFinite(metrics.lineStraightness);
  const calibrationPass = !expected || (top[0] === expected && top[1] >= .4);
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
    ...(top ? { topPercentage: Math.round(top[1] * 1000) / 10 } : {}),
    ...(expected ? { expectedShape: expected, resonance: Math.round(resonance * 100) } : {}),
  }, null, 2));
  console.log(`ASSERT image_analysis=${assertion}`);
  if (assertion !== 'PASS') process.exitCode = 1;
}

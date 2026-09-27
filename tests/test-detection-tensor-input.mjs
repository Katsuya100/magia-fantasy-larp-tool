import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, '../assets/js/image-analysis-core.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'image-analysis-core.js' });
const { resizeRgbaSharpContain, resizeRgbaSharpContainInto, resizeRgbaSharpContainToPlanarFloat32 } = context.ImageAnalysisCore;
const dimensions = [
  [32, 32],
  [33, 32],
  [33, 35],
  [70, 37],
  [59, 64],
  [127, 93],
];

for (const [width, height] of dimensions) {
  const targetWidth = Math.max(32, Math.ceil(width / 32) * 32);
  const targetHeight = Math.max(32, Math.ceil(height / 32) * 32);
  const pixels = width * height;
  const sourcePixels = new Uint8ClampedArray(pixels * 4);
  for (let index = 0; index < pixels; index += 1) {
    sourcePixels[index * 4] = (index * 37 + 3) % 256;
    sourcePixels[index * 4 + 1] = (index * 71 + 19) % 256;
    sourcePixels[index * 4 + 2] = (index * 113 + 47) % 256;
    sourcePixels[index * 4 + 3] = (index * 29 + 91) % 256;
  }

  const previousRgba = resizeRgbaSharpContain(sourcePixels, width, height, targetWidth, targetHeight);
  const directTensor = resizeRgbaSharpContainToPlanarFloat32(sourcePixels, width, height, targetWidth, targetHeight);
  const outputPixels = targetWidth * targetHeight;
  const directRgba = new Uint8Array(outputPixels * 4);
  resizeRgbaSharpContainInto(sourcePixels, width, height, targetWidth, targetHeight, directRgba);
  assert.deepEqual(Array.from(directRgba), Array.from(previousRgba), `RGBA crop source for ${width}x${height}`);
  assert.equal(directTensor.length, outputPixels * 3);
  for (let index = 0; index < outputPixels; index += 1) {
    assert.equal(directTensor[index], Math.fround(previousRgba[index * 4 + 2] / 255), `B pixel ${index} for ${width}x${height}`);
    assert.equal(directTensor[outputPixels + index], Math.fround(previousRgba[index * 4 + 1] / 255), `G pixel ${index} for ${width}x${height}`);
    assert.equal(directTensor[outputPixels * 2 + index], Math.fround(previousRgba[index * 4] / 255), `R pixel ${index} for ${width}x${height}`);
  }
}

console.log('PASS detector tensor bytes match the existing RGBA resize, BGR order, and black padding');

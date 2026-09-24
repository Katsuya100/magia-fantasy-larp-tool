import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const imagePaths = process.argv.slice(2);
if (!imagePaths.length) {
  console.error('Usage: node scripts/render-image-analysis.mjs <image-path> [<image-path> ...]');
  process.exit(2);
}

const commonBatch = fileURLToPath(new URL('../tests/test-image-outputs.mjs', import.meta.url));
for (const imagePath of imagePaths) {
  const result = spawnSync(process.execPath, ['--use-system-ca', commonBatch, '--render-paths', '--paths-only', resolve(imagePath)], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `Image analysis failed: ${imagePath}`);
    process.exitCode = result.status || 1;
    continue;
  }

  const output = JSON.parse(result.stdout);
  console.log(JSON.stringify({
    input: output.input,
    output: output.pathOverlay,
    outer: output.circle.outer,
    inner: output.circle.inner,
  }));
}

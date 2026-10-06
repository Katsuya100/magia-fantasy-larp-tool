import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Explicit maintenance task: this is not part of npm test or ordinary CI.
const manifest = JSON.parse(await readFile(new URL('../assets/data/external-assets.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--models')) throw new Error('Usage: node scripts/verify-external-assets.mjs [--models]');
for (const asset of manifest.assets.filter(asset => asset.kind !== 'model' || args.includes('--models'))) {
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`${asset.id}: HTTP ${response.status}`);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) {
    throw new Error(`${asset.id}: upstream bytes differ from the reviewed manifest`);
  }
  console.log(`PASS ${asset.id} (${bytes} bytes)`);
}

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Explicitly separated from the model-downloading image/Worker E2E suite.
const tests = [
  'power-calculation', 'attribute-scoring', 'image-pipeline', 'model-cache', 'model-file-cache',
  'detection-tensor-input', 'sigil-classification', 'analysis-diagnostics',
  'structure-worker-handshake', 'ocr-line-materialization', 'ocr-worker-client',
  'ocr-resource-tracker', 'magia-circle-results', 'runtime-dependencies', 'kotodama-vectors',
  'kotodama-input-vectors', 'kotodama-data', 'kotodama-scoring', 'kotodama-lexicon', 'kotodama-app', 'ocr-vocabulary-index', 'dungeon-core', 'dungeon-progression-simulation', 'dungeon-level-design', 'dungeon-consumable-design', 'dungeon-decade-bonus', 'dungeon-ranks', 'dungeon-ranks-ui', 'dungeon-special-items-ui', 'dungeon-progress', 'dungeon-store', 'dungeon-list-view', 'dungeon-effects', 'dungeon-circle-order', 'dungeon-loadout', 'dungeon-combat-fx', 'dungeon-magic-knowledge', 'dungeon-upgrades', 'dungeon-magic-thumbnails', 'dungeon-image-urls', 'dungeon-battle-thumbnails', 'dungeon-battle-overlap', 'dungeon-presentation', 'dungeon-ui', 'dungeon-escape', 'dungeon-ui-upgrade',
];
const root = fileURLToPath(new URL('../', import.meta.url));
for(const test of tests){
  console.log(`\nTesting ${test}`);
  const result = spawnSync(process.execPath, [`tests/test-${test}.mjs`], {cwd:root, stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status !== 0) process.exit(result.status || 1);
}
console.log(`\nPASS ${tests.length} offline test suites`);

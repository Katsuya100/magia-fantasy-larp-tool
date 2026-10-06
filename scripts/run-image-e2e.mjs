import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const root=fileURLToPath(new URL('../',import.meta.url));
const image='assets/images/sample.png';
await mkdir(new URL('../test-results/review/',import.meta.url),{recursive:true});
const commands=[
  ['tests/test-image-outputs.mjs',image],
  ['tests/test-spell-ocr.mjs',image],
  ['tests/test-ocr-worker-lifecycle.mjs','--image',image,'--iterations','2','--output','test-results/review/worker-lifecycle.json'],
  ['tests/test-analysis-worker-pipeline.mjs',image,'--iterations','2'],
  ['tests/test-detection-stress.mjs','--image',image,'--iterations','2'],
  ['tests/test-image-analysis.mjs',image],
];
for(const [index,command] of commands.entries()){
  console.log(`\nRunning ${command.join(' ')}`);
  const result=spawnSync(process.execPath,[...process.execArgv,...command],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
  if(result.stdout) console.log(result.stdout);
  if(result.stderr) console.error(result.stderr);
  await writeFile(new URL(`../test-results/review/e2e-${index}.log`,import.meta.url),(result.stdout || '')+(result.stderr || ''));
  if(result.error) throw result.error;
  if(result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS image, OCR, actual Worker lifecycle/pipeline, detection stress and geometry suites');

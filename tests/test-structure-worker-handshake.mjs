import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({ URL, console, setTimeout, clearTimeout });
context.self = context;
context.location = { href: 'https://example.test/assets/js/image-analysis-worker.js' };
context.importScripts = (...urls) => { context.importedScripts = urls; };
const messages = [];
context.postMessage = message => messages.push(message);
const diagnosticsSource = await readFile(new URL('../assets/js/analysis-diagnostics.js', import.meta.url), 'utf8');
vm.runInContext(diagnosticsSource, context, { filename: 'analysis-diagnostics.js' });
context.MagiaImagePipeline = {
  analyzeStructure(buffer, width, height) {
    assert.equal(buffer.byteLength, width * height * 4);
    return { analysisWidth: width, analysisHeight: height, paths: null };
  },
};
const workerSource = await readFile(new URL('../assets/js/image-analysis-worker.js', import.meta.url), 'utf8');
vm.runInContext(workerSource, context, { filename: 'image-analysis-worker.js' });

const startupStages = messages.filter(message => message.type === 'diagnostic-stage').map(message => message.stage);
assert.deepEqual(startupStages, [
  'structure-worker-script-start',
  'structure-runtime-import-start',
  'structure-runtime-import-done',
  'structure-worker-ready',
], 'The Worker should announce ready only after its runtime imports complete.');
assert.ok(context.importedScripts.length > 0, 'The Worker must load its dependencies before announcing ready.');

context.onmessage({ data: { jobId: 7, runId: 'handshake-test', width: 2, height: 2, buffer: new ArrayBuffer(16) } });
const runStages = messages.filter(message => message.type === 'diagnostic-stage' && message.jobId === 7).map(message => message.stage);
assert.deepEqual(runStages, [
  'structure-worker-message-received',
  'structure-worker-run-start',
  'structure-worker-run-done',
], 'Worker delivery must be recorded before analysis starts and completes.');
assert.ok(messages.some(message => message.type === 'success' && message.jobId === 7));

const appSource = await readFile(new URL('../assets/js/magia-circle-app.js', import.meta.url), 'utf8');
const readyWait = appSource.indexOf('await awaitForAnalysisJob(job, pending.ready)');
const transferStart = appSource.indexOf("recordAnalysisStage(job, 'structure-input-transfer-start'", readyWait);
const postMessage = appSource.indexOf('worker.postMessage({', transferStart);
const transferDone = appSource.indexOf("recordAnalysisStage(job, 'structure-input-transfer-done'", postMessage);
assert.ok(readyWait >= 0 && transferStart > readyWait && postMessage > transferStart && transferDone > postMessage,
  'Main Thread must wait for ready, record transfer-start, post the transferable, and then record transfer-done.');
assert.match(appSource, /message\.stage === 'structure-worker-ready'\) pending\.resolveReady\?\.\(\)/,
  'The ready diagnostic event must release the Main Thread transfer wait.');

console.log('PASS_STRUCTURE_WORKER_READY_TRANSFER_DELIVERY_ORDER');

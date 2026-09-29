self.postMessage({ type: 'diagnostic-stage', stage: 'structure-worker-script-start', details: { scope: 'structure' } });
self.postMessage({ type: 'diagnostic-stage', stage: 'structure-runtime-import-start', details: { scope: 'structure' } });
importScripts(
  new URL('analysis-diagnostics.js', self.location.href).href,
  new URL('spell-ocr.js', self.location.href).href,
  new URL('image-analysis-core.js', self.location.href).href,
  new URL('attribute-scoring.js', self.location.href).href,
  new URL('power-calculation.js', self.location.href).href,
  new URL('ocr-error-policy.js', self.location.href).href,
  new URL('magia-image-pipeline.js', self.location.href).href,
);

const diagnosticReporter = self.MagiaAnalysisDiagnostics.createReporter('structure', message => {
  self.postMessage({ jobId: self.activeDiagnosticJobId, ...message });
});

diagnosticReporter.stage('structure-runtime-import-done');

self.onmessage = event => {
  const { jobId, runId, width, height, buffer } = event.data;
  self.activeDiagnosticJobId = jobId;
  diagnosticReporter.begin(runId, { sourceWidth: width, sourceHeight: height });
  try {
    diagnosticReporter.stage('structure-worker-message-received', { width, height, estimatedBytes: buffer?.byteLength || width * height * 4 });
    diagnosticReporter.stage('structure-worker-run-start', { width, height, estimatedBytes: buffer?.byteLength || width * height * 4 });
    self.postMessage({ jobId, type: 'progress', stage: '画像処理の眼を軽く整えています…' });
    const structure = self.MagiaImagePipeline.analyzeStructure(buffer, width, height);
    diagnosticReporter.stage('structure-worker-run-done', { width, height });
    self.postMessage({ jobId, type: 'progress', stage: '閉じた線のパスを読み取っています…' });
    self.postMessage({ jobId, type: 'success', ...structure });
  } catch (error) {
    self.postMessage({ jobId, type: 'error', message: error?.message || String(error) });
  }
};

diagnosticReporter.stage('structure-worker-ready', { ready: true });

importScripts(
  new URL('spell-ocr.js', self.location.href).href,
  new URL('image-analysis-core.js', self.location.href).href,
  new URL('attribute-scoring.js', self.location.href).href,
  new URL('power-calculation.js', self.location.href).href,
  new URL('magia-image-pipeline.js', self.location.href).href,
);

self.onmessage = event => {
  const { jobId, width, height, buffer } = event.data;
  try {
    self.postMessage({ jobId, type: 'progress', stage: '画像処理の眼を軽く整えています…' });
    const structure = self.MagiaImagePipeline.analyzeStructure(buffer, width, height);
    self.postMessage({ jobId, type: 'progress', stage: '閉じた線のパスを読み取っています…' });
    self.postMessage({ jobId, type: 'success', ...structure });
  } catch (error) {
    self.postMessage({ jobId, type: 'error', message: error?.message || String(error) });
  }
};

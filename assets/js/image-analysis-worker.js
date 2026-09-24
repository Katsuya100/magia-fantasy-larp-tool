importScripts(new URL('image-analysis-core.js', self.location.href).href);

const { detectClosedPathsJs, analyzeSigilMetricsJs } = self.ImageAnalysisCore;

self.onmessage = event => {
  const { jobId, width, height, buffer } = event.data;
  try {
    self.postMessage({ jobId, type: 'progress', stage: '画像処理の眼を軽く整えています…' });
    const paths = detectClosedPathsJs(buffer, width, height);
    self.postMessage({ jobId, type: 'progress', stage: '閉じた線のパスを読み取っています…' });
    const metrics = analyzeSigilMetricsJs(buffer, width, height, paths);
    self.postMessage({ jobId, type: 'success', paths, shape: metrics.scores, lineStraightness: metrics.lineStraightness });
  } catch (error) {
    self.postMessage({ jobId, type: 'error', message: error?.message || String(error) });
  }
};

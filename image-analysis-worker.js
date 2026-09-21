importScripts(new URL('image-analysis-core.js', self.location.href).href);

const { detectCirclesJs, analyzeSigilMetricsJs } = self.ImageAnalysisCore;

self.onmessage = event => {
  const { width, height, buffer } = event.data;
  try {
    self.postMessage({ type: 'progress', stage: '画像処理の眼を軽く整えています…' });
    const circle = detectCirclesJs(buffer, width, height);
    self.postMessage({ type: 'progress', stage: '二重円を読み取っています…' });
    const metrics = analyzeSigilMetricsJs(buffer, width, height, circle);
    self.postMessage({ type: 'success', circle, shape: metrics.scores, lineStraightness: metrics.lineStraightness });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};

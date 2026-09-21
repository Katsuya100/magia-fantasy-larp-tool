(function startMagiaCircleApp(global) {
  'use strict';

  const core = global.SpellOcrCore;
  if (!core) throw new Error('spell-ocr.js must load before magia-circle-app.js');
  const imageAnalysis = global.ImageAnalysisCore;
  if (!imageAnalysis) throw new Error('image-analysis-core.js must load before magia-circle-app.js');
  const powerCalculation = global.PowerCalculationCore;
  if (!powerCalculation) throw new Error('power-calculation.js must load before magia-circle-app.js');

  const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
  const SPELL_PLACEHOLDER = '写し絵を選ぶと、刻まれた呪文がここへ現れます。';
  const ATTRIBUTES = {
    flame: { label: '炎', icon: '🔥', descriptions: ['A spell that controls fire and heat.', 'A spell that burns enemies with intense crimson flames.', 'A destructive spell that creates explosions and blazing fire.'] },
    aqua: { label: '水', icon: '💧', descriptions: ['A spell that controls water and flowing currents.', 'A spell that summons rain, waves, rivers, or the sea.', 'A fluid spell that washes away danger and restores calm.'] },
    bolt: { label: '雷', icon: '⚡', descriptions: ['A spell that commands lightning and electric energy.', 'A sudden attack that strikes with thunder and flashing light.', 'A fast spell that releases a powerful electrical shock.'] },
    gravity: { label: '重力', icon: '⬤', descriptions: ['A spell that controls gravity, weight, and falling force.', 'A heavy spell that pulls enemies down toward the ground.', 'A spell that bends mass, orbit, and the force of attraction.'] },
    storm: { label: '嵐', icon: '🌪', descriptions: ['A spell that commands wind, clouds, rain, and thunder together.', 'A violent spell that summons a raging storm across the sky.', 'A swirling spell that tears through the air with weather and wind.'] },
    law: { label: '法', icon: '⚖', descriptions: ['A spell that creates order, rules, justice, and binding contracts.', 'A precise spell that judges enemies and enforces a command.', 'A protective spell that establishes a system and restores order.'] },
    chaos: { label: '混沌', icon: '☄', descriptions: ['A spell that spreads disorder, randomness, and confusion.', 'A wild spell that breaks rules and twists reality unpredictably.', 'A strange destructive spell filled with noise, madness, and entropy.'] },
  };

  function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required element is missing: #${id}`);
    return element;
  }

  const stage = requireElement('stage');
  const stageEmpty = requireElement('stageEmpty');
  const fileInput = requireElement('fileInput');
  const captureCanvas = requireElement('captureCanvas');
  const overlayCanvas = requireElement('overlayCanvas');
  const cameraStatus = requireElement('cameraStatus');
  const spellOutput = requireElement('spell');
  const modelStatus = requireElement('modelStatus');
  const preloadStatus = requireElement('preloadStatus');
  const structureResult = requireElement('structureResult');
  const attributeResult = requireElement('attributeResult');
  const shapeResult = requireElement('shapeResult');
  const powerResult = requireElement('powerResult');
  const captureContext = captureCanvas.getContext('2d', { willReadFrequently: true });
  const overlayContext = overlayCanvas.getContext('2d');

  let detectedCircle = null;
  let analysisWorker = null;
  let analysisPending = null;
  let ocrPromise = null;
  let recognizerPromise = null;
  let embeddingModulePromise = null;
  let extractor = null;
  let attributeVectors = null;
  const powerInputs = {
    circleAccuracy: null,
    lineStraightness: null,
    attributeCertainty: null,
    sigilCertainty: null,
    wordCount: null,
  };

  function setStatus(element, text, kind = '') {
    element.textContent = text;
    element.className = `status${kind ? ` ${kind}` : ''}`;
    element.setAttribute('aria-busy', kind === 'busy' ? 'true' : 'false');
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
  }

  function progressText(value) {
    if (!Number.isFinite(value)) return '';
    const percent = value <= 1 ? value * 100 : value;
    return `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
  }

  function resetPowerInputs() {
    powerInputs.circleAccuracy = null;
    powerInputs.lineStraightness = null;
    powerInputs.attributeCertainty = null;
    powerInputs.sigilCertainty = null;
    powerInputs.wordCount = null;
  }

  function renderPower() {
    const ready = Object.values(powerInputs).every(value => Number.isFinite(value));
    if (!ready) {
      powerResult.className = 'result-empty';
      powerResult.textContent = '円、線、属性、紋、単語の5つを読み取ると、威力が現れます。';
      return;
    }
    const result = powerCalculation.calculatePower(powerInputs);
    const rows = [
      ['円の正確さ', result.scores.circleAccuracy, `${Math.round(result.normalized.circleAccuracy * 100)}%`],
      ['線の真っ直ぐさ', result.scores.lineStraightness, `${Math.round(result.normalized.lineStraightness * 100)}%`],
      ['属性の確かさ', result.scores.attributeCertainty, `${Math.round(result.normalized.attributeCertainty * 100)}%`],
      ['紋の断定の確かさ', result.scores.sigilCertainty, `${Math.round(result.normalized.sigilCertainty * 100)}%`],
    ];
    powerResult.className = 'power';
    powerResult.innerHTML = `<div class="result-main"><div><div class="label">総合威力</div><div class="value">${result.power}</div></div></div><div class="bars">${rows.map(([label, score, value]) => `<div class="bar-row"><span>${label}</span><div class="bar"><span style="width:${Math.round(score * 100)}%"></span></div><strong>${value}</strong></div>`).join('')}</div><div class="power-count"><span>単語の数</span><strong>${result.normalized.wordCount}語</strong></div><p class="note">4つの確かさの平均に単語数を掛けて算出します。</p>`;
  }

  function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function ensureAnalysisWorker() {
    if (analysisWorker) return analysisWorker;
    analysisWorker = new Worker(new URL('image-analysis-worker.js', document.baseURI));
    analysisWorker.addEventListener('message', event => {
      const message = event.data || {};
      if (message.type === 'progress') {
        setStatus(cameraStatus, message.stage, 'busy');
        setStatus(modelStatus, message.stage, 'busy');
        return;
      }
      if (!analysisPending) return;
      const pending = analysisPending;
      analysisPending = null;
      if (message.type === 'success') pending.resolve(message);
      if (message.type === 'error') pending.fallback(new Error(message.message));
    });
    analysisWorker.addEventListener('error', event => {
      if (!analysisPending) return;
      const pending = analysisPending;
      analysisPending = null;
      analysisWorker?.terminate();
      analysisWorker = null;
      const detail = event.error?.message || event.message || 'Worker error';
      pending.fallback(new Error(`画像処理の眼を呼び出せませんでした。${detail}`));
    });
    return analysisWorker;
  }

  function scaleCircle(circle, factor) {
    if (!circle || factor === 1) return circle;
    const scale = value => ({ x: value.x * factor, y: value.y * factor, r: value.r * factor });
    return { ...circle, outer: scale(circle.outer), inner: scale(circle.inner) };
  }

  function analyzeImageOnMain(image, scale) {
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          setStatus(cameraStatus, '画像処理の眼を軽く整えています…', 'busy');
          await yieldToBrowser();
          const circle = imageAnalysis.detectCirclesJs(image.data.buffer, image.width, image.height);
          setStatus(cameraStatus, '二重円を読み取っています…', 'busy');
          await yieldToBrowser();
          const metrics = imageAnalysis.analyzeSigilMetricsJs(image.data.buffer, image.width, image.height, circle);
          resolve({ circle: scaleCircle(circle, 1 / scale), shape: metrics.scores, lineStraightness: metrics.lineStraightness });
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  }

  async function analyzeImageInWorker() {
    const maxSide = core.config.analysisInputSide || Math.max(captureCanvas.width, captureCanvas.height);
    const scale = Math.min(1, maxSide / Math.max(captureCanvas.width, captureCanvas.height));
    let sourceCanvas = captureCanvas;
    if (scale < 1) {
      await yieldToBrowser();
      sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = Math.max(1, Math.round(captureCanvas.width * scale));
      sourceCanvas.height = Math.max(1, Math.round(captureCanvas.height * scale));
      sourceCanvas.getContext('2d').drawImage(captureCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height);
    }
    const image = sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    if (global.location?.protocol === 'file:') return analyzeImageOnMain(image, scale);
    const worker = ensureAnalysisWorker();
    return new Promise((resolve, reject) => {
      analysisPending = {
        resolve: result => resolve({ ...result, circle: scaleCircle(result.circle, 1 / scale) }),
        reject,
        fallback: () => analyzeImageOnMain(image, scale).then(resolve, reject),
      };
      try {
        const transferable = image.data.slice().buffer;
        worker.postMessage({ width: image.width, height: image.height, buffer: transferable }, [transferable]);
      } catch (error) {
        const pending = analysisPending;
        analysisPending = null;
        pending.fallback(error);
      }
    });
  }

  function canvasFromImage(image) {
    const maxSide = core.config.maxInputSide || Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    captureCanvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    captureCanvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    captureContext.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    captureContext.drawImage(image, 0, 0, captureCanvas.width, captureCanvas.height);
    stage.classList.add('captured');
    stageEmpty.hidden = true;
    captureCanvas.classList.remove('hidden');
    overlayCanvas.classList.remove('hidden');
    drawOverlay();
  }

  function drawOverlay() {
    overlayCanvas.width = captureCanvas.width;
    overlayCanvas.height = captureCanvas.height;
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!detectedCircle) return;
    overlayContext.save();
    overlayContext.strokeStyle = '#8be0f3';
    overlayContext.lineWidth = Math.max(2, overlayCanvas.width / 420);
    overlayContext.setLineDash([10, 7]);
    for (const circle of [detectedCircle.outer, detectedCircle.inner]) {
      overlayContext.beginPath();
      overlayContext.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
      overlayContext.stroke();
    }
    overlayContext.setLineDash([]);
    overlayContext.fillStyle = '#f5d879';
    overlayContext.font = `${Math.max(14, overlayCanvas.width / 55)}px ui-sans-serif`;
    overlayContext.fillText('二重円', detectedCircle.outer.x - detectedCircle.outer.r, Math.max(24, detectedCircle.outer.y - detectedCircle.outer.r - 12));
    overlayContext.restore();
  }

  async function samplePolar(canvas, circle, innerGap = 10, outerGap = 10, width = 1200, height = 180) {
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputContext = output.getContext('2d');
    const source = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    const data = outputContext.createImageData(width, height);
    const inner = circle.inner.r + innerGap;
    const outer = circle.outer.r - outerGap;
    for (let x = 0; x < width; x += 1) {
      const theta = x / width * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      for (let y = 0; y < height; y += 1) {
        const t = y / Math.max(1, height - 1);
        const radius = inner + t * Math.max(1, outer - inner);
        const centerX = circle.inner.x + (circle.outer.x - circle.inner.x) * t;
        const centerY = circle.inner.y + (circle.outer.y - circle.inner.y) * t;
        const sourceX = Math.round(centerX + cos * radius);
        const sourceY = Math.round(centerY + sin * radius);
        const outputIndex = (y * width + x) * 4;
        if (sourceX < 0 || sourceY < 0 || sourceX >= canvas.width || sourceY >= canvas.height) {
          data.data[outputIndex] = data.data[outputIndex + 1] = data.data[outputIndex + 2] = 0;
          data.data[outputIndex + 3] = 255;
          continue;
        }
        const sourceIndex = (sourceY * canvas.width + sourceX) * 4;
        data.data[outputIndex] = source.data[sourceIndex];
        data.data[outputIndex + 1] = source.data[sourceIndex + 1];
        data.data[outputIndex + 2] = source.data[sourceIndex + 2];
        data.data[outputIndex + 3] = 255;
      }
      if (x % 32 === 31) await yieldToBrowser();
    }
    outputContext.putImageData(data, 0, 0);
    return output;
  }

  async function ringCoverage(polar) {
    const data = polar.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, polar.width, polar.height).data;
    let covered = 0;
    for (let x = 0; x < polar.width; x += 1) {
      let dark = 0;
      for (let y = 0; y < polar.height; y += 1) {
        const index = (y * polar.width + x) * 4;
        const luminance = data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114;
        if (luminance < 150) dark += 1;
      }
      if (dark >= Math.max(2, polar.height * .055)) covered += 1;
      if (x % 32 === 31) await yieldToBrowser();
    }
    return covered / polar.width;
  }

  function renderStructure(circle, ring, shape) {
    const rows = [
      ['二重円の器', circle ? '起きている' : '眠っている', circle?.confidence ?? 0],
      ['呪文の環', ring >= .58 ? '一周している' : '環が途切れている', ring],
      ['内円の紋', shape ? '姿を現した' : 'まだ見えない', shape ? 1 : 0],
    ];
    structureResult.className = '';
    structureResult.innerHTML = '<b>円環の記録</b><div class="bars">' + rows.map(([label, value, score]) => `<div class="bar-row"><span>${label}</span><div class="bar"><span style="width:${Math.round(clamp(score) * 100)}%"></span></div><strong>${escapeHtml(value)}</strong></div>`).join('') + '</div>' + (ring < .58 ? '<p class="note">外円と内円のあいだを、途切れない呪文で満たす必要があります。</p>' : '');
  }

  function renderShape(scores) {
    if (!scores) {
      shapeResult.className = 'result-empty';
      shapeResult.textContent = '紋の姿が見えるまで、内円の記録は眠ったままです。';
      return null;
    }
    const names = { attack: '攻撃の相', defense: '防御の相', support: '回復／支援の相', debuff: '弱体の相' };
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [top, second] = sorted;
    const certainty = clamp((top[1] - second[1]) / .32);
    shapeResult.className = 'shape';
    shapeResult.innerHTML = `<div class="shape-title"><b>${names[top[0]]}</b><span>読みの確かさ ${Math.round(certainty * 100)}%</span></div><div class="bars">${sorted.map(([key, value]) => `<div class="bar-row"><span>${names[key]}</span><div class="bar"><span style="width:${Math.round(value * 100)}%"></span></div><strong>${Math.round(value * 100)}%</strong></div>`).join('')}</div><p class="note">${certainty < .35 ? '複数の相が近く、紋の声はまだ揺れている。' : '最も強く現れた相を、この紋の性質として記します。'}</p>`;
    return certainty;
  }

  async function analyzeStructure() {
    setStatus(cameraStatus, '二重円と紋の輪郭を読み取っています…', 'busy');
    try {
      const result = await analyzeImageInWorker();
      detectedCircle = result.circle;
      drawOverlay();
      const polar = await samplePolar(captureCanvas, detectedCircle);
      const ring = await ringCoverage(polar);
      renderStructure(detectedCircle, ring, result.shape);
      powerInputs.circleAccuracy = result.circle.confidence;
      powerInputs.lineStraightness = result.lineStraightness;
      powerInputs.sigilCertainty = renderShape(result.shape);
      renderPower();
      setStatus(cameraStatus, '二重円と紋の輪郭を読み取った。続けて呪文を読み取ります。', 'good');
      return result;
    } catch (error) {
      detectedCircle = null;
      drawOverlay();
      structureResult.className = 'result-empty';
      structureResult.textContent = error.message;
      renderShape(null);
      powerInputs.circleAccuracy = null;
      powerInputs.lineStraightness = null;
      powerInputs.sigilCertainty = null;
      renderPower();
      setStatus(cameraStatus, '二重円の検出に失敗した。呪文の読み取りを続けます。', 'error');
      return null;
    }
  }

  async function preprocessOcrCanvas(source, mode) {
    if (mode === 'source') return source;
    const output = document.createElement('canvas');
    output.width = source.width;
    output.height = source.height;
    const sourceData = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, source.width, source.height);
    const data = new ImageData(source.width, source.height);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const index = (y * source.width + x) * 4;
        const luminance = sourceData.data[index] * .299 + sourceData.data[index + 1] * .587 + sourceData.data[index + 2] * .114;
        const value = mode === 'binary' ? (luminance < 160 ? 0 : 255) : Math.max(0, Math.min(255, Math.round(luminance * 1.35 - 44.8)));
        data.data[index] = data.data[index + 1] = data.data[index + 2] = value;
        data.data[index + 3] = 255;
      }
      if (y % 32 === 31) await yieldToBrowser();
    }
    output.getContext('2d').putImageData(data, 0, 0);
    return output;
  }

  function rotateOcrCanvas(source, angle) {
    const quarter = ((angle / 90) % 4 + 4) % 4;
    const output = document.createElement('canvas');
    if (quarter % 2) {
      output.width = source.height;
      output.height = source.width;
    } else {
      output.width = source.width;
      output.height = source.height;
    }
    const context = output.getContext('2d');
    context.translate(output.width / 2, output.height / 2);
    context.rotate(quarter * Math.PI / 2);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    return output;
  }

  function lineImageCanvas(line) {
    const canvas = document.createElement('canvas');
    canvas.width = line.image.width;
    canvas.height = line.image.height;
    canvas.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(line.image.data), canvas.width, canvas.height), 0, 0);
    return canvas;
  }

  async function ensureRecognizer() {
    if (recognizerPromise) return recognizerPromise;
    recognizerPromise = (async () => {
      const ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/+esm`);
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/dist/`;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = true;
      const session = await ort.InferenceSession.create(core.config.recognitionModelUrl);
      const dictionary = [...(await (await fetch(core.config.dictionaryUrl)).text()).split('\n'), ' '];
      return { ort, session, dictionary };
    })();
    recognizerPromise.catch(() => { recognizerPromise = null; });
    return recognizerPromise;
  }

  async function recognizeCanvas(canvas) {
    const { ort, session, dictionary } = await ensureRecognizer();
    const height = 48;
    const width = Math.max(48, Math.min(960, Math.round(canvas.width / Math.max(1, canvas.height) * height)));
    const source = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = canvas.width;
    sourceCanvas.height = canvas.height;
    sourceCanvas.getContext('2d').putImageData(source, 0, 0);
    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = width;
    targetCanvas.height = height;
    targetCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0, width, height);
    const resized = targetCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
    const pixels = width * height;
    const values = new Float32Array(pixels * 3);
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * 4;
      values[index] = resized.data[offset + 2] / 255;
      values[pixels + index] = resized.data[offset + 1] / 255;
      values[pixels * 2 + index] = resized.data[offset] / 255;
    }
    await yieldToBrowser();
    const output = (await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', values, [1, 3, height, width]) }))[session.outputNames[0]];
    return core.decodeGreedyCtc(output, dictionary);
  }

  async function recognizeBrowserLineVariants(line) {
    return core.runRecognizeVariants({
      source: lineImageCanvas(line),
      preprocess: preprocessOcrCanvas,
      rotate: rotateOcrCanvas,
      recognize: recognizeCanvas,
    });
  }

  async function ensureGutenOcr() {
    if (ocrPromise) return ocrPromise;
    ocrPromise = (async () => {
      const cvModule = await import('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/+esm');
      const cv = cvModule.default ?? cvModule;
      if (!cv.Mat) await new Promise(resolve => {
        const previous = cv.onRuntimeInitialized;
        cv.onRuntimeInitialized = () => { previous?.(); resolve(); };
      });
      cv.matFromImageData = imageData => {
        const data = imageData instanceof ImageData ? imageData : new ImageData(Uint8ClampedArray.from(imageData.data), imageData.width, imageData.height);
        const mat = new cv.Mat(data.height, data.width, cv.CV_8UC4);
        mat.data.set(data.data);
        return mat;
      };
      const splitSource = await (await fetch('https://cdn.jsdelivr.net/npm/@gutenye/ocr-common@1.4.9/splitIntoLineImages/+esm')).text();
      const support = String.raw`class BrowserLineImage {
  constructor({data,width,height}) { this.data=Uint8ClampedArray.from(data); this.width=width; this.height=height; }
  async resize(size,heightValue) {
    const requestedWidth=Number(typeof size==='object'?size?.width:size);
    const requestedHeight=Number(typeof size==='object'?size?.height:heightValue);
    const width=Math.max(1,Math.round(Number.isFinite(requestedWidth)?requestedWidth:this.width));
    const height=Math.max(1,Math.round(Number.isFinite(requestedHeight)?requestedHeight:this.height));
    const source=document.createElement('canvas'); source.width=this.width; source.height=this.height;
    source.getContext('2d').putImageData(new ImageData(this.data,this.width,this.height),0,0);
    const target=document.createElement('canvas'); target.width=width; target.height=height;
    target.getContext('2d').drawImage(source,0,0,width,height);
    return new BrowserLineImage(target.getContext('2d').getImageData(0,0,width,height));
  }
}`;
      const patchedSource = support + splitSource
        .replace('from"/npm/@techstark/opencv-js@4.9.0-release.3/+esm"', 'from"https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/+esm"')
        .replace('from"/npm/js-clipper@1.0.1/+esm"', 'from"https://cdn.jsdelivr.net/npm/js-clipper@1.0.1/+esm"')
        .replace('let v;', 'let v=BrowserLineImage;');
      const splitUrl = URL.createObjectURL(new Blob([patchedSource], { type: 'text/javascript' }));
      const { splitIntoLineImages: baseSplitIntoLineImages } = await import(splitUrl);
      URL.revokeObjectURL(splitUrl);
      const splitIntoLineImages = async (...args) => {
        const lineImages = await baseSplitIntoLineImages(...args);
        global.__gutenLastLineImages = lineImages;
        return lineImages;
      };
      const ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/+esm`);
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/dist/`;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = true;
      const { default: Ocr } = await import('https://cdn.jsdelivr.net/npm/@gutenye/ocr-browser@1.4.9/+esm');
      const common = await import('https://cdn.jsdelivr.net/npm/@gutenye/ocr-common@1.4.9/+esm');
      class BrowserImageRaw {
        constructor({ data, width, height }) { this.data = Uint8ClampedArray.from(data); this.width = width; this.height = height; }
        async resize({ width, height }) {
          const source = document.createElement('canvas'); source.width = this.width; source.height = this.height;
          source.getContext('2d').putImageData(new ImageData(this.data, this.width, this.height), 0, 0);
          const target = document.createElement('canvas'); target.width = width; target.height = height;
          target.getContext('2d').drawImage(source, 0, 0, width, height);
          return new BrowserImageRaw(target.getContext('2d').getImageData(0, 0, width, height));
        }
        async write() {}
        async drawBox() { return this; }
        static async open(url) {
          const image = new Image(); image.src = url; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          return new BrowserImageRaw(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
        }
      }
      class BrowserFileUtils { static async read(url) { return (await fetch(url)).text(); } }
      common.registerBackend({ FileUtils: BrowserFileUtils, ImageRaw: BrowserImageRaw, InferenceSession: ort.InferenceSession, splitIntoLineImages, defaultModels: { detectionPath: core.config.detectionModelUrl, recognitionPath: core.config.recognitionModelUrl, dictionaryPath: core.config.dictionaryUrl } });
      return Ocr.create({ models: { detectionPath: core.config.detectionModelUrl, recognitionPath: core.config.recognitionModelUrl, dictionaryPath: core.config.dictionaryUrl }, recognitionThreshold: 0 });
    })();
    ocrPromise.catch(() => { ocrPromise = null; });
    return ocrPromise;
  }

  async function recognizeSpell(canvas) {
    const ocr = await ensureGutenOcr();
    global.__gutenLastLineImages = [];
    return core.run({
      detect: async () => {
        const detected = await ocr.detect(canvas.toDataURL('image/jpeg', .95));
        return { ...detected, lineImages: global.__gutenLastLineImages || detected.lineImages || [] };
      },
      recognizeVariants: recognizeBrowserLineVariants,
    });
  }

  async function ensureExtractor() {
    if (extractor) return extractor;
    if (!embeddingModulePromise) embeddingModulePromise = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
    const { env, pipeline } = await embeddingModulePromise;
    const wasm = env.backends?.onnx?.wasm;
    if (wasm) {
      wasm.numThreads = 1;
      wasm.proxy = true;
    }
    setStatus(modelStatus, '言葉の相を測る器を呼び出しています…', 'busy');
    extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8', progress_callback: info => { if (info?.status) setStatus(modelStatus, `器の準備: ${info.status} ${progressText(info.progress)}`); } });
    return extractor;
  }

  async function embed(texts, prefix) {
    const model = await ensureExtractor();
    await yieldToBrowser();
    const output = await model(texts.map(text => `${prefix}: ${text}`), { pooling: 'mean', normalize: true });
    const values = output.tolist();
    return texts.length === 1 ? [Array.isArray(values[0]) ? values[0] : values] : values;
  }

  async function ensureAttributeVectors() {
    if (attributeVectors) return attributeVectors;
    const keys = Object.keys(ATTRIBUTES);
    const texts = keys.flatMap(key => ATTRIBUTES[key].descriptions);
    const rows = await embed(texts, 'passage');
    attributeVectors = {};
    let index = 0;
    for (const key of keys) attributeVectors[key] = ATTRIBUTES[key].descriptions.map(() => rows[index++]);
    return attributeVectors;
  }

  function cosine(a, b) {
    let dot = 0; let aa = 0; let bb = 0;
    for (let index = 0; index < a.length; index += 1) { dot += a[index] * b[index]; aa += a[index] * a[index]; bb += b[index] * b[index]; }
    return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
  }

  async function judgeSpell(text) {
    const query = (await embed([text], 'query'))[0];
    const vectors = await ensureAttributeVectors();
    const scores = Object.entries(vectors).map(([key, rows]) => {
      const values = rows.map(vector => cosine(query, vector)).sort((a, b) => b - a);
      return [key, values.slice(0, 2).reduce((sum, value) => sum + value, 0) / Math.min(2, values.length)];
    }).sort((a, b) => b[1] - a[1]);
    const min = scores[scores.length - 1][1];
    const max = scores[0][1];
    const spread = Math.max(.0001, max - min);
    const top = scores[0];
    const second = scores[1];
    const confidence = clamp((top[1] - second[1]) / .12);
    attributeResult.className = '';
    attributeResult.innerHTML = `<div class="result-main"><div><div class="label">呪文に近い相</div><div class="value">${ATTRIBUTES[top[0]].icon} ${ATTRIBUTES[top[0]].label}</div></div><div class="score">読みの確かさ ${Math.round(confidence * 100)}%</div></div><div class="bars">${scores.map(([key, score]) => `<div class="bar-row"><span>${ATTRIBUTES[key].icon} ${ATTRIBUTES[key].label}</span><div class="bar"><span style="width:${Math.round(((score - min) / spread) * 100)}%"></span></div><strong>${Math.round(((score - min) / spread) * 100)}%</strong></div>`).join('')}</div><p class="note">呪文の意味を属性の言葉と重ね、最も近い相を選びました。二つの相が近いとき、読みの確かさは下がります。</p>`;
    setStatus(modelStatus, '呪文の相がひとつ、頁の上に現れた。', 'good');
    return confidence;
  }

  function resetResults() {
    detectedCircle = null;
    resetPowerInputs();
    spellOutput.textContent = SPELL_PLACEHOLDER;
    structureResult.className = 'result-empty';
    structureResult.textContent = '魔法陣を写し取れば、二重円、呪文の環、内円の紋が順に姿を現します。';
    attributeResult.className = 'result-empty';
    attributeResult.textContent = '呪文を捧げると、その言葉に最も近い属性の相が目を覚まします。';
    shapeResult.className = 'result-empty';
    shapeResult.textContent = '紋を読めば、攻撃・防御・回復／支援・デバフの性質が力の割合として現れます。';
    renderPower();
    captureCanvas.classList.add('hidden');
    overlayCanvas.classList.add('hidden');
    stage.classList.remove('captured');
    stageEmpty.hidden = false;
  }

  async function loadFile(file) {
    if (!file) return;
    resetResults();
    setStatus(cameraStatus, '写し絵を読み込んでいます…', 'busy');
    setStatus(modelStatus, '画像から円環の情報を準備しています…', 'busy');
    const image = new Image();
    const source = URL.createObjectURL(file);
    image.onload = async () => {
      URL.revokeObjectURL(source);
      try {
        canvasFromImage(image);
        setStatus(cameraStatus, '写し絵を受け取った。二重円を検出しています…', 'busy');
        await analyzeStructure();
        setStatus(modelStatus, '共通 OCR フローで円環の文字を読み取っています…', 'busy');
        const result = await recognizeSpell(captureCanvas);
        const text = result.path.text;
        powerInputs.wordCount = result.path.words.length;
        renderPower();
        spellOutput.textContent = text || '円環から呪文を読み取れませんでした。';
        if (!text) {
          setStatus(modelStatus, '円環から呪文を読み取れませんでした。', 'error');
          return;
        }
        setStatus(modelStatus, '円環の声を拾い上げた。属性を判定しています…', 'busy');
        powerInputs.attributeCertainty = await judgeSpell(text);
        renderPower();
        setStatus(cameraStatus, '検出、OCR、呪文表示、属性判定まで完了しました。', 'good');
      } catch (error) {
        setStatus(cameraStatus, `写し絵の解析に失敗しました。${error.message}`, 'error');
        setStatus(modelStatus, '共通 OCR フローを完了できませんでした。', 'error');
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      setStatus(cameraStatus, '写し絵を読み込めませんでした。別の画像を選んでください。', 'error');
    };
    image.src = source;
  }

  async function preloadOcr() {
    try {
      setStatus(preloadStatus, '共通 OCR の写本を準備しています…', 'busy');
      await ensureGutenOcr();
      setStatus(preloadStatus, '共通 OCR の写本を用意しました。', 'good');
    } catch (error) {
      setStatus(preloadStatus, `OCR の事前準備に失敗しました。${error.message}`, 'error');
    }
  }

  fileInput.addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    loadFile(file);
  });
  window.addEventListener('resize', drawOverlay);
  window.addEventListener('beforeunload', () => {
    analysisWorker?.terminate();
  });
  preloadOcr();
}(globalThis));

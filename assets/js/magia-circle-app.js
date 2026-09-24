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
  const ATTRIBUTES = global.AttributeScoringCore.attributes;
  const allocateWholePercentages = global.AttributeScoringCore.allocateWholePercentages;
  const DEFAULT_SHAPE_SCORES = Object.freeze({ debuff: .25, attack: .25, defense: .25, support: .25 });
  const diagnostics = global.location?.search && new URLSearchParams(global.location.search).has('diagnostics')
    ? { image: null, spell: null, circle: null, attribute: null, sigil: null, power: null }
    : null;

  function publishDiagnostics() {
    if (!diagnostics) return;
    let output = document.getElementById('analysisDiagnostics');
    if (!output) {
      output = document.createElement('pre');
      output.id = 'analysisDiagnostics';
      output.setAttribute('aria-label', '画像解析診断JSON');
      output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto;padding:1rem;background:#fff;color:#111';
      const download = document.createElement('button');
      download.type = 'button';
      download.textContent = '診断JSONを保存';
      download.addEventListener('click', () => {
        const blob = new Blob([output.textContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'browser-image-output.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      });
      document.body.append(download, output);
    }
    const pathSummary = path => path && ({ x: path.x, y: path.y, radius: path.r, radii: path.radii, coverage: path.coverage, circleAccuracy: path.circleAccuracy });
    const spell = diagnostics.spell && {
      text: diagnostics.spell.text,
      words: diagnostics.spell.words,
      points: diagnostics.spell.points,
      lines: diagnostics.spell.lines,
      rawCandidates: diagnostics.spell.rawCandidates.map(candidate => ({ line: candidate.line, text: candidate.text, votes: candidate.votes })),
      candidates: diagnostics.spell.candidates.map(candidate => ({ text: candidate.text, x: candidate.x, y: candidate.y, groupId: candidate.groupId, confidence: candidate.confidence })),
    };
    const circle = diagnostics.circle && {
      outer: pathSummary(diagnostics.circle.paths?.outer),
      inner: pathSummary(diagnostics.circle.paths?.inner),
      circleAccuracy: diagnostics.circle.paths?.circleAccuracy ?? 0,
      lineStraightness: diagnostics.circle.lineStraightness,
      ringCoverage: diagnostics.circle.ringCoverage,
      sigilScores: diagnostics.circle.sigilScores,
    };
    output.textContent = JSON.stringify({ image: diagnostics.image, spell, circle, attribute: diagnostics.attribute, sigil: diagnostics.sigil, power: diagnostics.power });
  }

  function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Required element is missing: #${id}`);
    return element;
  }

  const stage = requireElement('stage');
  const stageEmpty = requireElement('stageEmpty');
  const fileInput = requireElement('fileInput');
  const cameraButton = requireElement('cameraButton');
  const cameraVideo = requireElement('cameraVideo');
  const captureCanvas = requireElement('captureCanvas');
  const overlayCanvas = requireElement('overlayCanvas');
  const analysisSpinner = requireElement('analysisSpinner');
  const progressLog = requireElement('progressLog');
  const cameraStatus = requireElement('cameraStatus');
  const spellOutput = requireElement('spell');
  const modelStatus = requireElement('modelStatus');
  const preloadStatus = requireElement('preloadStatus');
  const altarSection = requireElement('altarSection');
  const detailsChapter = requireElement('detailsChapter');
  const circleDetailPage = requireElement('circleDetailPage');
  const spellDetailPage = requireElement('spellDetailPage');
  const attributeResult = requireElement('attributeResult');
  const attributeDetail = requireElement('attributeDetail');
  const shapeResult = requireElement('shapeResult');
  const shapeDetail = requireElement('shapeDetail');
  const powerResult = requireElement('powerResult');
  const powerDetail = requireElement('powerDetail');
  const captureContext = captureCanvas.getContext('2d', { willReadFrequently: true });
  const overlayContext = overlayCanvas.getContext('2d');

  let detectedPaths = null;
  let analysisWorker = null;
  let analysisPending = null;
  let activeAnalysisJob = null;
  let nextAnalysisJobId = 0;
  let userStartedImageAction = false;
  let cameraStream = null;
  let ocrPromise = null;
  let recognizerPromise = null;
  let embeddingModulePromise = null;
  let extractorPromise = null;
  let extractor = null;
  let structureReady = false;
  let spellReady = false;
  let detailsTapCount = 0;
  let detailsTapTimer = null;
  const powerInputs = {
    circleAccuracy: null,
    lineStraightness: null,
    ringCoverage: null,
    attributeCertainty: null,
    sigilCertainty: null,
    wordCount: null,
  };

  function updateResultVisibility() {
    const ready = structureReady && spellReady;
    altarSection.hidden = !ready;
    detailsChapter.hidden = !ready;
  }

  function setStatus(element, text, kind = '') {
    const processStatus = element === cameraStatus || element === modelStatus;
    const prefix = element === cameraStatus ? '紋：' : element === modelStatus ? '呪文：' : '';
    const displayText = prefix && !String(text).startsWith(prefix) ? `${prefix}${text}` : text;
    element.textContent = displayText;
    element.className = `${processStatus ? 'progress-row' : 'status'}${kind ? ` ${kind}` : ''}`;
    element.setAttribute('aria-busy', kind === 'busy' ? 'true' : 'false');
  }

  function setImageBusy(busy) {
    analysisSpinner.hidden = !busy;
    stage.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function makeAnalysisAbortError(message = '解析は中断されました。') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  function isActiveAnalysisJob(job) {
    return Boolean(job && activeAnalysisJob === job && !job.signal.aborted);
  }

  function assertActiveAnalysisJob(job) {
    if (isActiveAnalysisJob(job)) return;
    throw job?.signal.reason || makeAnalysisAbortError();
  }

  function awaitForAnalysisJob(job, operation) {
    assertActiveAnalysisJob(job);
    const pending = Promise.resolve(operation);
    return new Promise((resolve, reject) => {
      const cleanup = () => job.signal.removeEventListener('abort', abort);
      const abort = () => {
        cleanup();
        reject(job.signal.reason || makeAnalysisAbortError());
      };
      job.signal.addEventListener('abort', abort, { once: true });
      pending.then(
        value => { cleanup(); resolve(value); },
        error => { cleanup(); reject(error); },
      );
      if (job.signal.aborted) abort();
    });
  }

  function appendProcessingRecord(message) {
    const entry = document.createElement('p');
    entry.className = 'progress-row';
    entry.textContent = `記録：${message}`;
    progressLog.append(entry);
  }

  function cancelActiveAnalysis(reason) {
    const job = activeAnalysisJob;
    if (!job) return;

    job.controller.abort(makeAnalysisAbortError(`${reason}ため、解析を中断しました。`));
    activeAnalysisJob = null;
    if (analysisPending?.job === job) {
      const pending = analysisPending;
      analysisPending = null;
      analysisWorker?.terminate();
      analysisWorker = null;
      pending.reject(job.signal.reason);
    }

    setImageBusy(false);
    setStatus(cameraStatus, '解析を中断しました。');
    setStatus(modelStatus, '次の写し絵を待っています。');
    appendProcessingRecord(`${job.fileName}：${reason}ため、途中で中断しました。`);
  }

  function beginAnalysisJob(file) {
    const controller = new AbortController();
    const job = {
      id: nextAnalysisJobId += 1,
      controller,
      signal: controller.signal,
      fileName: file?.name || '撮影した写し絵',
    };
    activeAnalysisJob = job;
    return job;
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeScores(scores) {
    const weights = scores.map(([key, score]) => [key, Math.max(0, score)]);
    const total = weights.reduce((sum, [, score]) => sum + score, 0);
    if (!total) return weights.map(([key]) => [key, 1 / weights.length]);
    return weights.map(([key, score]) => [key, score / total]);
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
    powerInputs.ringCoverage = null;
    powerInputs.attributeCertainty = null;
    powerInputs.sigilCertainty = null;
    powerInputs.wordCount = null;
  }

  function renderPower() {
    const ready = Object.values(powerInputs).every(value => Number.isFinite(value));
    if (!ready) {
      powerResult.className = 'result-empty';
      powerResult.innerHTML = '<div class="altar-placeholder">共鳴率が揃うと、威力が現れます。</div>';
      powerDetail.className = 'detail-result result-empty';
      powerDetail.textContent = '威力の内訳は、すべての共鳴率が揃うと現れます。';
      return;
    }
    const result = powerCalculation.calculatePower(powerInputs);
    if (diagnostics) diagnostics.power = result;
    const rows = [
      ['円の共鳴率', result.scores.circleAccuracy, `${Math.round(result.normalized.circleAccuracy * 100)}%`],
      ['線の共鳴率', result.scores.lineStraightness, `${Math.round(result.normalized.lineStraightness * 100)}%`],
      ['環と呪文の共鳴率', result.scores.ringCoverage, `${Math.round(result.normalized.ringCoverage * 100)}%`],
      ['相の共鳴率', result.scores.attributeCertainty, `${Math.round(result.normalized.attributeCertainty * 100)}%`],
      ['紋の共鳴率', result.scores.sigilCertainty, `${Math.round(result.normalized.sigilCertainty * 100)}%`],
    ];
    powerResult.className = 'altar-result altar-result--power';
    powerResult.innerHTML = `<strong class="altar-value">${result.power}</strong>`;
    powerDetail.className = 'detail-result';
    powerDetail.innerHTML = `<div class="power-lead"><span class="label">総合威力</span><strong class="value">${result.power}</strong></div><div class="bars">${rows.map(([label, score, value]) => `<div class="bar-row"><span>${label}</span><div class="bar"><span style="width:${Math.round(score * 100)}%"></span></div><strong>${value}</strong></div>`).join('')}</div><div class="power-count"><span>単語の数</span><strong>${result.normalized.wordCount}語</strong></div>`;
  }

  function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function ensureAnalysisWorker() {
    if (analysisWorker) return analysisWorker;
    const worker = new Worker(new URL('assets/js/image-analysis-worker.js', document.baseURI));
    analysisWorker = worker;
    worker.addEventListener('message', event => {
      if (analysisWorker !== worker) return;
      const message = event.data || {};
      const pending = analysisPending;
      if (!pending || message.jobId !== pending.job.id) return;
      if (message.type === 'progress') {
        if (!isActiveAnalysisJob(pending.job)) return;
        setStatus(cameraStatus, message.stage, 'busy');
        setStatus(modelStatus, message.stage, 'busy');
        return;
      }
      analysisPending = null;
      if (!isActiveAnalysisJob(pending.job)) {
        pending.reject(pending.job.signal.reason || makeAnalysisAbortError());
        return;
      }
      if (message.type === 'success') pending.resolve(message);
      if (message.type === 'error') pending.fallback(new Error(message.message));
    });
    worker.addEventListener('error', event => {
      if (analysisWorker !== worker) return;
      if (!analysisPending) return;
      const pending = analysisPending;
      analysisPending = null;
      analysisWorker?.terminate();
      analysisWorker = null;
      if (!isActiveAnalysisJob(pending.job)) {
        pending.reject(pending.job.signal.reason || makeAnalysisAbortError());
        return;
      }
      const detail = event.error?.message || event.message || 'Worker error';
      pending.fallback(new Error(`画像処理の眼を呼び出せませんでした。${detail}`));
    });
    return analysisWorker;
  }

  function scalePaths(paths, factor) {
    if (!paths || factor === 1) return paths;
    const scale = value => value && ({
      ...value,
      x: value.x * factor,
      y: value.y * factor,
      r: value.r * factor,
      radii: value.radii?.map(radius => radius * factor),
    });
    return { ...paths, outer: scale(paths.outer), inner: scale(paths.inner) };
  }

  function analyzeImageOnMain(image, scale, job) {
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          assertActiveAnalysisJob(job);
          setStatus(cameraStatus, '画像処理の眼を軽く整えています…', 'busy');
          await yieldToBrowser();
          assertActiveAnalysisJob(job);
          const paths = imageAnalysis.detectClosedPathsJs(image.data.buffer, image.width, image.height);
          setStatus(cameraStatus, '閉じたパスを読み取っています…', 'busy');
          await yieldToBrowser();
          assertActiveAnalysisJob(job);
          const metrics = imageAnalysis.analyzeSigilMetricsJs(image.data.buffer, image.width, image.height, paths);
          assertActiveAnalysisJob(job);
          resolve({ paths: scalePaths(paths, 1 / scale), shape: metrics.scores, lineStraightness: metrics.lineStraightness });
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  }

  async function analyzeImageInWorker(job) {
    assertActiveAnalysisJob(job);
    const maxSide = core.config.analysisInputSide || Math.max(captureCanvas.width, captureCanvas.height);
    const scale = Math.min(1, maxSide / Math.max(captureCanvas.width, captureCanvas.height));
    let image = captureContext.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
    if (scale < 1) {
      await yieldToBrowser();
      assertActiveAnalysisJob(job);
      const width = Math.max(1, Math.round(captureCanvas.width * scale));
      const height = Math.max(1, Math.round(captureCanvas.height * scale));
      image = new ImageData(imageAnalysis.resizeRgbaLinear(image.data, image.width, image.height, width, height), width, height);
    }
    assertActiveAnalysisJob(job);
    if (global.location?.protocol === 'file:') return analyzeImageOnMain(image, scale, job);
    const worker = ensureAnalysisWorker();
    return new Promise((resolve, reject) => {
      analysisPending = {
        job,
        resolve: result => resolve({ ...result, paths: scalePaths(result.paths, 1 / scale) }),
        reject,
        fallback: () => analyzeImageOnMain(image, scale, job).then(resolve, reject),
      };
      try {
        const transferable = image.data.slice().buffer;
        worker.postMessage({ jobId: job.id, width: image.width, height: image.height, buffer: transferable }, [transferable]);
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
    setImageBusy(true);
  }

  function stopCamera() {
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
    cameraVideo.classList.add('hidden');
    cameraButton.textContent = '写し絵を撮影';
    cameraButton.disabled = false;
  }

  function drawOverlay() {
    overlayCanvas.width = captureCanvas.width;
    overlayCanvas.height = captureCanvas.height;
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (captureCanvas.width && captureCanvas.height) overlayContext.drawImage(captureCanvas, 0, 0);
    if (!detectedPaths) return;
    overlayContext.save();
    overlayContext.lineWidth = Math.max(2, overlayCanvas.width / 420);
    overlayContext.setLineDash([10, 7]);
    for (const [path, color] of [[detectedPaths.outer, '#1677ff'], [detectedPaths.inner, '#ff2e87']]) {
      if (!path) continue;
      overlayContext.strokeStyle = color;
      overlayContext.beginPath();
        const samples = path.radii?.length || 96;
        for (let index = 0; index < samples; index += 1) {
          const theta = index / samples * Math.PI * 2;
        const radius = path.radii?.[index] || path.r;
        const x = path.x + Math.cos(theta) * radius;
        const y = path.y + Math.sin(theta) * radius;
        if (index === 0) overlayContext.moveTo(x, y);
        else overlayContext.lineTo(x, y);
      }
      overlayContext.closePath();
      overlayContext.stroke();
    }
    overlayContext.setLineDash([]);
    overlayContext.restore();
  }

  function renderShape(scores) {
    if (!scores) {
      scores = DEFAULT_SHAPE_SCORES;
    }
    const names = { attack: '攻撃の紋', defense: '防御の紋', support: '回復の紋', debuff: '弱体の紋' };
    const icons = { attack: '⚔️', defense: '🛡️', support: '✚', debuff: '🕸️' };
    const rates = normalizeScores(Object.entries(scores)).sort((a, b) => b[1] - a[1]);
    const percentages = allocateWholePercentages(rates);
    const [top] = rates;
    if (diagnostics) diagnostics.sigil = { top: top[0], rates, percentages: Object.fromEntries(percentages) };
    shapeResult.className = 'altar-result altar-result--shape';
    shapeResult.innerHTML = `<span class="altar-symbol">${icons[top[0]]}</span><div><div class="altar-kicker">最も共鳴した紋</div><strong class="altar-value">${names[top[0]].replace('の紋', '')}</strong></div>`;
    shapeDetail.className = 'detail-result';
    shapeDetail.innerHTML = `<div class="shape-title"><b>${icons[top[0]]} ${names[top[0]]}</b></div><div class="bars">${rates.map(([key]) => { const percentage = percentages.get(key); return `<div class="bar-row"><span>${icons[key]} ${names[key]}</span><div class="bar"><span style="width:${percentage}%"></span></div><strong>${percentage}%</strong></div>`; }).join('')}</div>`;
    return top[1];
  }

  async function analyzeStructure(spellPoints = [], job) {
    setStatus(cameraStatus, '閉じたパスと紋の輪郭を読み取っています…', 'busy');
    try {
      const result = await analyzeImageInWorker(job);
      assertActiveAnalysisJob(job);
      detectedPaths = result.paths;
      drawOverlay();
      const sourcePixels = captureContext.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
      const inkCoverage = detectedPaths.inner
        ? imageAnalysis.scoreInkCoverage(sourcePixels.data, captureCanvas.width, captureCanvas.height, detectedPaths)
        : 0;
      const textCoverage = imageAnalysis.scorePointsOnRing(detectedPaths, spellPoints, captureCanvas.width, captureCanvas.height);
      const ring = spellPoints.length ? (inkCoverage + textCoverage) / 2 : inkCoverage;
      powerInputs.circleAccuracy = result.paths.circleAccuracy;
      powerInputs.ringCoverage = ring;
      powerInputs.lineStraightness = result.lineStraightness;
      powerInputs.sigilCertainty = renderShape(detectedPaths.inner ? result.shape : null);
      if (diagnostics) diagnostics.circle = {
        paths: result.paths,
        lineStraightness: result.lineStraightness,
        ringCoverage: ring,
        sigilScores: result.shape,
      };
      renderPower();
      structureReady = true;
      updateResultVisibility();
      setStatus(cameraStatus, '閉じたパスと紋の輪郭を読み取った。続けて呪文を読み取ります。', 'good');
      return result;
    } catch (error) {
      if (!isActiveAnalysisJob(job)) throw job.signal.reason || error;
      detectedPaths = null;
      drawOverlay();
      powerInputs.circleAccuracy = 0;
      powerInputs.ringCoverage = 0;
      powerInputs.lineStraightness = 0;
      powerInputs.sigilCertainty = renderShape(DEFAULT_SHAPE_SCORES);
      if (diagnostics) diagnostics.circle = { error: error.message, ringCoverage: 0, lineStraightness: 0, sigilScores: DEFAULT_SHAPE_SCORES };
      renderPower();
      structureReady = true;
      updateResultVisibility();
      setStatus(cameraStatus, '陣の一部を読み取れず、威力に反映しました。呪文の読み取りを続けます。');
      return null;
    }
  }

  async function preprocessOcrImage(source, mode, job) {
    assertActiveAnalysisJob(job);
    await yieldToBrowser();
    assertActiveAnalysisJob(job);
    const processed = core.preprocessRgba(source, mode);
    assertActiveAnalysisJob(job);
    return processed;
  }

  function combineSpellLineImages(first, second, firstAngle, secondAngle) {
    return core.combineRgbaLines(first.image, second.image, firstAngle, secondAngle, imageAnalysis.resizeRgbaSharpLinear);
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

  async function recognizeCanvas(canvas, inferPixelSpaces = false, job) {
    assertActiveAnalysisJob(job);
    const { ort, session, dictionary } = await awaitForAnalysisJob(job, ensureRecognizer());
    assertActiveAnalysisJob(job);
    const height = 48;
    const width = Math.max(48, Math.min(960, Math.round(canvas.width / Math.max(1, canvas.height) * height)));
    const resized = imageAnalysis.resizeRgbaSharpLinear(canvas.data, canvas.width, canvas.height, width, height);
    const pixels = width * height;
    const values = new Float32Array(pixels * 3);
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * 4;
      values[index] = resized[offset + 2] / 255;
      values[pixels + index] = resized[offset + 1] / 255;
      values[pixels * 2 + index] = resized[offset] / 255;
    }
    await yieldToBrowser();
    assertActiveAnalysisJob(job);
    const output = (await awaitForAnalysisJob(job, session.run({ [session.inputNames[0]]: new ort.Tensor('float32', values, [1, 3, height, width]) })))[session.outputNames[0]];
    assertActiveAnalysisJob(job);
    const decoded = core.decodeGreedyCtcDetailed(output, dictionary);
    return inferPixelSpaces
      ? { text: decoded.text, spacingText: core.insertSpacesAtPixelGaps(canvas, decoded) }
      : decoded.text;
  }

  async function recognizeBrowserLineVariants(line, job) {
    const isRingLine = String(line.groupId || '').startsWith('ring:');
    return core.runRecognizeVariants({
      source: line.image,
      preprocess: (source, mode) => preprocessOcrImage(source, mode, job),
      rotate: core.rotateRgba,
      recognize: image => recognizeCanvas(image, isRingLine, job),
      signal: job.signal,
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
          return new BrowserImageRaw({ data: imageAnalysis.resizeRgbaSharpContain(this.data, this.width, this.height, width, height), width, height });
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

  async function recognizeSpell(canvas, originalFile, job) {
    const ocr = await awaitForAnalysisJob(job, ensureGutenOcr());
    assertActiveAnalysisJob(job);
    global.__gutenLastLineImages = [];
    const source = originalFile ? URL.createObjectURL(originalFile) : canvas.toDataURL('image/png');
    const recognition = core.run({
        detect: async () => {
          assertActiveAnalysisJob(job);
          const detected = await ocr.detect(source);
          assertActiveAnalysisJob(job);
          const lineImages = global.__gutenLastLineImages || detected.lineImages || [];
          const sourcePixels = captureContext.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
          const ringLines = lineImages.length <= 8 ? core.unwrapRingSectors(sourcePixels) : [];
          return { ...detected, lineImages: [...lineImages, ...ringLines] };
        },
        recognizeVariants: line => recognizeBrowserLineVariants(line, job),
        combineLines: combineSpellLineImages,
        signal: job.signal,
      });
    try {
      return await awaitForAnalysisJob(job, recognition);
    } finally {
      if (originalFile) {
        const revokeSource = () => URL.revokeObjectURL(source);
        if (job.signal.aborted) recognition.then(revokeSource, revokeSource);
        else revokeSource();
      }
    }
  }

  async function ensureExtractor(job) {
    if (extractor) return extractor;
    if (!extractorPromise) {
      extractorPromise = (async () => {
        if (!embeddingModulePromise) embeddingModulePromise = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
        const { env, pipeline } = await embeddingModulePromise;
        const wasm = env.backends?.onnx?.wasm;
        if (wasm) {
          wasm.numThreads = 1;
          wasm.proxy = true;
        }
        if (isActiveAnalysisJob(job)) setStatus(modelStatus, '呪文の相を測る準備をしています…', 'busy');
        extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8', progress_callback: info => { if (activeAnalysisJob && info?.progress !== undefined) setStatus(modelStatus, `呪文の相を測る準備をしています… ${progressText(info.progress)}`, 'busy'); } });
        return extractor;
      })();
      extractorPromise.catch(() => { extractorPromise = null; });
    }
    return extractorPromise;
  }

  function cosine(a, b) {
    let dot = 0; let aa = 0; let bb = 0;
    for (let index = 0; index < a.length; index += 1) { dot += a[index] * b[index]; aa += a[index] * a[index]; bb += b[index] * b[index]; }
    return dot / (Math.sqrt(aa) * Math.sqrt(bb) || 1);
  }

  async function judgeSpell(text, job) {
    try {
    const keys = Object.keys(ATTRIBUTES);
    const passages = keys.flatMap(key => ATTRIBUTES[key].descriptions);
    const model = await awaitForAnalysisJob(job, ensureExtractor(job));
    assertActiveAnalysisJob(job);
    await yieldToBrowser();
    assertActiveAnalysisJob(job);
    const embedded = await awaitForAnalysisJob(job, model([`query: ${text}`, ...passages.map(description => `passage: ${description}`)], { pooling: 'mean', normalize: true }));
    assertActiveAnalysisJob(job);
    const [query, ...vectors] = embedded.tolist();
    const similarities = keys.map((key, keyIndex) => {
      const rows = vectors.slice(keyIndex * ATTRIBUTES[key].descriptions.length, (keyIndex + 1) * ATTRIBUTES[key].descriptions.length);
      const values = rows.map(vector => cosine(query, vector)).sort((a, b) => b - a);
      const similarity = values.slice(0, 2).reduce((sum, value) => sum + value, 0) / Math.min(2, values.length);
      return [key, similarity];
    });
    const scores = similarities.slice().sort((a, b) => b[1] - a[1]);
    const rates = global.AttributeScoringCore.normalizeSimilarities(scores).sort((a, b) => b[1] - a[1]);
    const [top] = rates;
    if (diagnostics) diagnostics.attribute = { top: top[0], rates, similarities: Object.fromEntries(similarities) };
    attributeResult.className = 'altar-result altar-result--attribute';
    attributeResult.innerHTML = `<span class="altar-symbol">${ATTRIBUTES[top[0]].icon}</span><div><div class="altar-kicker">最も共鳴した相</div><strong class="altar-value">${ATTRIBUTES[top[0]].label}</strong></div>`;
    attributeDetail.className = 'detail-result';
    attributeDetail.innerHTML = `<div class="shape-title"><b>${ATTRIBUTES[top[0]].icon} ${ATTRIBUTES[top[0]].label}</b></div><div class="bars">${rates.map(([key, , percentage]) => `<div class="bar-row attribute-detail-row"><span>${ATTRIBUTES[key].icon} ${ATTRIBUTES[key].label}</span><div class="bar"><span style="width:${percentage}%"></span></div><strong>${percentage.toFixed(1)}%</strong></div>`).join('')}</div>`;
    setStatus(modelStatus, '呪文の相がひとつ、頁の上に現れた。', 'good');
    return top[1];
    } catch (error) {
      if (!isActiveAnalysisJob(job)) throw job.signal.reason || error;
      return renderAttributeFallback();
    }
  }

  function renderAttributeFallback() {
    const scores = Object.keys(ATTRIBUTES).map(key => [key, 0]);
    const [top] = scores;
    attributeResult.className = 'altar-result altar-result--attribute';
    attributeResult.innerHTML = `<span class="altar-symbol">${ATTRIBUTES[top[0]].icon}</span><div><div class="altar-kicker">最も共鳴した相</div><strong class="altar-value">${ATTRIBUTES[top[0]].label}</strong></div>`;
    attributeDetail.className = 'detail-result';
    attributeDetail.innerHTML = `<div class="shape-title"><b>${ATTRIBUTES[top[0]].icon} ${ATTRIBUTES[top[0]].label}</b></div><div class="bars">${scores.map(([key]) => `<div class="bar-row attribute-detail-row"><span>${ATTRIBUTES[key].icon} ${ATTRIBUTES[key].label}</span><div class="bar"><span style="width:0%"></span></div><strong>0%</strong></div>`).join('')}</div><p class="note">呪文から相を判定できませんでした。</p>`;
    setStatus(modelStatus, '相がひとつ、頁の上に現れた。', 'good');
    if (diagnostics) diagnostics.attribute = { top: top[0], rates: scores, fallback: true };
    return 0;
  }

  function resetResults() {
    stopCamera();
    detectedPaths = null;
    resetPowerInputs();
    structureReady = false;
    spellReady = false;
    updateResultVisibility();
    detailsChapter.open = false;
    cameraStatus.className = 'progress-row';
    cameraStatus.textContent = '紋：写し絵を選ぶと、閉じたパスと紋を読み取ります。';
    modelStatus.className = 'progress-row';
    modelStatus.textContent = '呪文：紋を読み取ったあと、相を判定します。';
    spellOutput.textContent = SPELL_PLACEHOLDER;
    attributeResult.className = 'result-empty';
    attributeResult.textContent = '呪文を捧げると、相が目を覚まします。';
    attributeDetail.className = 'detail-result result-empty';
    attributeDetail.textContent = '呪文を読み取ると、七つの相との共鳴率が現れます。';
    shapeResult.className = 'result-empty';
    shapeResult.textContent = '紋を読めば、その性質が現れます。';
    shapeDetail.className = 'detail-result result-empty';
    shapeDetail.textContent = '紋の輪郭を読み取ると、四つの性質が現れます。';
    renderPower();
    captureCanvas.classList.add('hidden');
    cameraVideo.classList.add('hidden');
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    setImageBusy(false);
    stage.classList.remove('captured');
    stageEmpty.hidden = false;
  }

  async function loadFile(file, sourceImage = null) {
    if (!file && !sourceImage) return;
    cancelActiveAnalysis('新しい写し絵の解析を始める');
    resetResults();
    const job = beginAnalysisJob(file);
    setStatus(cameraStatus, '写し絵を読み込んでいます…', 'busy');
    setStatus(modelStatus, '画像から紋の情報を準備しています…', 'busy');
    const image = sourceImage || new Image();
    const source = file ? URL.createObjectURL(file) : null;
    const processImage = async () => {
      if (source) URL.revokeObjectURL(source);
      if (!isActiveAnalysisJob(job)) return;
      try {
        assertActiveAnalysisJob(job);
        canvasFromImage(image);
        await yieldToBrowser();
        assertActiveAnalysisJob(job);
        if (diagnostics) diagnostics.image = {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          canvasWidth: captureCanvas.width,
          canvasHeight: captureCanvas.height,
        };
        setStatus(modelStatus, '環の呪文を読み取っています…', 'busy');
        let recognition = null;
        try {
          recognition = await awaitForAnalysisJob(job, recognizeSpell(captureCanvas, file, job));
          assertActiveAnalysisJob(job);
        } catch (error) {
          assertActiveAnalysisJob(job);
          setStatus(modelStatus, '呪文を読み取れず、位置情報なしで相を選びます。');
        }
        assertActiveAnalysisJob(job);
        const path = recognition?.path;
        if (diagnostics) diagnostics.spell = {
          text: path?.text || '',
          words: path?.words || [],
          points: path?.points || [],
          lines: (recognition?.lineImages || []).map((line, index) => ({ index, box: line.box, width: line.image?.width, height: line.image?.height })),
          rawCandidates: recognition?.rawCandidates || [],
          candidates: recognition?.candidates || [],
        };
        const text = path?.text || '';
        const spellPoints = path?.points || [];
        powerInputs.wordCount = powerCalculation.countUniqueWords(path?.words || []);
        setStatus(cameraStatus, '写し絵を受け取り、閉じたパスと環内の文字位置を調べています…', 'busy');
        await awaitForAnalysisJob(job, analyzeStructure(spellPoints, job));
        assertActiveAnalysisJob(job);
        renderPower();
        spellOutput.textContent = text || '環から呪文を読み取れませんでした。';
        setStatus(modelStatus, text ? '環の声を拾い上げた。相を判定しています…' : '呪文を読み取れず、相を選んでいます…', 'busy');
        powerInputs.attributeCertainty = await awaitForAnalysisJob(job, judgeSpell(text, job));
        assertActiveAnalysisJob(job);
        renderPower();
        spellReady = true;
        updateResultVisibility();
        setImageBusy(false);
        setStatus(cameraStatus, '紋の読み取りが完了しました。', 'good');
        activeAnalysisJob = null;
        publishDiagnostics();
      } catch (error) {
        if (!isActiveAnalysisJob(job)) return;
        if (!Number.isFinite(powerInputs.wordCount)) powerInputs.wordCount = 0;
        if (!Number.isFinite(powerInputs.attributeCertainty)) powerInputs.attributeCertainty = renderAttributeFallback();
        if (!Number.isFinite(powerInputs.circleAccuracy)) powerInputs.circleAccuracy = 0;
        if (!Number.isFinite(powerInputs.lineStraightness)) powerInputs.lineStraightness = 0;
        if (!Number.isFinite(powerInputs.ringCoverage)) powerInputs.ringCoverage = 0;
        if (!Number.isFinite(powerInputs.sigilCertainty)) powerInputs.sigilCertainty = renderShape(null);
        if (spellOutput.textContent === SPELL_PLACEHOLDER) spellOutput.textContent = '呪文を読み取れませんでした。';
        renderPower();
        structureReady = true;
        spellReady = true;
        updateResultVisibility();
        setImageBusy(false);
        setStatus(cameraStatus, '写し絵の一部を読み取れず、得られた情報で威力に反映しました。');
        setStatus(modelStatus, '読み取り結果から相を選び、結果を表示しました。');
        activeAnalysisJob = null;
        publishDiagnostics();
      }
    };
    if (sourceImage) {
      await processImage();
    } else {
      image.onload = processImage;
      image.onerror = () => {
        if (source) URL.revokeObjectURL(source);
        if (!isActiveAnalysisJob(job)) return;
        activeAnalysisJob = null;
        setImageBusy(false);
        setStatus(cameraStatus, '写し絵を読み込めませんでした。別の画像を選んでください。', 'error');
      };
      image.src = source;
    }
  }

  async function preloadOcr() {
    try {
      setStatus(preloadStatus, '呪文の判定器を準備しています…', 'busy');
      await ensureGutenOcr();
      setStatus(preloadStatus, '呪文の判定器を用意しました。', 'good');
    } catch (error) {
      setStatus(preloadStatus, `呪文の判定器を用意できませんでした。${error.message}`, 'error');
    }
  }

  fileInput.addEventListener('click', () => {
    userStartedImageAction = true;
    cancelActiveAnalysis('写し絵の選定を始める');
  });
  fileInput.addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    loadFile(file);
  });
  detailsChapter.querySelector('summary').addEventListener('click', () => {
    if (!circleDetailPage.hidden && !spellDetailPage.hidden) return;

    detailsTapCount += 1;
    clearTimeout(detailsTapTimer);
    if (detailsTapCount >= 7) {
      detailsTapCount = 0;
      detailsTapTimer = null;
      circleDetailPage.hidden = false;
      spellDetailPage.hidden = false;
      window.setTimeout(() => { detailsChapter.open = true; }, 0);
      return;
    }
    detailsTapTimer = window.setTimeout(() => {
      detailsTapCount = 0;
      detailsTapTimer = null;
    }, 1200);
  });
  cameraButton.addEventListener('click', async () => {
    userStartedImageAction = true;
    cancelActiveAnalysis('写し絵の撮影を始める');
    if (cameraStream) {
      if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
        setStatus(cameraStatus, 'カメラ映像の準備ができていません。', 'error');
        return;
      }
      cameraButton.disabled = true;
      const snapshot = document.createElement('canvas');
      const side = Math.min(cameraVideo.videoWidth, cameraVideo.videoHeight);
      const cropX = (cameraVideo.videoWidth - side) / 2;
      const cropY = (cameraVideo.videoHeight - side) / 2;
      snapshot.width = side;
      snapshot.height = side;
      snapshot.getContext('2d').drawImage(cameraVideo, cropX, cropY, side, side, 0, 0, side, side);
      stopCamera();
      loadFile(null, snapshot);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(cameraStatus, 'このブラウザではカメラを利用できません。画像を選定してください。', 'error');
      return;
    }
    resetResults();
    cameraButton.disabled = true;
    setStatus(cameraStatus, 'カメラを起動しています…', 'busy');
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      cameraVideo.srcObject = cameraStream;
      cameraVideo.classList.remove('hidden');
      await cameraVideo.play();
      stageEmpty.hidden = true;
      cameraButton.textContent = '撮影';
      cameraButton.disabled = false;
      setStatus(cameraStatus, '写し絵を中央に合わせて「撮影」を押してください。');
    } catch (error) {
      stopCamera();
      const message = error.name === 'NotAllowedError'
        ? 'カメラの使用が許可されませんでした。ブラウザの設定を確認するか、画像を選定してください。'
        : `カメラを起動できませんでした。${error.message || ''}`;
      setStatus(cameraStatus, message, 'error');
    }
  });
  window.addEventListener('resize', drawOverlay);
  window.addEventListener('beforeunload', () => {
    stopCamera();
    analysisWorker?.terminate();
  });
  preloadOcr();
  const testImage = diagnostics && new URLSearchParams(global.location.search).get('test-image');
  const defaultImage = testImage ? new URL(testImage, global.location.href) : new URL('assets/images/sample.png', global.location.href);
  if (testImage && defaultImage.origin !== global.location.origin) {
    diagnostics.image = { error: '比較用画像は同一オリジンから読み込んでください。' };
    publishDiagnostics();
  } else {
    fetch(defaultImage).then(response => {
      if (!response.ok) throw new Error(`画像を読み込めません: ${response.status}`);
      return response.blob();
    }).then(blob => {
      if (userStartedImageAction) return;
      return loadFile(new File([blob], defaultImage.pathname.split('/').at(-1) || 'sample.png', { type: blob.type || 'image/png' }));
    })
      .catch(error => {
        if (userStartedImageAction) return;
        if (diagnostics) {
          diagnostics.image = { error: error.message };
          publishDiagnostics();
        } else {
          setStatus(cameraStatus, '初期画像 sample.png を読み込めませんでした。画像を選定してください。', 'error');
        }
      });
  }
}(globalThis));

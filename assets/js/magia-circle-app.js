(function startMagiaCircleApp(global) {
  'use strict';

  const core = global.SpellOcrCore;
  if (!core) throw new Error('spell-ocr.js must load before magia-circle-app.js');
  const imageAnalysis = global.ImageAnalysisCore;
  if (!imageAnalysis) throw new Error('image-analysis-core.js must load before magia-circle-app.js');
  const powerCalculation = global.PowerCalculationCore;
  if (!powerCalculation) throw new Error('power-calculation.js must load before magia-circle-app.js');
  const imagePipeline = global.MagiaImagePipeline;
  if (!imagePipeline) throw new Error('magia-image-pipeline.js must load before magia-circle-app.js');

  const MODEL_ID = imagePipeline.ATTRIBUTE_MODEL_ID;
  const KOTODAMA_NGRAM_INDEX_CACHE_URL = 'https://kotodamagia.local/cache/scowl-en-us-common-ngrams-v2.json';
  const SPELL_PLACEHOLDER = '写し絵を選ぶと、刻まれた呪文がここへ現れます。';
  const ATTRIBUTES = global.AttributeScoringCore.attributes;

  function countDictionaryEntries(text) {
    return String(text || '').split(/\r?\n/).filter(line => /^[a-z]+$/i.test(line.trim())).length;
  }

  function isValidVocabularyIndex(index) {
    return index?.version === 2 && typeof index.signature === 'string' &&
      Array.isArray(index.words) && index.words.length >= 100000 &&
      Array.isArray(index.bigrams) && index.bigrams.length > 100 &&
      Array.isArray(index.trigrams) && index.trigrams.length > 100 &&
      Array.isArray(index.bigramCounts) && index.bigramCounts.length === index.words.length &&
      Array.isArray(index.trigramCounts) && index.trigramCounts.length === index.words.length;
  }

  async function validateOcrCacheEntry(url, response) {
    if (url !== core.config.dictionaryUrl) return true;
    const entries = (await response.text()).split(/\r?\n/).filter(line => line.trim());
    return entries.length >= 1000 && entries.every(entry => entry.length <= 4);
  }

  async function validateKotodamaCacheEntry(url, response) {
    if (url === core.config.commonWordsUrl) return countDictionaryEntries(await response.text()) >= 100000;
    if (url === core.config.forbiddenWordsUrl) return countDictionaryEntries(await response.text()) >= 100;
    if (url === KOTODAMA_NGRAM_INDEX_CACHE_URL) {
      try {
        return isValidVocabularyIndex(await response.json());
      } catch { return false; }
    }
    return true;
  }

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
      rawText: diagnostics.spell.rawText,
      words: diagnostics.spell.words,
      corrections: diagnostics.spell.corrections,
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
  const busyMask = requireElement('busyMask');
  const busyTitle = requireElement('busyTitle');
  const busyDetail = requireElement('busyDetail');
  const busyStage = requireElement('busyStage');
  const busyProgress = requireElement('busyProgress');
  const busyPercent = requireElement('busyPercent');
  const retryModels = requireElement('retryModels');
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
  let activeOcrRun = Promise.resolve();
  let activeAttributeRun = Promise.resolve();
  let nextAnalysisJobId = 0;
  let userStartedImageAction = false;
  let cameraStream = null;
  let textDetectorPromise = null;
  let releaseOcrCvResources = null;
  let ocrCvResourcesTracked = false;
  let recognizerPromise = null;
  let embeddingModulePromise = null;
  let extractorPromise = null;
  let extractor = null;
  let startupPromise = null;
  let modelsReady = false;
  let cacheUnavailable = false;
  let vocabularyCorrector = null;
  const cacheError = error => {
    cacheUnavailable = true;
    console.warn('外典の控えを保存・参照できませんでした。', error);
  };
  const ocrCache = global.ModelCache.create({
    name: 'magia-circle-ocr-models-v1',
    onCacheError: cacheError,
    validate: validateOcrCacheEntry,
    onProgress: info => {
      if (info.status === 'cache') showBusyMask('魔導司書が完成写本の控えを開いている', 'すでに写し終えた頁を、静かに卓上へ広げている。');
      if (info.status === 'download') showBusyMask('魔導司書が遠い書庫へ向かっている', '星明かりの回廊を渡り、外典の束を一冊ずつ運んでいる。');
      if (info.status === 'progress') {
        const amount = `${(info.loaded / 1024 / 1024).toFixed(1)} MB`;
        showBusyMask('魔導司書が遠い書庫へ向かっている', `星明かりの回廊を渡り、外典の束を一冊ずつ運んでいる。 ${amount}`, info.total ? info.loaded / info.total * 100 : null);
      }
      if (info.status === 'done') showBusyMask('魔導司書が頁を読んでいる', '運び終えた頁を、静かに卓上へ広げている。');
    },
  });
  // Keep the Transformers.js cache name so earlier visits remain reusable.
  const embeddingCache = global.ModelCache.create({ name: 'transformers-cache', onCacheError: cacheError });
  const kotodamaDictionaryCache = global.ModelCache.create({
    name: 'magia-circle-kotodama-dictionaries-v1',
    onCacheError: cacheError,
    validate: validateKotodamaCacheEntry,
  });
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

  function releaseAnalysisSource(job) {
    if (job.sourceUrl) {
      URL.revokeObjectURL(job.sourceUrl);
      job.sourceUrl = null;
    }
    const image = job.sourceImage;
    if (!image) return;
    image.onload = null;
    image.onerror = null;
    if (image instanceof HTMLCanvasElement) {
      image.width = 1;
      image.height = 1;
    } else {
      image.removeAttribute('src');
    }
    job.sourceImage = null;
  }

  function cancelActiveAnalysis(reason) {
    const job = activeAnalysisJob;
    if (!job) return;

    job.controller.abort(makeAnalysisAbortError(`${reason}ため、解析を中断しました。`));
    activeAnalysisJob = null;
    releaseAnalysisSource(job);
    if (analysisPending?.job === job) {
      const pending = analysisPending;
      analysisPending = null;
      terminateAnalysisWorker(pending.worker);
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
      sourceUrl: null,
      sourceImage: null,
    };
    activeAnalysisJob = job;
    return job;
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
  }

  function showBusyMask(title, detail, percent = null) {
    busyTitle.textContent = title;
    busyDetail.textContent = detail;
    if (Number.isFinite(percent)) {
      busyProgress.value = Math.max(0, Math.min(100, percent));
      busyPercent.textContent = `${busyProgress.value.toFixed(1)}%`;
    } else {
      busyProgress.removeAttribute('value');
      busyPercent.textContent = '頁を読み解いている…';
    }
  }

  function resetPowerInputs() {
    powerInputs.circleAccuracy = null;
    powerInputs.lineStraightness = null;
    powerInputs.ringCoverage = null;
    powerInputs.attributeCertainty = null;
    powerInputs.sigilCertainty = null;
    powerInputs.wordCount = null;
  }

  function renderPower(precomputed = null) {
    const ready = Object.values(powerInputs).every(value => Number.isFinite(value));
    if (!ready) {
      powerResult.className = 'result-empty';
      powerResult.innerHTML = '<div class="altar-placeholder">共鳴率が揃うと、威力が現れます。</div>';
      powerDetail.className = 'detail-result result-empty';
      powerDetail.textContent = '威力の内訳は、すべての共鳴率が揃うと現れます。';
      return;
    }
    const result = precomputed || powerCalculation.calculatePower(powerInputs);
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

  function terminateAnalysisWorker(worker = analysisWorker) {
    if (!worker) return;
    if (analysisWorker === worker) analysisWorker = null;
    worker.terminate();
  }

  function failAnalysisWorker(worker, error) {
    if (analysisWorker !== worker) return;
    const pending = analysisPending;
    if (!pending || pending.worker !== worker) {
      terminateAnalysisWorker(worker);
      return;
    }
    analysisPending = null;
    terminateAnalysisWorker(worker);
    if (!isActiveAnalysisJob(pending.job)) {
      pending.reject(pending.job.signal.reason || makeAnalysisAbortError());
      return;
    }
    pending.fallback(error);
  }

  function ensureAnalysisWorker() {
    const worker = new Worker(new URL('assets/js/image-analysis-worker.js', document.baseURI));
    analysisWorker = worker;
    worker.addEventListener('message', event => {
      if (analysisWorker !== worker) return;
      const message = event.data || {};
      const pending = analysisPending;
      if (!pending || pending.worker !== worker || message.jobId !== pending.job.id) return;
      if (message.type === 'progress') {
        if (!isActiveAnalysisJob(pending.job)) return;
        setStatus(cameraStatus, message.stage, 'busy');
        setStatus(modelStatus, message.stage, 'busy');
        return;
      }
      analysisPending = null;
      terminateAnalysisWorker(worker);
      if (!isActiveAnalysisJob(pending.job)) {
        pending.reject(pending.job.signal.reason || makeAnalysisAbortError());
        return;
      }
      if (message.type === 'success') pending.resolve(message);
      else pending.fallback(new Error(message.message || 'Unexpected worker response'));
    });
    worker.addEventListener('error', event => {
      const detail = event.error?.message || event.message || 'Worker error';
      failAnalysisWorker(worker, new Error(`画像処理の眼を呼び出せませんでした。${detail}`));
    });
    worker.addEventListener('messageerror', () => {
      failAnalysisWorker(worker, new Error('Workerの解析結果を読み取れませんでした。'));
    });
    return worker;
  }

  function disposeTensors(tensors) {
    for (const tensor of new Set(Object.values(tensors || {}))) {
      try { tensor?.dispose?.(); } catch (error) { console.warn('解析用テンソルを解放できませんでした。', error); }
    }
  }

  function createAnalysisImage() {
    return imagePipeline.createAnalysisInput({
      width: captureCanvas.width,
      height: captureCanvas.height,
      read: () => captureContext.getImageData(0, 0, captureCanvas.width, captureCanvas.height),
      resize: (width, height) => {
        const scratch = document.createElement('canvas');
        scratch.width = width;
        scratch.height = height;
        try {
          const context = scratch.getContext('2d', { willReadFrequently: true });
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(captureCanvas, 0, 0, width, height);
          return context.getImageData(0, 0, width, height);
        } finally {
          scratch.width = 1;
          scratch.height = 1;
        }
      },
    });
  }

  function analyzeImageOnMain(job, suppliedAnalysisImage = null) {
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        let image;
        try {
          assertActiveAnalysisJob(job);
          setStatus(cameraStatus, '画像処理の眼を軽く整えています…', 'busy');
          await yieldToBrowser();
          assertActiveAnalysisJob(job);
          const analysisImage = suppliedAnalysisImage || await createAnalysisImage();
          image = analysisImage.image;
          const structure = imagePipeline.analyzeStructure(image.data.buffer, image.width, image.height);
          setStatus(cameraStatus, '閉じたパスを読み取っています…', 'busy');
          await yieldToBrowser();
          assertActiveAnalysisJob(job);
          resolve(structure);
        } catch (error) {
          reject(error);
        } finally {
          image = null;
        }
      }, 0);
    });
  }

  async function analyzeImageInWorker(job, analysisImage) {
    assertActiveAnalysisJob(job);
    if (global.location?.protocol === 'file:') return analyzeImageOnMain(job, analysisImage);
    let worker;
    return new Promise((resolve, reject) => {
      const fallback = error => {
        if (!isActiveAnalysisJob(job)) {
          reject(job.signal.reason || makeAnalysisAbortError());
          return;
        }
        console.warn('構造解析Workerを使えず、master画像からImageDataを再生成します。', error);
        createAnalysisImage().then(image => analyzeImageOnMain(job, image), reject).then(resolve, reject);
      };
      const pending = {
        job,
        resolve,
        reject,
        fallback,
        worker: null,
      };
      try {
        worker = ensureAnalysisWorker();
        pending.worker = worker;
        analysisPending = pending;
        assertActiveAnalysisJob(job);
        const transferable = analysisImage.image.data.buffer;
        worker.postMessage({ jobId: job.id, width: analysisImage.image.width, height: analysisImage.image.height, buffer: transferable }, [transferable]);
        analysisImage = null;
      } catch (error) {
        analysisPending = null;
        terminateAnalysisWorker(worker);
        analysisImage = null;
        fallback(error);
      }
    });
  }

  function showCaptureCanvas() {
    stage.classList.add('captured');
    stageEmpty.hidden = true;
    captureCanvas.classList.remove('hidden');
    setImageBusy(true);
  }

  function canvasFromImage(image) {
    const dimensions = imagePipeline.fitInputDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);
    captureCanvas.width = dimensions.width;
    captureCanvas.height = dimensions.height;
    captureContext.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    captureContext.drawImage(image, 0, 0, captureCanvas.width, captureCanvas.height);
    showCaptureCanvas();
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
    const scale = Math.min(1, 1200 / Math.max(captureCanvas.width, captureCanvas.height, 1));
    overlayCanvas.width = Math.max(1, Math.round(captureCanvas.width * scale));
    overlayCanvas.height = Math.max(1, Math.round(captureCanvas.height * scale));
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (captureCanvas.width && captureCanvas.height) overlayContext.drawImage(captureCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
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
        const x = (path.x + Math.cos(theta) * radius) * scale;
        const y = (path.y + Math.sin(theta) * radius) * scale;
        if (index === 0) overlayContext.moveTo(x, y);
        else overlayContext.lineTo(x, y);
      }
      overlayContext.closePath();
      overlayContext.stroke();
    }
    overlayContext.setLineDash([]);
    overlayContext.restore();
  }

  function renderShape(value) {
    const sigil = value?.rates ? value : imagePipeline.scoreSigil(value || imagePipeline.DEFAULT_SIGIL_SCORES);
    const names = { attack: '攻撃の紋', defense: '防御の紋', support: '回復の紋', debuff: '弱体の紋' };
    const icons = { attack: '⚔️', defense: '🛡️', support: '✚', debuff: '🕸️' };
    const rates = sigil.rates;
    const percentages = new Map(Object.entries(sigil.percentages));
    const top = [sigil.top, sigil.certainty];
    if (diagnostics) diagnostics.sigil = { top: sigil.top, rates, percentages: sigil.percentages };
    shapeResult.className = 'altar-result altar-result--shape';
    shapeResult.innerHTML = `<span class="altar-symbol">${icons[top[0]]}</span><div><div class="altar-kicker">最も共鳴した紋</div><strong class="altar-value">${names[top[0]].replace('の紋', '')}</strong></div>`;
    shapeDetail.className = 'detail-result';
    shapeDetail.innerHTML = `<div class="shape-title"><b>${icons[top[0]]} ${names[top[0]]}</b></div><div class="bars">${rates.map(([key]) => { const percentage = percentages.get(key); return `<div class="bar-row"><span>${icons[key]} ${names[key]}</span><div class="bar"><span style="width:${percentage}%"></span></div><strong>${percentage}%</strong></div>`; }).join('')}</div>`;
    return top[1];
  }

  function renderAttribute(attribute) {
    const rates = attribute.rates;
    const top = rates[0];
    if (!top || attribute.error) return renderAttributeFallback(attribute.error);
    if (diagnostics) diagnostics.attribute = { top: attribute.top, rates, similarities: attribute.similarities };
    attributeResult.className = 'altar-result altar-result--attribute';
    attributeResult.innerHTML = `<span class="altar-symbol">${ATTRIBUTES[top[0]].icon}</span><div><div class="altar-kicker">最も共鳴した相</div><strong class="altar-value">${ATTRIBUTES[top[0]].label}</strong></div>`;
    attributeDetail.className = 'detail-result';
    attributeDetail.innerHTML = `<div class="shape-title"><b>${ATTRIBUTES[top[0]].icon} ${ATTRIBUTES[top[0]].label}</b></div><div class="bars">${rates.map(([key, , percentage]) => `<div class="bar-row attribute-detail-row"><span>${ATTRIBUTES[key].icon} ${ATTRIBUTES[key].label}</span><div class="bar"><span style="width:${percentage}%"></span></div><strong>${percentage.toFixed(1)}%</strong></div>`).join('')}</div>`;
    setStatus(modelStatus, '呪文の相がひとつ、頁の上に現れた。', 'good');
    return attribute.certainty;
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
      let session;
      try {
        session = await ort.InferenceSession.create(await (await ocrCache.load(core.config.recognitionModelUrl)).arrayBuffer());
        const dictionary = [...(await (await ocrCache.load(core.config.dictionaryUrl)).text()).split('\n'), ' '];
        return { ort, session, dictionary };
      } catch (error) {
        if (session) {
          try { await session.release(); }
          catch (releaseError) { console.warn('OCR認識モデルの初期化失敗後にSessionを解放できませんでした。', releaseError); }
        }
        throw error;
      }
    })();
    recognizerPromise.catch(() => { recognizerPromise = null; });
    return recognizerPromise;
  }

  async function releaseOcrModels(detector) {
    let recognizer = null;
    if (recognizerPromise) {
      try { recognizer = await recognizerPromise; }
      catch (error) { console.warn('OCR認識モデルの準備に失敗しました。', error); }
    }
    const resources = [...new Set([detector, recognizer?.session].filter(Boolean))];
    let releaseError = null;
    for (const resource of resources) {
      try {
        await resource.release();
      } catch (error) {
        releaseError ||= error;
        console.warn('OCRモデルのONNX Sessionを解放できませんでした。', error);
      }
    }
    textDetectorPromise = null;
    recognizerPromise = null;
    if (releaseError) throw releaseError;
  }

  async function recognizeCanvas(canvas, inferPixelSpaces = false, job) {
    assertActiveAnalysisJob(job);
    const { ort, session, dictionary } = await awaitForAnalysisJob(job, ensureRecognizer());
    assertActiveAnalysisJob(job);
    const height = 48;
    const width = Math.max(48, Math.min(960, Math.round(canvas.width / Math.max(1, canvas.height) * height)));
    let resized = imageAnalysis.resizeRgbaSharpLinear(canvas.data, canvas.width, canvas.height, width, height);
    const pixels = width * height;
    let values = new Float32Array(pixels * 3);
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * 4;
      values[index] = resized[offset + 2] / 255;
      values[pixels + index] = resized[offset + 1] / 255;
      values[pixels * 2 + index] = resized[offset] / 255;
    }
    resized = null;
    await yieldToBrowser();
    assertActiveAnalysisJob(job);
    const input = new ort.Tensor('float32', values, [1, 3, height, width]);
    values = null;
    let outputs;
    try {
      outputs = await session.run({ [session.inputNames[0]]: input });
      assertActiveAnalysisJob(job);
      const output = outputs[session.outputNames[0]];
      const decoded = core.decodeGreedyCtcDetailed(output, dictionary);
      return inferPixelSpaces
        ? { text: decoded.text, spacingText: core.insertSpacesAtPixelGaps(canvas, decoded) }
        : decoded.text;
    } finally {
      disposeTensors({ input });
      disposeTensors(outputs);
    }
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

  async function ensureTextDetector() {
    if (textDetectorPromise) return textDetectorPromise;
    textDetectorPromise = (async () => {
      const cvModule = await import('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/+esm');
      const importedCv = cvModule.default ?? cvModule;
      const cv = importedCv instanceof Promise ? await importedCv : importedCv;
      if (!cv.Mat) await new Promise(resolve => {
        const previous = cv.onRuntimeInitialized;
        cv.onRuntimeInitialized = () => { previous?.(); resolve(); };
      });
      if (!ocrCvResourcesTracked) {
        const cvResources = new Set();
        const trackCvResource = resource => {
          if (!resource || typeof resource.delete !== 'function' || cvResources.has(resource)) return resource;
          const dispose = resource.delete;
          try {
            resource.delete = function (...args) {
              cvResources.delete(resource);
              return dispose.apply(this, args);
            };
            cvResources.add(resource);
          } catch {}
          return resource;
        };
        const trackConstructor = name => {
          const Constructor = cv[name];
          if (typeof Constructor !== 'function') return;
          cv[name] = new Proxy(Constructor, {
            construct(target, args) { return trackCvResource(Reflect.construct(target, args, target)); },
          });
        };
        for (const name of ['Mat', 'MatVector', 'Point', 'Size', 'Scalar']) trackConstructor(name);
        const matVectorGet = cv.MatVector?.prototype?.get;
        if (matVectorGet) {
          cv.MatVector.prototype.get = function (...args) { return trackCvResource(matVectorGet.apply(this, args)); };
        }
        for (const name of ['matFromArray', 'getRotationMatrix2D', 'minAreaRect']) {
          const factory = cv[name];
          if (typeof factory === 'function') {
            cv[name] = function (...args) { return trackCvResource(factory.apply(cv, args)); };
          }
        }
        const getPerspectiveTransform = cv.getPerspectiveTransform;
        if (typeof getPerspectiveTransform === 'function') {
          let warnedAboutPerspectiveBinding = false;
          cv.getPerspectiveTransform = function (source, destination, ...options) {
            try {
              return trackCvResource(getPerspectiveTransform.call(cv, source, destination, ...options));
            } catch (error) {
              if (!(error instanceof TypeError) || !/hasOwnProperty/.test(error.message || '')) throw error;
              if (!warnedAboutPerspectiveBinding) {
                console.warn('OpenCV getPerspectiveTransform overload is unavailable; using an equivalent four-point transform solver.');
                warnedAboutPerspectiveBinding = true;
              }
              const sourcePoints = Array.from(source.data32F || []);
              const destinationPoints = Array.from(destination.data32F || []);
              if (sourcePoints.length < 8 || destinationPoints.length < 8) throw error;
              const equations = [];
              const values = [];
              for (let index = 0; index < 4; index += 1) {
                const x = sourcePoints[index * 2];
                const y = sourcePoints[index * 2 + 1];
                const u = destinationPoints[index * 2];
                const v = destinationPoints[index * 2 + 1];
                if (![x, y, u, v].every(Number.isFinite)) throw error;
                equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
                values.push(u);
                equations.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
                values.push(v);
              }
              const augmented = equations.map((row, index) => [...row, values[index]]);
              for (let column = 0; column < 8; column += 1) {
                let pivot = column;
                for (let row = column + 1; row < 8; row += 1) {
                  if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
                }
                if (Math.abs(augmented[pivot][column]) < 1e-12) throw error;
                [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
                const divisor = augmented[column][column];
                for (let cell = column; cell <= 8; cell += 1) augmented[column][cell] /= divisor;
                for (let row = 0; row < 8; row += 1) {
                  if (row === column) continue;
                  const factor = augmented[row][column];
                  for (let cell = column; cell <= 8; cell += 1) augmented[row][cell] -= factor * augmented[column][cell];
                }
              }
              const coefficients = augmented.map(row => row[8]);
              if (!coefficients.every(Number.isFinite)) throw error;
              const transform = new cv.Mat(3, 3, cv.CV_64F);
              transform.data64F.set([...coefficients, 1]);
              return transform;
            }
          };
        }
        releaseOcrCvResources = () => {
          for (const resource of [...cvResources].reverse()) {
            try { resource.delete(); } catch { cvResources.delete(resource); }
          }
          cvResources.clear();
        };
        ocrCvResourcesTracked = true;
      }
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
    try {
      target.getContext('2d').drawImage(source,0,0,width,height);
      return new BrowserLineImage(target.getContext('2d').getImageData(0,0,width,height));
    } finally {
      source.width=1; source.height=1;
      target.width=1; target.height=1;
    }
  }
}`;
      const patchedSource = support + splitSource
        .replace('from"/npm/@techstark/opencv-js@4.9.0-release.3/+esm"', 'from"https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.3/+esm"')
        .replace('from"/npm/js-clipper@1.0.1/+esm"', 'from"https://cdn.jsdelivr.net/npm/js-clipper@1.0.1/+esm"')
        .replace('let v;', 'let v=BrowserLineImage;');
      const splitUrl = URL.createObjectURL(new Blob([patchedSource], { type: 'text/javascript' }));
      let splitModule;
      try { splitModule = await import(splitUrl); }
      finally { URL.revokeObjectURL(splitUrl); }
      const { splitIntoLineImages } = splitModule;
      const ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/+esm`);
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${core.config.onnxRuntimeWebVersion}/dist/`;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = true;
      class BrowserImageRaw {
        constructor({ data, width, height }) { this.data = data instanceof Uint8ClampedArray ? data : Uint8ClampedArray.from(data); this.width = width; this.height = height; }
        async resize({ width, height }) {
          return new BrowserImageRaw({ data: imageAnalysis.resizeRgbaSharpContain(this.data, this.width, this.height, width, height), width, height });
        }
        async write() {}
        async drawBox() { return this; }
        static async open(url) {
          if (url instanceof HTMLCanvasElement) {
            return new BrowserImageRaw(url.getContext('2d').getImageData(0, 0, url.width, url.height));
          }
          const image = new Image();
          let canvas;
          try {
            image.src = url;
            await image.decode();
            canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            canvas.getContext('2d').drawImage(image, 0, 0);
            return new BrowserImageRaw(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
          } finally {
            if (canvas) { canvas.width = 1; canvas.height = 1; }
            image.removeAttribute('src');
          }
        }
      }
      // Only text boxes are needed here; the app handles line recognition with its shared session.
      const detectionSession = await ort.InferenceSession.create(await (await ocrCache.load(core.config.detectionModelUrl)).arrayBuffer());
      return {
        async release() {
          await detectionSession.release();
        },
        async detect(source) {
          let image;
          let inputImage;
          let outputImage;
          let input;
          let outputs;
          try {
            image = await BrowserImageRaw.open(source);
            const width = Math.max(32, Math.ceil(image.width / 32) * 32);
            const height = Math.max(32, Math.ceil(image.height / 32) * 32);
            inputImage = width === image.width && height === image.height
              ? image
              : await image.resize({ width, height });
            const pixels = inputImage.width * inputImage.height;
            let values = new Float32Array(pixels * 3);
            for (let index = 0; index < pixels; index += 1) {
              const offset = index * 4;
              values[index] = inputImage.data[offset + 2] / 255;
              values[pixels + index] = inputImage.data[offset + 1] / 255;
              values[pixels * 2 + index] = inputImage.data[offset] / 255;
            }
            input = new ort.Tensor('float32', values, [1, 3, inputImage.height, inputImage.width]);
            values = null;
            outputs = await detectionSession.run({ [detectionSession.inputNames[0]]: input });
            disposeTensors({ input });
            input = null;
            const modelOutput = outputs[detectionSession.outputNames[0]];
            const outputHeight = modelOutput.dims[2];
            const outputWidth = modelOutput.dims[3];
            const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);
            for (let index = 0; index < modelOutput.data.length; index += 1) {
              const value = modelOutput.data[index] > 0.03 ? 255 : 0;
              const offset = index * 4;
              data[offset] = value;
              data[offset + 1] = value;
              data[offset + 2] = value;
              data[offset + 3] = 255;
            }
            outputImage = new BrowserImageRaw({ data, width: outputWidth, height: outputHeight });
            disposeTensors(outputs);
            outputs = null;
            const lineImages = await splitIntoLineImages(outputImage, inputImage);
            return { lineImages, resizedImageWidth: inputImage.width, resizedImageHeight: inputImage.height };
          } finally {
            disposeTensors(outputs);
            disposeTensors({ input });
            if (image) image.data = new Uint8ClampedArray(0);
            if (inputImage) inputImage.data = new Uint8ClampedArray(0);
            if (outputImage) outputImage.data = new Uint8ClampedArray(0);
            releaseOcrCvResources?.();
          }
        },
      };
    })();
    textDetectorPromise.catch(() => { textDetectorPromise = null; });
    return textDetectorPromise;
  }

  async function recognizeSpell(canvas, job) {
    const recognition = (async () => {
      let detector;
      try {
        detector = await ensureTextDetector();
        assertActiveAnalysisJob(job);
        return await core.run({
          detect: async () => {
            assertActiveAnalysisJob(job);
            const detected = await detector.detect(canvas);
            assertActiveAnalysisJob(job);
            const lineImages = detected.lineImages || [];
            const additionalLineImages = lineImages.length <= 8
              ? function* () {
                const sourcePixels = captureContext.getImageData(0, 0, captureCanvas.width, captureCanvas.height);
                yield* core.iterateRingSectors(sourcePixels);
              }
              : null;
            return { ...detected, lineImages, additionalLineImages };
          },
          recognizeVariants: line => recognizeBrowserLineVariants(line, job),
          combineLines: combineSpellLineImages,
          vocabularyCorrector,
          releaseLinePixelsAfterRecognition: true,
          signal: job.signal,
        });
      } finally {
        await releaseOcrModels(detector);
      }
    })();
    activeOcrRun = recognition.then(() => undefined, () => undefined);
    return await awaitForAnalysisJob(job, recognition);
  }

  async function ensureExtractor(job) {
    if (extractor) return extractor;
    if (!extractorPromise) {
      extractorPromise = (async () => {
        if (!embeddingModulePromise) {
          embeddingModulePromise = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
          embeddingModulePromise.catch(() => { embeddingModulePromise = null; });
        }
        const { env, pipeline } = await embeddingModulePromise;
        env.allowLocalModels = false;
        env.useCustomCache = true;
        env.customCache = embeddingCache;
        const wasm = env.backends?.onnx?.wasm;
        if (wasm) {
          wasm.numThreads = 1;
          wasm.proxy = true;
        }
        if (isActiveAnalysisJob(job)) setStatus(modelStatus, '呪文の相を測る準備をしています…', 'busy');
        extractor = await pipeline('feature-extraction', MODEL_ID, {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: info => {
            if (!isActiveAnalysisJob(job)) return;
            // Transformers reports download/progress even when reading a cached file.
            if (info.file?.endsWith('.onnx') && info.status === 'progress') {
              showBusyMask('魔導司書が頁を読んでいる', '相の外典をひらき、言霊を一つずつ灯している…', info.progress);
            }
            if (info.file?.endsWith('.onnx') && info.status === 'done') {
              showBusyMask('魔導司書が頁を読んでいる', '相の核を整えている。燭台の火が落ち着くのを待て。');
            }
          },
        });
        return extractor;
      })();
      extractorPromise.catch(() => { extractorPromise = null; });
    }
    return extractorPromise;
  }

  async function releaseExtractor(model) {
    if (extractor === model) {
      extractor = null;
      extractorPromise = null;
    }
    await model.dispose();
  }

  function renderAttributeFallback(error = null) {
    const fallback = imagePipeline.fallbackAttribute(error);
    const [top] = fallback.rates;
    attributeResult.className = 'altar-result altar-result--attribute';
    attributeResult.innerHTML = `<span class="altar-symbol">${ATTRIBUTES[top[0]].icon}</span><div><div class="altar-kicker">最も共鳴した相</div><strong class="altar-value">${ATTRIBUTES[top[0]].label}</strong></div>`;
    attributeDetail.className = 'detail-result';
    attributeDetail.innerHTML = `<div class="shape-title"><b>${ATTRIBUTES[top[0]].icon} ${ATTRIBUTES[top[0]].label}</b></div><div class="bars">${fallback.rates.map(([key]) => `<div class="bar-row attribute-detail-row"><span>${ATTRIBUTES[key].icon} ${ATTRIBUTES[key].label}</span><div class="bar"><span style="width:0%"></span></div><strong>0%</strong></div>`).join('')}</div><p class="note">呪文から相を判定できませんでした。</p>`;
    setStatus(modelStatus, '相を判定できませんでした。', 'error');
    if (diagnostics) diagnostics.attribute = { top: top[0], rates: fallback.rates, fallback: true, error: fallback.error };
    return 0;
  }

  function resetResults({ preserveCaptureCanvas = false } = {}) {
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
    if (!preserveCaptureCanvas) {
      captureCanvas.width = 1;
      captureCanvas.height = 1;
    }
    overlayCanvas.width = 1;
    overlayCanvas.height = 1;
    setImageBusy(false);
    stage.classList.remove('captured');
    stageEmpty.hidden = false;
  }

  async function loadFile(file, sourceImage = null, options = {}) {
    const { captureReady = false, sourceWidth, sourceHeight } = options;
    if (!modelsReady) return;
    if (!file && !sourceImage && !captureReady) return;
    cancelActiveAnalysis('新しい写し絵の解析を始める');
    const job = beginAnalysisJob(file);
    setStatus(cameraStatus, '写し絵を読み込んでいます…', 'busy');
    setStatus(modelStatus, '画像から紋の情報を準備しています…', 'busy');
    const image = sourceImage || (captureReady ? null : new Image());
    const source = file ? URL.createObjectURL(file) : null;
    job.sourceImage = image;
    job.sourceUrl = source;
    const processImage = async () => {
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
      if (job.sourceUrl) {
        URL.revokeObjectURL(job.sourceUrl);
        job.sourceUrl = null;
      }
      if (!isActiveAnalysisJob(job)) return;
      try {
        assertActiveAnalysisJob(job);
        // A canceled ONNX run cannot be interrupted; wait for its underlying work
        // to settle before replacing the shared canvas or starting another run.
        await awaitForAnalysisJob(job, Promise.all([activeOcrRun, activeAttributeRun]));
        assertActiveAnalysisJob(job);
        resetResults({ preserveCaptureCanvas: captureReady });
        if (captureReady) showCaptureCanvas();
        else canvasFromImage(image);
        await yieldToBrowser();
        assertActiveAnalysisJob(job);
        if (diagnostics) diagnostics.image = {
          naturalWidth: sourceWidth || image?.naturalWidth || image?.width || captureCanvas.width,
          naturalHeight: sourceHeight || image?.naturalHeight || image?.height || captureCanvas.height,
          canvasWidth: captureCanvas.width,
          canvasHeight: captureCanvas.height,
        };
        if (image) {
          if (image instanceof HTMLCanvasElement) {
            image.width = 1;
            image.height = 1;
          } else {
            image.removeAttribute('src');
          }
          job.sourceImage = null;
        }
        let attributeModel = null;
        const pipelineTask = imagePipeline.run({
            recognizeSpell: async () => {
              setStatus(modelStatus, '環の呪文を読み取っています…', 'busy');
              return recognizeSpell(captureCanvas, job);
            },
            onRecognitionRetry: ({ attempt, error, empty }) => {
              if (error) console.warn('呪文のOCRに失敗したため、同じ画像で読み直します。', error);
              const reason = error ? '解析エラー' : empty ? '呪文が空' : '認識結果なし';
              appendProcessingRecord(`${job.fileName}：${reason}のため、解像度を変えずにOCRを再試行します（${attempt + 1}/2）。`);
              setStatus(modelStatus, '呪文を読み取れなかったため、同じ画像をもう一度読みます…', 'busy');
            },
            getStructureInput: async () => {
              setStatus(cameraStatus, '写し絵を受け取り、閉じたパスと環内の文字位置を調べています…', 'busy');
              return { analysis: await createAnalysisImage() };
            },
            analyzeStructure: analysis => analyzeImageInWorker(job, analysis),
            getMasterImage: () => captureContext.getImageData(0, 0, captureCanvas.width, captureCanvas.height),
            embedAttributes: async text => {
              setStatus(modelStatus, '呪文の相を測る準備をしています…', 'busy');
              attributeModel = await ensureExtractor(job);
              assertActiveAnalysisJob(job);
              await yieldToBrowser();
              assertActiveAnalysisJob(job);
              return attributeModel(imagePipeline.attributeInputTexts(text), { pooling: 'mean', normalize: true });
            },
            releaseAttributeModel: async () => {
              if (attributeModel) await releaseExtractor(attributeModel);
              attributeModel = null;
            },
            signal: job.signal,
          });
        activeAttributeRun = pipelineTask.then(
          () => undefined,
          error => {
            if (isActiveAnalysisJob(job)) console.warn('画像解析後の相判定またはリソース解放に失敗しました。', error);
            return undefined;
          },
        );
        const result = await awaitForAnalysisJob(job, pipelineTask);
        assertActiveAnalysisJob(job);
        const recognition = result.spell;
        const path = recognition?.path;
        if (diagnostics) diagnostics.spell = {
          text: path?.text || '',
          words: path?.words || [],
          points: path?.points || [],
          lines: (recognition?.lineImages || []).map((line, index) => ({ index, box: line.box, width: line.image?.width, height: line.image?.height })),
          rawCandidates: recognition?.rawCandidates || [],
          candidates: recognition?.candidates || [],
          rawText: recognition?.rawPathText || path?.text || '',
          corrections: recognition?.corrections || [],
          error: recognition?.error || null,
        };
        const text = path?.text || '';
        detectedPaths = result.structure.paths;
        drawOverlay();
        powerInputs.wordCount = result.wordCount;
        powerInputs.circleAccuracy = result.power.normalized.circleAccuracy;
        powerInputs.lineStraightness = result.power.normalized.lineStraightness;
        powerInputs.ringCoverage = result.power.normalized.ringCoverage;
        powerInputs.attributeCertainty = result.attribute.certainty;
        powerInputs.sigilCertainty = result.sigil.certainty;
        renderShape(result.sigil);
        const structure = result.structure;
        if (diagnostics) diagnostics.circle = {
          paths: structure.paths,
          lineStraightness: structure.lineStraightness,
          ringCoverage: structure.ringCoverage,
          sigilScores: structure.sigil.scores,
          ...(structure.error ? { error: structure.error } : {}),
        };
        renderAttribute(result.attribute);
        spellOutput.textContent = text || '環から呪文を読み取れませんでした。';
        if (recognition?.error) {
          console.error('OCRを2回試しましたが読み取れませんでした。', recognition.error);
          setStatus(modelStatus, '呪文を読み取れませんでした。認識結果なしで相を判定しました。', 'error');
        } else if (!text) {
          setStatus(modelStatus, '呪文を読み取れませんでした。認識結果なしで相を判定しました。');
        }
        renderPower(result.power);
        structureReady = true;
        spellReady = true;
        updateResultVisibility();
        setImageBusy(false);
        setStatus(cameraStatus, structure.error
          ? '陣の一部を読み取れませんでした。得られた情報で威力を計算しました。'
          : '紋の読み取りが完了しました。', structure.error ? '' : 'good');
        activeAnalysisJob = null;
        publishDiagnostics();
      } catch (error) {
        releaseAnalysisSource(job);
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
    if (sourceImage || captureReady) {
      await processImage();
    } else {
      image.onload = processImage;
      image.onerror = () => {
        releaseAnalysisSource(job);
        if (!isActiveAnalysisJob(job)) return;
        activeAnalysisJob = null;
        setImageBusy(false);
        setStatus(cameraStatus, '写し絵を読み込めませんでした。別の画像を選んでください。', 'error');
      };
      image.src = source;
    }
  }

  async function prepareModels() {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      fileInput.disabled = true;
      cameraButton.disabled = true;
      retryModels.hidden = true;
      busyMask.classList.remove('is-error');
      busyProgress.hidden = false;
      if (!busyMask.open) busyMask.showModal();
      busyMask.focus();
      showBusyMask('魔導司書が外典を探している', '頁に触れず、燭台の火が落ち着くのを待て。');
      setStatus(preloadStatus, '魔導司書が外典を整えている。', 'busy');
      let kotodamaDictionariesUnavailable = false;
      try {
        busyStage.textContent = '一 / 三 — 環の筆跡を読む外典';
        await ensureTextDetector();
        busyStage.textContent = '二 / 三 — 呪文を読み解く外典';
        await ensureRecognizer();
        busyStage.textContent = '三 / 三 — 禁書目録と正典目録';
        showBusyMask('魔導司書が目録を集めている', 'コトダマギアと共有する禁書目録と正典目録を、この書架にも控えている。');
        const dictionaryResults = await Promise.allSettled([
          kotodamaDictionaryCache.load(core.config.forbiddenWordsUrl),
          kotodamaDictionaryCache.load(core.config.commonWordsUrl),
        ]);
        kotodamaDictionariesUnavailable = dictionaryResults.some(result => result.status === 'rejected');
        if (dictionaryResults.every(result => result.status === 'fulfilled')) {
          try {
            const [forbiddenText, commonText] = await Promise.all(dictionaryResults.map(result => result.value.text()));
            const signature = core.vocabularySignature(commonText, forbiddenText);
            const cachedIndexResponse = await kotodamaDictionaryCache.match(KOTODAMA_NGRAM_INDEX_CACHE_URL);
            let index = null;
            if (cachedIndexResponse) {
              try {
                const cachedIndex = await cachedIndexResponse.json();
                if (isValidVocabularyIndex(cachedIndex) && cachedIndex.signature === signature) {
                  index = cachedIndex;
                } else {
                  await kotodamaDictionaryCache.delete(KOTODAMA_NGRAM_INDEX_CACHE_URL);
                }
              } catch (error) {
                await kotodamaDictionaryCache.delete(KOTODAMA_NGRAM_INDEX_CACHE_URL);
                console.warn('文字列索引の控えを読み取れませんでした。', error);
              }
            }
            if (!index) {
              await yieldToBrowser();
              index = core.createVocabularyNgramIndex(commonText, forbiddenText);
              const candidate = core.createVocabularyCorrector(index);
              if (!isValidVocabularyIndex(index) || candidate.size < 100000) {
                throw new Error('一般語彙辞書に使用できる単語が不足しています。');
              }
              await kotodamaDictionaryCache.put(KOTODAMA_NGRAM_INDEX_CACHE_URL, new Response(JSON.stringify(index), {
                headers: { 'content-type': 'application/json; charset=utf-8' },
              }));
            }
            vocabularyCorrector = core.createVocabularyCorrector(index);
            if (vocabularyCorrector.size < 100000) throw new Error('一般語彙辞書に使用できる単語が不足しています。');
          } catch (error) {
            vocabularyCorrector = null;
            kotodamaDictionariesUnavailable = true;
            console.warn('コトダマギアの目録を補正索引にできませんでした。', error);
          }
        }
        for (const result of dictionaryResults) {
          if (result.status === 'rejected') console.warn('コトダマギアの目録を控えられませんでした。', result.reason);
        }
        modelsReady = true;
        busyMask.close();
        fileInput.disabled = false;
        cameraButton.disabled = false;
        const preloadIssues = [];
        if (kotodamaDictionariesUnavailable) preloadIssues.push('コトダマギアの禁書目録または正典目録を取得できなかった');
        if (cacheUnavailable) preloadIssues.push('この書架に控えを残せなかった');
        setStatus(preloadStatus, preloadIssues.length
          ? `外典は開いた。${preloadIssues.join('。')}。画像解析は利用できる。`
          : '魔導司書が外典を整えた。次に頁を開くときは、書架の控えが応える。', preloadIssues.length ? '' : 'good');
        loadDefaultImage();
      } catch (error) {
        console.error('外典の準備に失敗しました。', error);
        busyMask.classList.add('is-error');
        showBusyMask('遠き書庫の扉が開かなかった', '回廊が霧に閉ざされている。通信を確かめ、外典の扉を開き直してほしい。');
        busyProgress.hidden = true;
        busyPercent.textContent = '';
        retryModels.hidden = false;
        retryModels.focus();
        setStatus(preloadStatus, '外典の扉が開くまで、頁は静かに閉じている。', 'error');
      }
    })();
    try { await startupPromise; }
    finally { startupPromise = null; }
  }

  busyMask.addEventListener('cancel', event => event.preventDefault());
  retryModels.addEventListener('click', prepareModels);

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
    if (!modelsReady) return;
    userStartedImageAction = true;
    cancelActiveAnalysis('写し絵の撮影を始める');
    if (cameraStream) {
      if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
        setStatus(cameraStatus, 'カメラ映像の準備ができていません。', 'error');
        return;
      }
      cameraButton.disabled = true;
      await Promise.all([activeOcrRun, activeAttributeRun]);
      const side = Math.min(cameraVideo.videoWidth, cameraVideo.videoHeight);
      const cropX = (cameraVideo.videoWidth - side) / 2;
      const cropY = (cameraVideo.videoHeight - side) / 2;
      const sourceWidth = cameraVideo.videoWidth;
      const sourceHeight = cameraVideo.videoHeight;
      const maxSide = core.config.maxInputSide || side;
      const scale = Math.min(1, maxSide / side);
      const captureSide = Math.max(1, Math.round(side * scale));
      captureCanvas.width = captureSide;
      captureCanvas.height = captureSide;
      captureContext.drawImage(cameraVideo, cropX, cropY, side, side, 0, 0, captureSide, captureSide);
      stopCamera();
      loadFile(null, null, { captureReady: true, sourceWidth, sourceHeight });
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
    terminateAnalysisWorker();
  });
  function loadDefaultImage() {
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
  }
  prepareModels();
}(globalThis));

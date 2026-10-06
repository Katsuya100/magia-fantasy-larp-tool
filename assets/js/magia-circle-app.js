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

  const SPELL_PLACEHOLDER = '写し絵を選ぶと、刻まれた呪文がここへ現れます。';
  const ATTRIBUTES = global.AttributeScoringCore.attributes;
  const diagnosticsEnabled = Boolean(global.location?.search && new URLSearchParams(global.location.search).has('diagnostics'));
  const diagnosticSession = global.MagiaCircleDiagnostics.create({
    config: core.config,
    enabled: diagnosticsEnabled,
    onChange: () => publishRuntimeDiagnostics(),
  });
  const {
    diagnosticStageState, diagnosticAllocations, createAnalysisRunId, beginDiagnosticRun,
    recordAnalysisStage, recordAllocation, clearDiagnosticAllocationsByScope, recordCanvasEstimate,
  } = diagnosticSession;
  const { diagnostics, publishDiagnostics, publishRuntimeDiagnostics } = global.MagiaCircleDiagnosticView.create(diagnosticSession);
  let selectedImageDiagnosticRun = null;

  async function loadVocabularyIndex(job = null) {
    const stage = (name, details = {}) => { if (job) recordAnalysisStage(job, name, details); };
    try {
      return await vocabularyIndexLoader.load({ onStage: stage });
    } catch (error) {
      stage('vocabulary-error', { error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) } });
      console.warn('コトダマギアの補正索引を読み取れませんでした。', error);
      return null;
    }
  }

  async function validateVocabularyIndex() {
    let index = await loadVocabularyIndex();
    const available = Boolean(index && index.words.length >= 100000);
    index = null;
    return available;
  }

  async function applyVocabularyCorrection(recognition, job) {
    if (!recognition?.path?.words?.length) return core.applyVocabularyCorrection(recognition, null);
    assertActiveAnalysisJob(job);
    let index = await loadVocabularyIndex(job);
    try {
      if (!index || index.words.length < 100000) {
        recordAnalysisStage(job, 'vocabulary-corrector-create-start', { wordCount: index?.words?.length || 0, fallback: true });
        recordAnalysisStage(job, 'vocabulary-corrector-create-done', { fallback: true });
        recordAnalysisStage(job, 'vocabulary-correction-run-start', { fallback: true });
        const corrected = core.applyVocabularyCorrection(recognition, null);
        recordAnalysisStage(job, 'vocabulary-correction-run-done', { correctedWordCount: corrected?.path?.words?.length || 0, fallback: true });
        return corrected;
      }
      recordAnalysisStage(job, 'vocabulary-corrector-create-start', { wordCount: index.words.length });
      const corrector = core.createVocabularyCorrector(index);
      recordAnalysisStage(job, 'vocabulary-corrector-create-done', { wordCount: corrector.size });
      index = null;
      assertActiveAnalysisJob(job);
      recordAnalysisStage(job, 'vocabulary-correction-run-start', { wordCount: recognition.path.words.length });
      const corrected = core.applyVocabularyCorrection(recognition, corrector.size < 100000 ? null : corrector);
      recordAnalysisStage(job, 'vocabulary-correction-run-done', { correctedWordCount: corrected?.path?.words?.length || 0 });
      return corrected;
    } finally {
      index = null;
    }
  }

  function recordDiagnosticError(error, job = activeAnalysisJob) {
    diagnosticSession.recordDiagnosticError(error, job);
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
  const analyzeButton = requireElement('analyzeButton');
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
  let pendingImageSelection = null;
  let selectedImageName = '';
  let hasSelectedImage = false;
  let userStartedImageAction = false;
  let cameraStream = null;
  let startupPromise = null;
  let modelsReady = false;
  let cacheUnavailable = false;
  const cacheError = error => {
    cacheUnavailable = true;
    console.warn('外典の控えを保存・参照できませんでした。', error);
  };
  const kotodamaDictionaryCache = global.ModelCache.create({
    name: 'magia-circle-ocr-vocabulary-v1',
    onCacheError: cacheError,
    validate: (url, response) => vocabularyIndexLoader.validate(url, response),
  });
  const vocabularyIndexLoader = global.OcrVocabularyIndex.create({ cache: kotodamaDictionaryCache, baseUrl: document.baseURI });
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

  const { renderPower, renderShape, renderAttribute, renderAttributeFallback } = global.MagiaCircleResults.create({
    elements: { powerResult, powerDetail, shapeResult, shapeDetail, attributeResult, attributeDetail, modelStatus },
    powerInputs,
    diagnostics,
    setStatus,
  });

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

  function discardPendingImageSelection() {
    if (!pendingImageSelection) return;
    const selection = pendingImageSelection;
    selection.cancel?.();
    if (pendingImageSelection === selection) pendingImageSelection = null;
    analyzeButton.disabled = !hasSelectedImage;
    setImageBusy(false);
    setStatus(cameraStatus, hasSelectedImage ? '写し絵を表示しました。' : 'サンプルの読み込みを中断しました。');
    setStatus(modelStatus, hasSelectedImage
      ? '「陣を読み解く」を押すと、文字と紋を読み取ります。'
      : '画像を選ぶか、カメラで撮影してください。');
  }

  function cancelActiveAnalysis(reason) {
    const job = activeAnalysisJob;
    if (!job) return;

    const abortStage = /new|新しい|差し替え|選ぶ/i.test(reason) ? 'analysis-aborted-new-image' : 'analysis-aborted-user-action';
    recordAnalysisStage(job, abortStage, { reason: String(reason || '').slice(0, 120) });
    job.controller.abort(makeAnalysisAbortError(`${reason}ため、解析を中断しました。`));
    activeAnalysisJob = null;
    releaseAnalysisSource(job);
    if (analysisPending?.job === job) {
      const pending = analysisPending;
      analysisPending = null;
      pending.discardInput?.();
      terminateAnalysisWorker(pending.worker, job);
      if (pending.structureAllocationId && diagnosticAllocations.has(`main:${pending.structureAllocationId}`)) {
        recordAllocation(job, 'structure-input-buffer-release-done', pending.structureAllocationId, pending.structureEstimatedBytes || 0, {}, 'release');
        pending.structureAllocationId = null;
      }
      pending.reject(job.signal.reason);
    }

    setImageBusy(false);
    analyzeButton.disabled = !hasSelectedImage;
    setStatus(cameraStatus, '解析を中断しました。');
    setStatus(modelStatus, '次の写し絵を待っています。');
    appendProcessingRecord(`${job.fileName}：${reason}ため、途中で中断しました。`);
  }

  function beginAnalysisJob(file) {
    const controller = new AbortController();
    const diagnosticRun = selectedImageDiagnosticRun || beginDiagnosticRun(createAnalysisRunId(), {
      sourceWidth: captureCanvas.width || null,
      sourceHeight: captureCanvas.height || null,
    });
    selectedImageDiagnosticRun = null;
    const job = {
      id: nextAnalysisJobId += 1,
      runId: diagnosticRun.runId,
      diagnosticRun,
      controller,
      signal: controller.signal,
      fileName: file?.name || '撮影した写し絵',
      sourceUrl: null,
      sourceImage: null,
      ocrWorker: null,
      embeddingWorker: null,
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

  function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function terminateAnalysisWorker(worker = analysisWorker, job = activeAnalysisJob) {
    if (!worker) return;
    const pending = analysisPending?.worker === worker ? analysisPending : null;
    if (job?.structureWorkerActive) recordAnalysisStage(job, 'structure-worker-terminate-start', { workerType: 'structure' });
    if (analysisWorker === worker) analysisWorker = null;
    worker.terminate();
    if (job?.structureWorkerActive) {
      job.structureWorkerActive = false;
      recordAnalysisStage(job, 'structure-worker-terminate-done', { workerType: 'structure', workerAction: 'stop' });
      recordAnalysisStage(job, 'structure-worker-reference-release', { workerType: 'structure' });
      clearDiagnosticAllocationsByScope(job, 'structure');
    }
    if (job && pending?.structureAllocationId && diagnosticAllocations.has(`main:${pending.structureAllocationId}`)) {
      recordAllocation(job, 'structure-input-buffer-release-done', pending.structureAllocationId, pending.structureEstimatedBytes || 0, {}, 'release');
      pending.structureAllocationId = null;
    }
  }

  function failAnalysisWorker(worker, error) {
    if (analysisWorker !== worker) return;
    const pending = analysisPending;
    if (!pending || pending.worker !== worker) {
      terminateAnalysisWorker(worker, pending?.job || activeAnalysisJob);
      return;
    }
    recordAnalysisStage(pending.job, 'structure-worker-error', {
      error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) },
    });
    pending.rejectReady?.(error);
    pending.discardInput?.();
    terminateAnalysisWorker(worker, pending.job);
    analysisPending = null;
    if (!isActiveAnalysisJob(pending.job)) {
      pending.reject(pending.job.signal.reason || makeAnalysisAbortError());
      return;
    }
    pending.fallback(error);
  }

  function ensureAnalysisWorker(job) {
    recordAnalysisStage(job, 'structure-worker-create-start', { workerType: 'structure' });
    const worker = new Worker(new URL('assets/js/image-analysis-worker.js', document.baseURI));
    analysisWorker = worker;
    job.structureWorkerActive = true;
    recordAnalysisStage(job, 'structure-worker-create-done', { workerType: 'structure', workerAction: 'start' });
    worker.addEventListener('message', event => {
      if (analysisWorker !== worker) return;
      const message = event.data || {};
      const pending = analysisPending;
      if (message.type === 'diagnostic-stage') {
        if (!pending || pending.worker !== worker || (message.jobId != null && message.jobId !== pending.job.id)) return;
        recordAnalysisStage(pending.job, message.stage, message.details || {});
        if (message.stage === 'structure-worker-ready') pending.resolveReady?.();
        if (message.stage === 'structure-worker-run-done' && pending.structureAllocationId) {
          recordAllocation(pending.job, 'structure-input-buffer-release-done', pending.structureAllocationId, pending.structureEstimatedBytes || 0, {
            sourceWidth: pending.inputWidth, sourceHeight: pending.inputHeight, scope: 'main',
          }, 'release');
          pending.structureAllocationId = null;
        }
        return;
      }
      if (!pending || pending.worker !== worker || message.jobId !== pending.job.id) return;
      if (message.type === 'progress') {
        if (!isActiveAnalysisJob(pending.job)) return;
        setStatus(cameraStatus, message.stage, 'busy');
        setStatus(modelStatus, message.stage, 'busy');
        return;
      }
      if (message.type === 'success') recordAnalysisStage(pending.job, 'structure-result-received', {
        width: message.analysisWidth || null, height: message.analysisHeight || null,
      });
      else if (message.type === 'error') recordAnalysisStage(pending.job, 'structure-worker-error', {
        error: { name: 'Error', message: String(message.message || 'Structure Worker failed').slice(0, 240) },
      });
      terminateAnalysisWorker(worker, pending.job);
      analysisPending = null;
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

  function createAnalysisImage(job = null) {
    return imagePipeline.createAnalysisInput({
      width: captureCanvas.width,
      height: captureCanvas.height,
      read: () => {
        const width = captureCanvas.width;
        const height = captureCanvas.height;
        const estimatedBytes = width * height * 4;
        recordAnalysisStage(job, 'structure-input-get-image-data-start', { width, height, estimatedBytes, allocationId: 'structure-input-rgba', knownLiveBytes: diagnosticStageState.currentKnownLiveBytes });
        const image = captureContext.getImageData(0, 0, width, height);
        recordAllocation(job, 'structure-input-get-image-data-done', 'structure-input-rgba', image.data.byteLength, {
          width, height, type: 'Uint8ClampedArray', sourceWidth: width, sourceHeight: height,
        });
        return image;
      },
      resize: (width, height) => {
        const scratch = document.createElement('canvas');
        recordAnalysisStage(job, 'structure-input-canvas-resize-start', {
          width, height, estimatedBytes: width * height * 4, allocationId: 'structure-input-scratch-canvas', countedInKnownLiveBytes: false,
          canvas: { name: 'structure-input-scratch', width, height, estimatedRgbaBackingBytes: width * height * 4, countedInKnownLiveBytes: false },
        });
        scratch.width = width;
        scratch.height = height;
        recordAnalysisStage(job, 'structure-input-canvas-resize-done', {
          width: scratch.width, height: scratch.height, estimatedBytes: scratch.width * scratch.height * 4,
          allocationId: 'structure-input-scratch-canvas', countedInKnownLiveBytes: false,
          canvas: { name: 'structure-input-scratch', width: scratch.width, height: scratch.height, estimatedRgbaBackingBytes: scratch.width * scratch.height * 4, countedInKnownLiveBytes: false },
        });
        try {
          const context = scratch.getContext('2d', { willReadFrequently: true });
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          recordAnalysisStage(job, 'structure-input-resize-draw-start', {
            width, height, canvas: { name: 'structure-input-scratch', width, height, estimatedRgbaBackingBytes: width * height * 4, countedInKnownLiveBytes: false },
          });
          context.drawImage(captureCanvas, 0, 0, width, height);
          recordAnalysisStage(job, 'structure-input-resize-draw-done', { width, height });
          const estimatedBytes = width * height * 4;
          recordAnalysisStage(job, 'structure-input-get-image-data-start', { width, height, estimatedBytes, allocationId: 'structure-input-rgba', knownLiveBytes: diagnosticStageState.currentKnownLiveBytes });
          const image = context.getImageData(0, 0, width, height);
          recordAllocation(job, 'structure-input-get-image-data-done', 'structure-input-rgba', image.data.byteLength, {
            width, height, type: 'Uint8ClampedArray', sourceWidth: captureCanvas.width, sourceHeight: captureCanvas.height,
          });
          return image;
        } finally {
          scratch.width = 1;
          scratch.height = 1;
          recordAnalysisStage(job, 'structure-input-resize-canvas-release', { width: 1, height: 1 });
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
          const analysisImage = suppliedAnalysisImage || await createAnalysisImage(job);
          image = analysisImage.image;
          recordAnalysisStage(job, 'structure-worker-run-start', { scope: 'main-fallback', width: image.width, height: image.height, estimatedBytes: image.data.byteLength, workerType: 'structure' });
          const structure = imagePipeline.analyzeStructure(image.data.buffer, image.width, image.height);
          recordAnalysisStage(job, 'structure-worker-run-done', { scope: 'main-fallback', width: image.width, height: image.height });
          recordAllocation(job, 'structure-input-buffer-release-done', 'structure-input-rgba', image.data.byteLength, {}, 'release');
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
        createAnalysisImage(job).then(image => analyzeImageOnMain(job, image), reject).then(resolve, reject);
      };
      const pending = {
        job,
        resolve,
        reject,
        fallback,
        worker: null,
        ready: null,
        resolveReady: null,
        rejectReady: null,
        discardInput: () => {
          if (analysisImage) analysisImage.image = null;
          analysisImage = null;
        },
      };
      try {
        pending.ready = new Promise((resolveReady, rejectReady) => {
          pending.resolveReady = resolveReady;
          pending.rejectReady = rejectReady;
        });
        worker = ensureAnalysisWorker(job);
        pending.worker = worker;
        pending.inputWidth = analysisImage.image.width;
        pending.inputHeight = analysisImage.image.height;
        analysisPending = pending;
        pending.structureAllocationId = 'structure-input-rgba';
        pending.structureEstimatedBytes = analysisImage.image.data.byteLength;
        const transferAfterReady = async () => {
          try {
            await awaitForAnalysisJob(job, pending.ready);
            if (analysisPending !== pending) return;
            assertActiveAnalysisJob(job);
            const transferable = analysisImage.image.data.buffer;
            recordAnalysisStage(job, 'structure-input-transfer-start', {
              width: pending.inputWidth, height: pending.inputHeight,
              estimatedBytes: pending.structureEstimatedBytes, allocationId: pending.structureAllocationId,
            });
            worker.postMessage({
              jobId: job.id, runId: job.runId,
              width: pending.inputWidth, height: pending.inputHeight,
              buffer: transferable,
            }, [transferable]);
            recordAnalysisStage(job, 'structure-input-transfer-done', {
              width: pending.inputWidth, height: pending.inputHeight,
              estimatedBytes: pending.structureEstimatedBytes, allocationId: pending.structureAllocationId,
            });
            pending.discardInput();
          } catch (error) {
            if (analysisPending !== pending) return;
            const untransferredBytes = analysisImage?.image?.data?.byteLength || 0;
            pending.discardInput();
            analysisPending = null;
            terminateAnalysisWorker(worker, job);
            if (pending.structureAllocationId && diagnosticAllocations.has(`main:${pending.structureAllocationId}`)) {
              recordAllocation(job, 'structure-input-transfer-failed-release', pending.structureAllocationId, pending.structureEstimatedBytes || 0, {}, 'release');
            } else if (untransferredBytes && diagnosticAllocations.has('main:structure-input-rgba')) {
              recordAllocation(job, 'structure-input-buffer-release-done', 'structure-input-rgba', untransferredBytes, { reason: 'worker-create-failed' }, 'release');
            }
            fallback(error);
          }
        };
        transferAfterReady();
      } catch (error) {
        const untransferredBytes = analysisImage?.image?.data?.byteLength || 0;
        pending.discardInput();
        analysisPending = null;
        terminateAnalysisWorker(worker, job);
        if (pending.structureAllocationId && diagnosticAllocations.has(`main:${pending.structureAllocationId}`)) {
          recordAllocation(job, 'structure-input-transfer-failed-release', pending.structureAllocationId, pending.structureEstimatedBytes || 0, {}, 'release');
        } else if (untransferredBytes && diagnosticAllocations.has('main:structure-input-rgba')) {
          recordAllocation(job, 'structure-input-buffer-release-done', 'structure-input-rgba', untransferredBytes, { reason: 'worker-create-failed' }, 'release');
        }
        fallback(error);
      }
    });
  }

  function showCaptureCanvas(busy = false) {
    stage.classList.add('captured');
    stageEmpty.hidden = true;
    captureCanvas.classList.remove('hidden');
    setImageBusy(busy);
  }

  function canvasFromImage(image, diagnosticRun = null) {
    const dimensions = imagePipeline.fitInputDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (diagnosticRun) recordAnalysisStage(diagnosticRun, 'capture-canvas-resize-start', {
      sourceWidth, sourceHeight, width: dimensions.width, height: dimensions.height,
      estimatedBytes: dimensions.width * dimensions.height * 4,
      allocationId: 'capture-canvas-backing-estimate', countedInKnownLiveBytes: false,
    });
    captureCanvas.width = dimensions.width;
    captureCanvas.height = dimensions.height;
    if (diagnosticRun) recordAnalysisStage(diagnosticRun, 'capture-canvas-resize-done', {
      sourceWidth, sourceHeight, width: captureCanvas.width, height: captureCanvas.height,
      estimatedBytes: captureCanvas.width * captureCanvas.height * 4,
      allocationId: 'capture-canvas-backing-estimate', countedInKnownLiveBytes: false,
      canvas: { name: 'captureCanvas', width: captureCanvas.width, height: captureCanvas.height, estimatedRgbaBackingBytes: captureCanvas.width * captureCanvas.height * 4, countedInKnownLiveBytes: false },
    });
    captureContext.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    if (diagnosticRun) recordAnalysisStage(diagnosticRun, 'capture-canvas-draw-start', {
      sourceWidth, sourceHeight, width: captureCanvas.width, height: captureCanvas.height,
    });
    captureContext.drawImage(image, 0, 0, captureCanvas.width, captureCanvas.height);
    if (diagnosticRun) recordAnalysisStage(diagnosticRun, 'capture-canvas-draw-done', {
      sourceWidth, sourceHeight, width: captureCanvas.width, height: captureCanvas.height,
      canvas: { name: 'captureCanvas', width: captureCanvas.width, height: captureCanvas.height, estimatedRgbaBackingBytes: captureCanvas.width * captureCanvas.height * 4, countedInKnownLiveBytes: false },
    });
    showCaptureCanvas();
  }

  function stopCamera() {
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
    cameraVideo.classList.add('hidden');
    cameraButton.textContent = '写し絵を撮影';
    cameraButton.disabled = !modelsReady || Boolean(startupPromise);
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

  function terminateOcrWorker(job, worker = job?.ocrWorker) {
    if (!worker) return;
    recordAnalysisStage(job, 'ocr-worker-terminate-start', { workerType: 'ocr' });
    if (job.ocrWorker === worker) job.ocrWorker = null;
    try { worker.terminate(); }
    catch (error) {
      recordAnalysisStage(job, 'ocr-worker-cleanup-error', {
        workerType: 'ocr',
        cleanupError: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) },
      });
      console.warn('OCR Worker termination failed.', error);
    }
    recordAnalysisStage(job, 'ocr-worker-terminate-done', {
      workerType: 'ocr', workerAction: 'stop',
      runtimeState: { ortDetectionLoaded: false, opencvLoaded: false, clipperLoaded: false, recognizerLoaded: false },
    });
    recordAnalysisStage(job, 'ocr-worker-reference-release', { workerType: 'ocr' });
    clearDiagnosticAllocationsByScope(job, 'ocr');
    if (job.ocrSourceAllocationId && diagnosticAllocations.has(`main:${job.ocrSourceAllocationId}`)) {
      recordAllocation(job, 'ocr-source-rgba-release-done', job.ocrSourceAllocationId, job.ocrSourceEstimatedBytes || 0, {}, 'release');
      job.ocrSourceAllocationId = null;
    }
    recordAnalysisStage(job, 'ocr-worker-terminated');
  }

  function requestSpellRecognition(canvas, job, phase = 'detection', input = null) {
    return new Promise((resolve, reject) => {
      let worker = null;
      let pixels = null;
      let abortTimeout = null;
      let settled = false;
      let workerProcessingStarted = false;
      const cleanup = () => {
        try { job.signal.removeEventListener('abort', onAbort); }
        catch (error) { recordAnalysisStage(job, 'ocr-worker-cleanup-error', { cleanupPhase: 'remove-abort-listener', message: String(error?.message || error).slice(0, 240) }); }
        clearTimeout(abortTimeout);
        abortTimeout = null;
        if (worker) {
          for (const [type, listener] of [['message', onMessage], ['error', onError], ['messageerror', onMessageError]]) {
            try { worker.removeEventListener(type, listener); }
            catch (error) { recordAnalysisStage(job, 'ocr-worker-cleanup-error', { cleanupPhase: 'remove-worker-listener', eventType: type, message: String(error?.message || error).slice(0, 240) }); }
          }
          terminateOcrWorker(job, worker);
          worker = null;
        }
        if (job.ocrSourceAllocationId && diagnosticAllocations.has(`main:${job.ocrSourceAllocationId}`)) {
          recordAllocation(job, 'ocr-source-rgba-release-done', job.ocrSourceAllocationId, job.ocrSourceEstimatedBytes || 0, { reason: 'worker-cleanup' }, 'release');
          job.ocrSourceAllocationId = null;
        }
        pixels = null;
      };
      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler(value);
      };
      const onAbort = () => {
        if (!worker) {
          finish(reject, job.signal.reason || makeAnalysisAbortError());
          return;
        }
        try {
          worker.postMessage({ type: 'abort', jobId: job.id });
          abortTimeout = setTimeout(() => finish(reject, job.signal.reason || makeAnalysisAbortError()), 5000);
        } catch {
          finish(reject, job.signal.reason || makeAnalysisAbortError());
        }
      };
      const onError = event => {
        const cause = event.error || new Error(event.message || 'OCR Workerでエラーが発生しました。');
        const error = workerProcessingStarted
          ? (cause instanceof Error ? cause : new Error(String(cause)))
          : imagePipeline.wrapRetryableOcrLoadFailure(cause, 'OCR Worker initialization');
        recordDiagnosticError(error, job);
        finish(reject, error);
      };
      const onMessageError = () => {
        const error = new Error('OCR Workerから結果を受け取れませんでした。');
        recordDiagnosticError(error, job);
        finish(reject, error);
      };
      const onMessage = event => {
        const message = event.data || {};
        if (message.jobId !== job.id) return;
        if (message.type === 'diagnostic-stage' || message.type === 'stage') {
          if (message.stage === 'ocr-worker-processing-start') workerProcessingStarted = true;
          recordAnalysisStage(job, message.stage, message.details || message.memory || {});
        } else if (message.type === 'progress') {
          setStatus(modelStatus, message.message || '環の呪文を読み取っています…', 'busy');
        } else if (message.type === 'success') {
          recordAnalysisStage(job, 'ocr-worker-result-received', { resultType: 'success' });
          finish(job.signal.aborted ? reject : resolve, job.signal.aborted ? job.signal.reason || makeAnalysisAbortError() : message.result);
        } else if (message.type === 'error') {
          const error = new Error(message.message || 'OCRに失敗しました。');
          error.name = message.name || 'Error';
          if (message.code) error.code = String(message.code);
          if (message.retryable === true) error.retryable = true;
          if (message.resource) error.resource = String(message.resource);
          recordAnalysisStage(job, 'ocr-worker-result-received', { resultType: 'error', error: { name: error.name, code: error.code || null, retryable: error.retryable === true, message: String(error.message).slice(0, 240) } });
          recordDiagnosticError(error, job);
          finish(reject, job.signal.aborted ? job.signal.reason || error : error);
        }
      };

      try {
        assertActiveAnalysisJob(job);
        const width = canvas.width;
        const height = canvas.height;
        const estimatedBytes = width * height * 4;
        if (phase === 'detection') {
          recordAnalysisStage(job, 'ocr-image-data-read-start', { width, height, estimatedBytes, allocationId: 'ocr-source-rgba' });
          pixels = captureContext.getImageData(0, 0, canvas.width, canvas.height);
          recordAllocation(job, 'ocr-image-data-read-done', 'ocr-source-rgba', pixels.data.byteLength, {
            width, height, sourceWidth: width, sourceHeight: height, type: 'Uint8ClampedArray',
          });
          recordAnalysisStage(job, 'ocr-transfer-buffer-ready', { width, height, estimatedBytes: pixels.data.byteLength, allocationId: 'ocr-source-rgba' });
          input = { width, height, buffer: pixels.data.buffer };
        }
        const transfers = phase === 'recognition'
          ? [...input.lineImages, ...input.additionalLineImages].map(line => line.image.data.buffer)
          : [input.buffer, ...(input.mask ? [input.mask.buffer] : [])];
        const inputBytes = transfers.reduce((total, item) => total + item.byteLength, 0);
        const inputAllocationId = phase === 'detection' ? 'ocr-source-rgba' : 'ocr-phase-input';
        if (phase !== 'detection') recordAllocation(job, 'ocr-phase-input-ready', inputAllocationId, inputBytes, {
          workerPhase: phase, ownershipTransferred: true,
        });
        job.ocrSourceAllocationId = inputAllocationId;
        job.ocrSourceEstimatedBytes = inputBytes;
        assertActiveAnalysisJob(job);
        recordAnalysisStage(job, 'ocr-worker-create-start', { workerType: 'ocr', workerPhase: phase });
        try { worker = new Worker(new URL('assets/js/magia-circle-ocr-worker.js', document.baseURI)); }
        catch (error) { throw imagePipeline.wrapRetryableOcrLoadFailure(error, 'OCR Worker initialization'); }
        job.ocrWorker = worker;
        recordAnalysisStage(job, 'ocr-worker-create-done', { workerType: 'ocr', workerAction: 'start', workerPhase: phase });
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.addEventListener('messageerror', onMessageError);
        job.signal.addEventListener('abort', onAbort, { once: true });
        recordAnalysisStage(job, 'ocr-worker-message-transfer-start', {
          width, height, estimatedBytes: inputBytes, workerPhase: phase,
        });
        worker.postMessage({
          type: 'analyze',
          jobId: job.id,
          runId: job.runId,
          ...input,
          phase,
          diagnostics: diagnosticsEnabled,
        }, [...new Set(transfers)]);
        recordAnalysisStage(job, 'ocr-worker-message-transfer-done', {
          width, height, estimatedBytes: job.ocrSourceEstimatedBytes, allocationId: inputAllocationId, workerPhase: phase,
        });
        pixels = null;
        input = null;
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function recognizeSpell(canvas, job) {
    const recognition = (async () => {
      let input = null;
      for (const phase of ['detection', 'geometry', 'recognition']) {
        assertActiveAnalysisJob(job);
        // requestSpellRecognition terminates the previous runtime before resolving.
        input = await requestSpellRecognition(canvas, job, phase, input);
      }
      return input;
    })();
    activeOcrRun = recognition.then(() => undefined, () => undefined);
    const recognized = await awaitForAnalysisJob(job, recognition);
    assertActiveAnalysisJob(job);
    return recognized;
  }

  function embedAttributesInWorker(text, job) {
    assertActiveAnalysisJob(job);
    recordAnalysisStage(job, 'embedding-worker-create-start', { workerType: 'embedding' });
    let worker;
    try {
      worker = new Worker(new URL('assets/js/attribute-embedding-worker.js', document.baseURI), { type: 'module' });
    } catch (error) {
      recordAnalysisStage(job, 'embedding-worker-error', { error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) } });
      throw error;
    }
    job.embeddingWorker = worker;
    recordAnalysisStage(job, 'embedding-worker-create-done', { workerType: 'embedding', workerAction: 'start' });
    return new Promise((resolve, reject) => {
      let settled = false;
      let abortTimeout = null;
      let pendingEmbeddingResult = null;
      const cleanup = () => {
        job.signal.removeEventListener('abort', onAbort);
        clearTimeout(abortTimeout);
        abortTimeout = null;
        const currentWorker = worker;
        recordAnalysisStage(job, 'embedding-worker-terminate-start', { workerType: 'embedding' });
        currentWorker.removeEventListener('message', onMessage);
        currentWorker.removeEventListener('error', onError);
        currentWorker.removeEventListener('messageerror', onMessageError);
        currentWorker.terminate();
        recordAnalysisStage(job, 'embedding-worker-terminate-done', { workerType: 'embedding', workerAction: 'stop' });
        clearDiagnosticAllocationsByScope(job, 'embedding');
        recordAnalysisStage(job, 'embedding-worker-reference-release', { workerType: 'embedding' });
        if (job.embeddingWorker === currentWorker) job.embeddingWorker = null;
        worker = null;
        recordAnalysisStage(job, 'embedding-cleanup');
      };
      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler(value);
      };
      const onAbort = () => {
        try {
          worker.postMessage({ type: 'abort', jobId: job.id });
          abortTimeout = setTimeout(() => finish(reject, job.signal.reason || makeAnalysisAbortError()), 5000);
        } catch {
          finish(reject, job.signal.reason || makeAnalysisAbortError());
        }
      };
      const onError = event => {
        const error = new Error(event.error?.message || event.message || '相のEmbedding Workerでエラーが発生しました。');
        recordAnalysisStage(job, 'embedding-worker-error', { error: { name: String(error.name || 'Error'), message: String(error.message).slice(0, 240) } });
        finish(reject, error);
      };
      const onMessageError = () => {
        const error = new Error('相のEmbedding Workerから結果を受け取れませんでした。');
        recordAnalysisStage(job, 'embedding-worker-error', { error: { name: String(error.name || 'Error'), message: error.message } });
        finish(reject, error);
      };
      const onMessage = event => {
        const message = event.data || {};
        if (message.jobId !== job.id) return;
        if (message.type === 'diagnostic-stage' || message.type === 'stage') {
          recordAnalysisStage(job, message.stage, message.details || {});
          if (message.stage === 'embedding-result-transfer-done' && pendingEmbeddingResult) {
            finish(resolve, pendingEmbeddingResult);
            pendingEmbeddingResult = null;
          }
        } else if (message.type === 'cache-error') {
          cacheError(new Error(message.message || 'モデルキャッシュを利用できませんでした。'));
        } else if (message.type === 'progress') {
          if (message.stage === 'download') {
            showBusyMask('魔導司書が頁を読んでいる', '相の外典をひらき、言霊を一つずつ灯している…', message.progress);
          } else if (message.stage === 'ready') {
            showBusyMask('魔導司書が頁を読んでいる', '相の核を整えている。燭台の火が落ち着くのを待て。');
          }
        } else if (message.type === 'success') {
          const embedding = message.embedding;
          if (!Array.isArray(embedding?.dims) || !(embedding.data instanceof Float32Array)) {
            finish(reject, new TypeError('Embedding Worker returned an invalid tensor.'));
            return;
          }
          recordAnalysisStage(job, 'embedding-worker-run-done', { outputShape: embedding.dims, outputElements: embedding.data.length });
          recordAnalysisStage(job, 'embedding-result-received', {
            outputShape: embedding.dims, estimatedBytes: embedding.data.byteLength,
            allocationId: 'embedding-output-float32', scope: 'main',
          });
          recordAllocation(job, 'embedding-output-buffer-ready', 'embedding-output-float32', embedding.data.byteLength, {
            name: 'Embedding output Float32', type: 'Float32Array',
          });
          pendingEmbeddingResult = embedding;
        } else if (message.type === 'error') {
          const error = new Error(message.message || '相のEmbeddingに失敗しました。');
          error.name = message.name || 'Error';
          recordAnalysisStage(job, 'embedding-worker-error', {
            error: { name: error.name, message: String(error.message).slice(0, 240) },
          });
          finish(reject, job.signal.aborted ? job.signal.reason || error : error);
        }
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.addEventListener('messageerror', onMessageError);
      job.signal.addEventListener('abort', onAbort, { once: true });
      try {
        assertActiveAnalysisJob(job);
        recordAnalysisStage(job, 'embedding-input-build-start');
        const texts = imagePipeline.attributeInputTexts(text);
        const inputEstimatedBytes = texts.reduce((sum, value) => sum + String(value).length * 2, 0);
        recordAnalysisStage(job, 'embedding-input-build-done', { inputCount: texts.length, estimatedBytes: inputEstimatedBytes, estimateKind: 'UTF-16 string payload estimate' });
        recordAnalysisStage(job, 'embedding-input-transfer-start', { inputCount: texts.length, estimatedBytes: inputEstimatedBytes });
        recordAnalysisStage(job, 'embedding-worker-run-start', { inputCount: texts.length });
        worker.postMessage({ type: 'embed', jobId: job.id, runId: job.runId, texts });
        recordAnalysisStage(job, 'embedding-input-transfer-done', { inputCount: texts.length, estimatedBytes: inputEstimatedBytes });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function embedAttributes(text, job) {
    setStatus(modelStatus, '呪文の相を測る準備をしています…', 'busy');
    await yieldToBrowser();
    assertActiveAnalysisJob(job);
    return embedAttributesInWorker(text, job);
  }

  function resetResults({ preserveCaptureCanvas = false, preserveSelection = false } = {}) {
    stopCamera();
    detectedPaths = null;
    resetPowerInputs();
    structureReady = false;
    spellReady = false;
    updateResultVisibility();
    detailsChapter.open = false;
    cameraStatus.className = 'progress-row';
    cameraStatus.textContent = '紋：写し絵を選び、「陣を読み解く」を押すと輪郭と紋を読み取ります。';
    modelStatus.className = 'progress-row';
    modelStatus.textContent = '呪文：「陣を読み解く」を押すと、呪文を読み取って相を判定します。';
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
    if (!preserveSelection) {
      hasSelectedImage = false;
      selectedImageName = '';
      analyzeButton.disabled = true;
    }
    overlayCanvas.width = 1;
    overlayCanvas.height = 1;
    setImageBusy(false);
    stage.classList.remove('captured');
    stageEmpty.hidden = false;
  }

  function selectImage(file, sourceImage = null, options = {}) {
    const { captureReady = false, sourceWidth, sourceHeight, fileName, autoAnalyze = false, diagnosticRun: suppliedDiagnosticRun = null } = options;
    if (!modelsReady || (!file && !sourceImage && !captureReady)) return Promise.resolve(false);
    cancelActiveAnalysis('新しい写し絵を選ぶ');
    pendingImageSelection?.cancel?.();
    analyzeButton.disabled = true;
    const diagnosticRun = suppliedDiagnosticRun || beginDiagnosticRun(createAnalysisRunId(), {
      sourceWidth: Number.isFinite(sourceWidth) ? sourceWidth : null,
      sourceHeight: Number.isFinite(sourceHeight) ? sourceHeight : null,
    });
    selectedImageDiagnosticRun = diagnosticRun;
    if (!suppliedDiagnosticRun) recordAnalysisStage(diagnosticRun, 'image-file-received', {
      sourceWidth: Number.isFinite(sourceWidth) ? sourceWidth : null,
      sourceHeight: Number.isFinite(sourceHeight) ? sourceHeight : null,
      fileBytes: Number.isFinite(file?.size) ? file.size : null,
      fileType: String(file?.type || (captureReady ? 'camera-capture' : sourceImage ? 'image-element' : 'sample')).slice(0, 80),
    });
    const selection = {
      sourceImage: sourceImage || (captureReady ? null : new Image()),
      sourceUrl: file ? URL.createObjectURL(file) : null,
      diagnosticRun,
    };
    pendingImageSelection = selection;
    const image = selection.sourceImage;
    const selectedName = fileName || file?.name || (captureReady ? '撮影した写し絵' : 'サンプル画像');
    setStatus(cameraStatus, '写し絵を読み込んでいます…', 'busy');
    setStatus(modelStatus, '画像を表示してから読み取りを始めます。', 'busy');

    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      selection.cancel = () => {
        recordAnalysisStage(diagnosticRun, 'image-selection-aborted-new-image');
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
        releaseAnalysisSource(selection);
        if (pendingImageSelection === selection) pendingImageSelection = null;
        finish(false);
      };
      const fail = (error, stageName = 'image-decode-error') => {
        recordAnalysisStage(diagnosticRun, stageName, { error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) } });
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
        releaseAnalysisSource(selection);
        if (pendingImageSelection !== selection) {
          finish(false);
          return;
        }
        pendingImageSelection = null;
        analyzeButton.disabled = !hasSelectedImage;
        setImageBusy(false);
        setStatus(cameraStatus, `写し絵を読み込めませんでした。${error?.message || ''}`.trim(), 'error');
        setStatus(modelStatus, '別の画像を選ぶか、もう一度お試しください。');
        if (diagnostics) {
          diagnostics.image = { error: error?.message || '画像を読み込めませんでした。' };
          publishDiagnostics();
        }
        finish(false);
      };
      const commit = async () => {
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
        if (selection.sourceUrl) {
          URL.revokeObjectURL(selection.sourceUrl);
          selection.sourceUrl = null;
        }
        if (pendingImageSelection !== selection) {
          releaseAnalysisSource(selection);
          finish(false);
          return;
        }
        try {
          if (file && image) recordAnalysisStage(diagnosticRun, 'image-decode-done', {
            sourceWidth: image.naturalWidth || image.width,
            sourceHeight: image.naturalHeight || image.height,
          });
          resetResults({ preserveCaptureCanvas: captureReady });
          if (captureReady) showCaptureCanvas();
          else canvasFromImage(image, diagnosticRun);
          await yieldToBrowser();
          if (pendingImageSelection !== selection) {
            releaseAnalysisSource(selection);
            finish(false);
            return;
          }
          if (diagnostics) diagnostics.image = {
            naturalWidth: sourceWidth || image?.naturalWidth || image?.width || captureCanvas.width,
            naturalHeight: sourceHeight || image?.naturalHeight || image?.height || captureCanvas.height,
            canvasWidth: captureCanvas.width,
            canvasHeight: captureCanvas.height,
          };
          releaseAnalysisSource(selection);
          pendingImageSelection = null;
          hasSelectedImage = true;
          selectedImageName = selectedName;
          selectedImageDiagnosticRun = diagnosticRun;
          recordAnalysisStage(diagnosticRun, 'image-selection-ready', {
            sourceWidth: sourceWidth || image?.naturalWidth || image?.width || captureCanvas.width,
            sourceHeight: sourceHeight || image?.naturalHeight || image?.height || captureCanvas.height,
            canvas: {
              name: 'captureCanvas',
              width: captureCanvas.width,
              height: captureCanvas.height,
              estimatedRgbaBackingBytes: global.MagiaAnalysisDiagnostics.rgbaBytes(captureCanvas.width, captureCanvas.height),
              countedInKnownLiveBytes: false,
            },
          });
          analyzeButton.disabled = false;
          setImageBusy(false);
          setStatus(cameraStatus, '写し絵を表示しました。');
          setStatus(modelStatus, '「陣を読み解く」を押すと、文字と紋を読み取ります。');
          finish(true);
          if (autoAnalyze) void analyzeSelectedImage();
        } catch (error) {
          fail(error, 'image-selection-commit-error');
        }
      };

      const beginLoad = async () => {
        try {
          // Let any canceled OCR finish before decoding another full-size image.
          await Promise.all([activeOcrRun, activeAttributeRun]);
          await yieldToBrowser();
          if (pendingImageSelection !== selection) {
            releaseAnalysisSource(selection);
            finish(false);
            return;
          }
          if (captureReady || sourceImage) {
            await commit();
            return;
          }
          recordAnalysisStage(diagnosticRun, 'image-decode-start', { fileBytes: Number.isFinite(file?.size) ? file.size : null });
          image.onload = () => { void commit(); };
          image.onerror = () => fail(new Error('別の画像を選んでください。'));
          image.src = selection.sourceUrl;
        } catch (error) {
          fail(error, 'image-selection-error');
        }
      };
      void beginLoad();
    });
  }

  async function analyzeSelectedImage() {
    if (!modelsReady || !hasSelectedImage || pendingImageSelection || activeAnalysisJob) return;
    const previousRuns = Promise.all([activeOcrRun, activeAttributeRun]);
    const job = beginAnalysisJob({ name: selectedImageName });
    recordAnalysisStage(job, 'analysis-start');
    resetResults({ preserveCaptureCanvas: true, preserveSelection: true });
    showCaptureCanvas(true);
    analyzeButton.disabled = true;
    setStatus(cameraStatus, '写し絵の輪郭と紋を読み取っています…', 'busy');
    setStatus(modelStatus, '環の呪文を読み取っています…', 'busy');
    let masterImageAllocationBytes = 0;
    try {
      // A previous canceled ONNX run cannot be interrupted; wait before reusing the canvas.
      await awaitForAnalysisJob(job, previousRuns);
      await yieldToBrowser();
      assertActiveAnalysisJob(job);
      const pipelineTask = imagePipeline.run({
        recognizeSpell: async attempt => {
          setStatus(modelStatus, '環の呪文を読み取っています…', 'busy');
          return recognizeSpell(captureCanvas, job, attempt);
        },
        correctSpell: recognition => applyVocabularyCorrection(recognition, job),
        onRecognitionRetry: async ({ error, resource }) => {
          recordAnalysisStage(job, 'ocr-worker-retry-start', {
            attempt: 1,
            retryable: true,
            resource: resource || error.resource || null,
            error: { name: error.name, code: error.code, message: String(error.message).slice(0, 240) },
          });
          console.warn('一時的なOCRリソース読み込み失敗のため、一度だけ自動再試行します。', error);
          appendProcessingRecord(`${job.fileName}：一時的なOCRリソース取得エラーのため、終了処理を待って一度だけ再試行します。`);
          setStatus(modelStatus, 'OCR処理に失敗しました。終了処理を待ってから再試行しています…', 'busy');
          await activeOcrRun;
        },
        getStructureInput: async () => {
          recordAnalysisStage(job, 'structure-analysis-start');
          setStatus(cameraStatus, '写し絵を受け取り、閉じたパスと環内の文字位置を調べています…', 'busy');
          return { analysis: await createAnalysisImage(job) };
        },
        analyzeStructure: async analysis => {
          const result = await analyzeImageInWorker(job, analysis);
          recordAnalysisStage(job, 'structure-analysis-done');
          return result;
        },
        getMasterImage: () => {
          const width = captureCanvas.width;
          const height = captureCanvas.height;
          const estimatedBytes = width * height * 4;
          recordAnalysisStage(job, 'master-image-get-image-data-start', {
            width, height, estimatedBytes, allocationId: 'master-image-rgba',
            knownLiveBytes: diagnosticStageState.currentKnownLiveBytes,
          });
          const image = captureContext.getImageData(0, 0, width, height);
          masterImageAllocationBytes = image.data.byteLength;
          recordAllocation(job, 'master-image-get-image-data-done', 'master-image-rgba', masterImageAllocationBytes, {
            width, height, type: 'Uint8ClampedArray', sourceWidth: width, sourceHeight: height,
          });
          return image;
        },
        releaseMasterImage: () => {
          recordAnalysisStage(job, 'master-image-release-start', { allocationId: 'master-image-rgba' });
          masterImageAllocationBytes = 0;
        },
        releaseEmbedding: () => {
          recordAnalysisStage(job, 'embedding-output-buffer-release-start', { allocationId: 'embedding-output-float32' });
        },
        embedAttributes: async text => embedAttributes(text, job),
        reportStage: (stageName, details) => recordAnalysisStage(job, stageName, details),
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
        console.error('OCRで呪文を読み取れませんでした。', recognition.error);
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
      recordAnalysisStage(job, 'analysis-complete');
      activeAnalysisJob = null;
      analyzeButton.disabled = !hasSelectedImage;
      publishDiagnostics();
    } catch (error) {
      releaseAnalysisSource(job);
      if (job.signal.aborted || error?.name === 'AbortError') {
        if (!job.diagnosticRun.aborted) recordAnalysisStage(job, 'analysis-aborted-user-action', { reason: String(error?.message || '解析が中断されました。').slice(0, 120) });
        return;
      }
      const ocrExecutionError = diagnosticStageState.currentStage === 'ocr-execution-error';
      if (job.diagnosticRun.trace.at(-1)?.stage !== 'analysis-error') recordAnalysisStage(job, 'analysis-error', {
        error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) },
        failedStage: diagnosticStageState.currentStage,
      });
      if (!isActiveAnalysisJob(job)) return;
      if (ocrExecutionError) {
        structureReady = false;
        spellReady = false;
        updateResultVisibility();
        setImageBusy(false);
        setStatus(cameraStatus, '画像解析を完了できませんでした。', 'error');
        setStatus(modelStatus, '呪文の読み取り中にエラーが発生しました。', 'error');
        activeAnalysisJob = null;
        analyzeButton.disabled = !hasSelectedImage;
        publishDiagnostics();
        return;
      }
      if (!Number.isFinite(powerInputs.wordCount)) powerInputs.wordCount = 0;
      if (!Number.isFinite(powerInputs.attributeCertainty)) powerInputs.attributeCertainty = renderAttributeFallback(error);
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
      analyzeButton.disabled = !hasSelectedImage;
      publishDiagnostics();
    }
  }

  async function prepareModels() {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      fileInput.disabled = true;
      cameraButton.disabled = true;
      analyzeButton.disabled = true;
      retryModels.hidden = true;
      busyMask.classList.remove('is-error');
      busyProgress.hidden = false;
      if (!busyMask.open) busyMask.showModal();
      busyMask.focus();
      showBusyMask('魔導司書が外典を探している', '頁に触れず、燭台の火が落ち着くのを待て。');
      setStatus(preloadStatus, '魔導司書が外典を整えている。', 'busy');
      let kotodamaDictionariesUnavailable = false;
      try {
        busyStage.textContent = '一 / 一 — 禁書目録と正典目録';
        showBusyMask('魔導司書が目録を集めている', 'コトダマギアと共有する禁書目録と正典目録を、この書架にも控えている。');
        kotodamaDictionariesUnavailable = !(await validateVocabularyIndex());
        modelsReady = true;
        busyMask.close();
        const preloadIssues = [];
        if (kotodamaDictionariesUnavailable) preloadIssues.push('コトダマギアの禁書目録または正典目録を取得できなかった');
        if (cacheUnavailable) preloadIssues.push('この書架に控えを残せなかった');
        setStatus(preloadStatus, preloadIssues.length
          ? `外典は開いた。${preloadIssues.join('。')}。画像解析は利用できる。`
          : '魔導司書が外典を整えた。次に頁を開くときは、書架の控えが応える。', preloadIssues.length ? '' : 'good');
        await loadInitialImage();
        fileInput.disabled = false;
        cameraButton.disabled = false;
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
    cancelActiveAnalysis('写し絵の選定を始める');
  });
  fileInput.addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      userStartedImageAction = true;
      void selectImage(file);
    }
  });
  analyzeButton.addEventListener('click', analyzeSelectedImage);
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
    discardPendingImageSelection();
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
      const diagnosticRun = beginDiagnosticRun(createAnalysisRunId(), { sourceWidth, sourceHeight });
      recordAnalysisStage(diagnosticRun, 'image-file-received', { sourceWidth, sourceHeight, fileType: 'camera-capture' });
      recordAnalysisStage(diagnosticRun, 'capture-canvas-resize-start', {
        sourceWidth, sourceHeight, width: captureSide, height: captureSide,
        estimatedBytes: captureSide * captureSide * 4, allocationId: 'capture-canvas-backing-estimate', countedInKnownLiveBytes: false,
      });
      captureCanvas.width = captureSide;
      captureCanvas.height = captureSide;
      recordAnalysisStage(diagnosticRun, 'capture-canvas-resize-done', {
        sourceWidth, sourceHeight, width: captureCanvas.width, height: captureCanvas.height,
        estimatedBytes: captureCanvas.width * captureCanvas.height * 4,
        allocationId: 'capture-canvas-backing-estimate', countedInKnownLiveBytes: false,
        canvas: { name: 'captureCanvas', width: captureCanvas.width, height: captureCanvas.height, estimatedRgbaBackingBytes: captureCanvas.width * captureCanvas.height * 4, countedInKnownLiveBytes: false },
      });
      recordAnalysisStage(diagnosticRun, 'capture-canvas-draw-start', { sourceWidth, sourceHeight, width: captureSide, height: captureSide });
      captureContext.drawImage(cameraVideo, cropX, cropY, side, side, 0, 0, captureSide, captureSide);
      recordAnalysisStage(diagnosticRun, 'capture-canvas-draw-done', { sourceWidth, sourceHeight, width: captureSide, height: captureSide });
      stopCamera();
      await selectImage(null, null, { captureReady: true, sourceWidth, sourceHeight, diagnosticRun });
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
  function loadInitialImage() {
    const testImage = diagnostics && new URLSearchParams(global.location.search).get('test-image');
    const imageUrl = new URL(testImage || 'assets/images/sample.png', global.location.href);
    if (testImage && imageUrl.origin !== global.location.origin) {
      diagnostics.image = { error: '比較用画像は同一オリジンから読み込んでください。' };
      publishDiagnostics();
    } else {
      return fetch(imageUrl).then(response => {
        if (!response.ok) throw new Error(`画像を読み込めません: ${response.status}`);
        return response.blob();
      }).then(blob => {
        if (userStartedImageAction) return;
        const name = imageUrl.pathname.split('/').at(-1) || (testImage ? 'test-image.png' : 'sample.png');
        return selectImage(new File([blob], name, { type: blob.type || 'image/png' }), null, { autoAnalyze: Boolean(testImage) });
      })
        .catch(error => {
          if (userStartedImageAction) return;
          if (diagnostics) {
            diagnostics.image = { error: error.message };
            publishDiagnostics();
          } else {
            setStatus(cameraStatus, 'サンプルを表示できませんでした。画像を選ぶか、カメラで撮影してください。', 'error');
          }
        });
    }
  }
  publishDiagnostics();
  publishRuntimeDiagnostics();
  prepareModels();
}(globalThis));

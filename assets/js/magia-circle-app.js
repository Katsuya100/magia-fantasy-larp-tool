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

  const KOTODAMA_NGRAM_INDEX_CACHE_URL = 'https://kotodamagia.local/cache/scowl-en-us-common-ngrams-v2.json';
  const SPELL_PLACEHOLDER = '写し絵を選ぶと、刻まれた呪文がここへ現れます。';
  const ATTRIBUTES = global.AttributeScoringCore.attributes;
  const diagnosticsEnabled = Boolean(global.location?.search && new URLSearchParams(global.location.search).has('diagnostics'));
  const DIAGNOSTIC_TRACE_LIMIT = 64;
  let stageStorageWarningShown = false;
  const diagnosticStageState = {
    currentStage: 'page-loaded',
    previousInterruptedStage: 'none',
    runId: 'none',
    memory: null,
    error: null,
    trace: [],
    previousRun: null,
    currentKnownLiveBytes: 0,
    peakKnownLiveBytes: 0,
    activeWorkers: { ocr: 0, structure: 0, embedding: 0 },
    runtimeStates: { ortDetectionLoaded: false, opencvLoaded: false, recognizerLoaded: false, ocrWorkerActive: false, structureWorkerActive: false, embeddingWorkerActive: false },
    localStorageWrites: 0,
    canvas: null,
  };
  const diagnosticAllocations = new Map();
  let activeDiagnosticRun = null;
  let selectedImageDiagnosticRun = null;
  const onnxRuntimeDiagnostics = {
    version: core.config.onnxRuntimeWebVersion,
    ...core.config.onnxRuntimeDefaults,
    graphOptimizationLevelSource: 'ORT default',
    detectionTensorShape: null,
  };
  const OCR_MEMORY_FIELDS = [
    'ocrInputWidth', 'ocrInputHeight',
    'detectionTensorWidth', 'detectionTensorHeight',
    'detectionMaskWidth', 'detectionMaskHeight',
    'inputFloat32EstimatedBytes', 'maskEstimatedBytes',
  ];

  function compactOcrMemory(memory) {
    const compact = {};
    for (const field of OCR_MEMORY_FIELDS) {
      const value = memory?.[field];
      if (Number.isSafeInteger(value) && value >= 0) compact[field] = value;
    }
    return Object.keys(compact).length ? compact : null;
  }

  function warnStageStorageUnavailable(error) {
    if (!diagnosticsEnabled || stageStorageWarningShown) return;
    stageStorageWarningShown = true;
    console.warn('[Magia] Analysis stage diagnostics are unavailable.', error);
  }

  function currentEnvironment() {
    const screen = global.screen;
    const memory = global.performance?.memory;
    return {
      userAgent: String(global.navigator?.userAgent || 'unknown'),
      hardwareConcurrency: Number.isFinite(global.navigator?.hardwareConcurrency) ? global.navigator.hardwareConcurrency : null,
      deviceMemory: Number.isFinite(global.navigator?.deviceMemory) ? global.navigator.deviceMemory : null,
      screen: { width: Number.isFinite(screen?.width) ? screen.width : null, height: Number.isFinite(screen?.height) ? screen.height : null },
      devicePixelRatio: Number.isFinite(global.devicePixelRatio) ? global.devicePixelRatio : null,
      performanceMemory: memory ? {
        usedJSHeapSize: Number.isFinite(memory.usedJSHeapSize) ? memory.usedJSHeapSize : null,
        totalJSHeapSize: Number.isFinite(memory.totalJSHeapSize) ? memory.totalJSHeapSize : null,
        jsHeapSizeLimit: Number.isFinite(memory.jsHeapSizeLimit) ? memory.jsHeapSizeLimit : null,
      } : null,
      onnxRuntime: {
        version: onnxRuntimeDiagnostics.version,
        executionProvider: onnxRuntimeDiagnostics.executionProvider,
        graphOptimizationLevel: onnxRuntimeDiagnostics.graphOptimizationLevel,
        numThreads: onnxRuntimeDiagnostics.numThreads,
      },
    };
  }

  try {
    const storage = global.localStorage;
    if (!storage) throw new Error('localStorage is unavailable in this browser context.');
    const previousStage = storage.getItem('magiaAnalysisStage');
    diagnosticStageState.currentStage = previousStage || 'page-loaded';
    diagnosticStageState.previousInterruptedStage = previousStage && previousStage !== 'analysis-complete' ? previousStage : 'none';
    diagnosticStageState.runId = storage.getItem('magiaAnalysisRunId') || 'none';
    const savedTrace = storage.getItem('magiaAnalysisTrace');
    if (savedTrace && savedTrace.length <= 256 * 1024) {
      try {
        const parsed = JSON.parse(savedTrace);
        const trace = Array.isArray(parsed?.trace) ? parsed.trace.slice(-DIAGNOSTIC_TRACE_LIMIT) : [];
        const completed = Boolean(parsed?.completed) || trace.some(event => event.stage === 'analysis-complete');
        const aborted = Boolean(parsed?.aborted) || trace.some(event => String(event.stage).startsWith('analysis-aborted-'));
        const analysisStarted = Boolean(parsed?.analysisStarted) || trace.some(event => event.stage === 'analysis-start');
        diagnosticStageState.previousRun = {
          ...parsed,
          trace,
          completed,
          interrupted: analysisStarted && !completed && !aborted && !trace.some(event => event.stage === 'analysis-error'),
        };
        diagnosticStageState.trace = trace;
        if (!diagnosticStageState.memory) {
          const lastMemoryEvent = [...trace].reverse().find(event => compactOcrMemory(event.details));
          diagnosticStageState.memory = compactOcrMemory(lastMemoryEvent?.details);
        }
        if (trace.length) diagnosticStageState.currentStage = trace.at(-1).stage || diagnosticStageState.currentStage;
        diagnosticStageState.previousInterruptedStage = diagnosticStageState.previousRun.interrupted
          ? diagnosticStageState.currentStage
          : 'none';
        if (diagnosticStageState.previousRun.interrupted) {
          storage.setItem('magiaAnalysisPreviousTrace', JSON.stringify(diagnosticStageState.previousRun));
        }
      } catch { storage.removeItem('magiaAnalysisTrace'); }
    }
    const savedPreviousTrace = storage.getItem('magiaAnalysisPreviousTrace');
    if (savedPreviousTrace && savedPreviousTrace.length <= 256 * 1024) {
      try {
        const parsedPrevious = JSON.parse(savedPreviousTrace);
        if (parsedPrevious?.interrupted && Array.isArray(parsedPrevious.trace)) {
          diagnosticStageState.previousRun = { ...parsedPrevious, trace: parsedPrevious.trace.slice(-DIAGNOSTIC_TRACE_LIMIT) };
          diagnosticStageState.trace = diagnosticStageState.previousRun.trace;
          diagnosticStageState.currentStage = diagnosticStageState.previousRun.lastStage || diagnosticStageState.previousRun.trace.at(-1)?.stage || diagnosticStageState.currentStage;
          diagnosticStageState.previousInterruptedStage = diagnosticStageState.currentStage;
        }
      } catch { storage.removeItem('magiaAnalysisPreviousTrace'); }
    }
    const savedMemory = storage.getItem('magiaAnalysisMemory');
    if (savedMemory && savedMemory.length <= 512) {
      try {
        if (!diagnosticStageState.memory) diagnosticStageState.memory = compactOcrMemory(JSON.parse(savedMemory));
        if (diagnosticStageState.memory?.detectionTensorWidth && diagnosticStageState.memory?.detectionTensorHeight) {
          onnxRuntimeDiagnostics.detectionTensorShape = [
            1, 3, diagnosticStageState.memory.detectionTensorHeight, diagnosticStageState.memory.detectionTensorWidth,
          ];
        }
      }
      catch { storage.removeItem('magiaAnalysisMemory'); }
    } else if (savedMemory) storage.removeItem('magiaAnalysisMemory');
  } catch (error) {
    warnStageStorageUnavailable(error);
  }

  function createAnalysisRunId() {
    return global.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function beginDiagnosticRun(runId, details = {}) {
    const now = global.performance?.now?.() ?? Date.now();
    activeDiagnosticRun = {
      runId,
      startedAt: now,
      startedTimestamp: Date.now(),
      seq: 0,
      trace: [],
      analysisStarted: false,
      completed: false,
      aborted: false,
      error: null,
      localStorageWrites: 0,
      sourceWidth: Number.isFinite(details.sourceWidth) ? details.sourceWidth : null,
      sourceHeight: Number.isFinite(details.sourceHeight) ? details.sourceHeight : null,
      ocrSourceWidth: null,
      ocrSourceHeight: null,
    };
    const run = activeDiagnosticRun;
    run.reporter = global.MagiaAnalysisDiagnostics.createReporter('main');
    run.reporter.begin(runId, {
      sourceWidth: run.sourceWidth,
      sourceHeight: run.sourceHeight,
      onnxRuntimeVersion: core.config.onnxRuntimeWebVersion,
      graphOptimizationLevel: onnxRuntimeDiagnostics.graphOptimizationLevel,
      numThreads: onnxRuntimeDiagnostics.numThreads,
    });
    diagnosticStageState.runId = runId;
    diagnosticStageState.trace = activeDiagnosticRun.trace;
    diagnosticStageState.currentStage = 'image-file-received';
    diagnosticStageState.memory = null;
    onnxRuntimeDiagnostics.detectionTensorShape = null;
    diagnosticStageState.previousInterruptedStage = 'none';
    diagnosticStageState.error = null;
    diagnosticStageState.currentKnownLiveBytes = 0;
    diagnosticStageState.peakKnownLiveBytes = 0;
    diagnosticStageState.activeWorkers = { ocr: 0, structure: 0, embedding: 0 };
    diagnosticStageState.runtimeStates = { ortDetectionLoaded: false, opencvLoaded: false, recognizerLoaded: false, ocrWorkerActive: false, structureWorkerActive: false, embeddingWorkerActive: false };
    diagnosticStageState.sourceMatCreateCount = 0;
    diagnosticStageState.localStorageWrites = 0;
    diagnosticStageState.canvas = null;
    diagnosticAllocations.clear();
    return activeDiagnosticRun;
  }

  function applyDiagnosticDetails(details) {
    if (details?.allocationAction && details.allocationId) {
      const key = `${details.scope || 'main'}:${details.allocationId}`;
      if (details.allocationAction === 'allocate' && details.countedInKnownLive !== false) {
        const previous = diagnosticAllocations.get(key);
        const estimatedBytes = Math.max(0, Number(details.estimatedBytes) || 0);
        if (previous) diagnosticStageState.currentKnownLiveBytes -= previous.estimatedBytes;
        diagnosticAllocations.set(key, {
          name: String(details.name || details.allocationId),
          estimatedBytes,
          ...(Number.isFinite(details.width) ? { width: details.width } : {}),
          ...(Number.isFinite(details.height) ? { height: details.height } : {}),
          type: String(details.type || 'ArrayBuffer'),
        });
        diagnosticStageState.currentKnownLiveBytes += estimatedBytes;
        diagnosticStageState.peakKnownLiveBytes = Math.max(
          diagnosticStageState.peakKnownLiveBytes,
          diagnosticStageState.currentKnownLiveBytes,
        );
      } else if (details.allocationAction === 'release') {
        const previous = diagnosticAllocations.get(key);
        if (previous) {
          diagnosticStageState.currentKnownLiveBytes = Math.max(0, diagnosticStageState.currentKnownLiveBytes - previous.estimatedBytes);
          diagnosticAllocations.delete(key);
        }
      }
    }
    if (details?.workerAction && details.workerType in diagnosticStageState.activeWorkers) {
      const delta = details.workerAction === 'start' ? 1 : details.workerAction === 'stop' ? -1 : 0;
      diagnosticStageState.activeWorkers[details.workerType] = Math.max(0, diagnosticStageState.activeWorkers[details.workerType] + delta);
      const runtimeKey = `${details.workerType}WorkerActive`;
      if (runtimeKey in diagnosticStageState.runtimeStates) diagnosticStageState.runtimeStates[runtimeKey] = diagnosticStageState.activeWorkers[details.workerType] > 0;
    }
    if (details?.runtimeState && typeof details.runtimeState === 'object') {
      Object.assign(diagnosticStageState.runtimeStates, details.runtimeState);
    }
    if (details?.canvas) diagnosticStageState.canvas = { ...details.canvas };
  }

  function shouldPersistDiagnosticStage(stage, details = {}) {
    if (stage === 'image-file-received' || stage.startsWith('analysis-') || stage.endsWith('-error')) return true;
    if (details.workerAction) return true;
    const estimatedBytes = Number(details.estimatedBytes ?? details.inputEstimatedBytes);
    if (!stage.startsWith('ocr-line-source-mat-') && Number.isFinite(estimatedBytes) && estimatedBytes >= 1024 * 1024 && /(?:alloc|arraybuffer|image-data|transfer|mat|buffer-release|fill|copy|render|perspective)/i.test(stage)) return true;
    const criticalPatterns = [
      /-run-(?:start|done)/,
      /-session-(?:create|release)-(?:start|done)/,
      /-(?:tensor-create|tensor-dispose)-(?:start|done)/,
      /-ort-import-(?:start|done)/,
      /-runtime-(?:import|init)-(?:start|done)/,
      /-phase-(?:start|done)/,
      /(?:opencv|clipper)-import-(?:start|done)/,
      /-model-fetch-(?:start|done)/,
      /-model-(?:arraybuffer|buffer)-(?:start|done)/,
      /-worker-(?:create|processing|terminate)-(?:start|done)/,
      /-message-transfer-(?:start|done)/,
      /-input-transfer-(?:start|done)/,
      /-result-received/,
      /ocr-detection-output-read-(?:start|done)/,
      /find-contours-(?:start|done)/,
      /contours-process-(?:start|done)/,
      /contours-process-(?:25|50|75|done)/,
      /line-materialize-(?:start|done)/,
      /line-crop-buffer-ready/,
      /line-release-(?:start|done)/,
      /source-align-(?:check|render-start|render-done)/,
      /^ocr-source-mat-(?:alloc-start|alloc-done|copy-start|copy-done)$/,
      /structure-input-canvas-resize-(?:start|done)/,
      /get-image-data-(?:start|done)/,
      /master-image-(?:request-start|get-image-data-start|get-image-data-done|ready|release-(?:start|done))/,
      /structure-analysis-(?:start|done)/,
      /structure-scale-restore-(?:start|done)/,
      /structure-score-(?:start|done)/,
      /vocabulary-(?:start|done|cache-(?:open|match)-(?:start|done)|response-text-start|response-text-done|json-parse-start|json-parse-done|json-parse-error|index-create-(?:start|done)|json-stringify-(?:start|done)|corrector-create-start|corrector-create-done|correction-run-start|correction-run-done)/,
      /embedding-(?:model-load|pipeline-create|run|result-transfer)-(?:start|done)/,
      /post-ocr-wait-(?:start|done)/,
      /image-decode-(?:start|done)/,
      /capture-canvas-(?:resize|draw)-(?:start|done)/,
      /ocr-detection-(?:input-fill|mask-fill)-(?:start|done)/,
      /ocr-mask-mat-alloc-(?:start|done)/,
      /ocr-mask-mat-copy-(?:start|done)/,
      /ocr-(?:contours|hierarchy)-mat-alloc-(?:start|done)/,
      /ocr-source-mat-copy-(?:start|done)/,
      /ocr-line-(?:perspective|rotate)-(?:start|done)/,
      /structure-input-resize-draw-(?:start|done)/,
      /structure-worker-run-(?:start|done)/,
      /structure-score-image-read-(?:start|done)/,
      /ocr-detection-(?:output|input)-dispose-(?:start|done)/,
      /ocr-detection-cleanup-done/,
      /ocr-recognition-(?:preprocess|rotate)-(?:start|done)/,
      /ocr-recognition-(?:output-decode|output-dispose|input-dispose)-(?:start|done)/,
    ];
    return criticalPatterns.some(pattern => pattern.test(stage));
  }

  function recordAnalysisStage(job, stage, details = {}) {
    if (!job || typeof stage !== 'string') return;
    if (!details || typeof details !== 'object') details = {};
    const run = job.diagnosticRun || job;
    if (!run.runId) return;
    if (stage === 'ocr-source-mat-alloc-done') diagnosticStageState.sourceMatCreateCount = (diagnosticStageState.sourceMatCreateCount || 0) + 1;
    if (stage === 'analysis-start') {
      run.analysisStarted = true;
      diagnosticStageState.previousRun = null;
    }
    if (stage === 'analysis-complete') run.completed = true;
    if (String(stage).startsWith('analysis-aborted-')) run.aborted = true;
    if (stage === 'analysis-error') run.error = details;
    applyDiagnosticDetails(details);

    const memory = details.memory || details;
    const compactMemory = compactOcrMemory(memory);
    if (compactMemory) diagnosticStageState.memory = { ...diagnosticStageState.memory, ...compactMemory };
    const width = details.detectionTensorWidth || compactMemory?.detectionTensorWidth;
    const height = details.detectionTensorHeight || compactMemory?.detectionTensorHeight;
    if (width && height) {
      onnxRuntimeDiagnostics.detectionTensorShape = [1, 3, height, width];
      diagnosticStageState.memory = { ...diagnosticStageState.memory, detectionTensorWidth: width, detectionTensorHeight: height };
    }
    if (Number.isFinite(details.sourceWidth) && details.scope !== 'structure' && !String(stage).startsWith('structure-')) run.sourceWidth = details.sourceWidth;
    if (Number.isFinite(details.sourceHeight) && details.scope !== 'structure' && !String(stage).startsWith('structure-')) run.sourceHeight = details.sourceHeight;
    if (details.scope === 'ocr' && Number.isFinite(details.sourceWidth)) run.ocrSourceWidth = details.sourceWidth;
    if (details.scope === 'ocr' && Number.isFinite(details.sourceHeight)) run.ocrSourceHeight = details.sourceHeight;
    if ((stage === 'capture-canvas-resize-done' || stage === 'ocr-image-data-read-start' || stage === 'ocr-image-data-read-done') &&
        Number.isFinite(details.width) && Number.isFinite(details.height)) {
      run.ocrSourceWidth = details.width;
      run.ocrSourceHeight = details.height;
    }
    if (Number.isInteger(details.lineIndex)) run.lineIndex = details.lineIndex;
    if (Number.isInteger(details.lineCount)) run.lineCount = details.lineCount;

    diagnosticStageState.currentStage = stage;
    diagnosticStageState.runId = run.runId;
    const eventDetails = {
      runId: run.runId,
      sourceWidth: run.sourceWidth ?? null,
      sourceHeight: run.sourceHeight ?? null,
      ocrSourceWidth: run.ocrSourceWidth ?? null,
      ocrSourceHeight: run.ocrSourceHeight ?? null,
      detectionTensorWidth: diagnosticStageState.memory?.detectionTensorWidth ?? null,
      detectionTensorHeight: diagnosticStageState.memory?.detectionTensorHeight ?? null,
      lineIndex: Number.isInteger(details.lineIndex) ? details.lineIndex : run.lineIndex ?? null,
      lineCount: Number.isInteger(details.lineCount) ? details.lineCount : run.lineCount ?? null,
      onnxRuntimeVersion: core.config.onnxRuntimeWebVersion,
      graphOptimizationLevel: onnxRuntimeDiagnostics.graphOptimizationLevel,
      numThreads: onnxRuntimeDiagnostics.numThreads,
      currentKnownLiveBytes: diagnosticStageState.currentKnownLiveBytes,
      peakKnownLiveBytes: diagnosticStageState.peakKnownLiveBytes,
      activeWorkers: { ...diagnosticStageState.activeWorkers },
      runtimeStates: { ...diagnosticStageState.runtimeStates },
      sourceMatCreateCount: diagnosticStageState.sourceMatCreateCount || 0,
      ...details,
      runId: run.runId,
      sourceWidth: details.sourceWidth ?? run.sourceWidth ?? null,
      sourceHeight: details.sourceHeight ?? run.sourceHeight ?? null,
      ocrSourceWidth: run.ocrSourceWidth ?? null,
      ocrSourceHeight: run.ocrSourceHeight ?? null,
      detectionTensorWidth: details.detectionTensorWidth ?? diagnosticStageState.memory?.detectionTensorWidth ?? null,
      detectionTensorHeight: details.detectionTensorHeight ?? diagnosticStageState.memory?.detectionTensorHeight ?? null,
      lineIndex: Number.isInteger(details.lineIndex) ? details.lineIndex : run.lineIndex ?? null,
      lineCount: Number.isInteger(details.lineCount) ? details.lineCount : run.lineCount ?? null,
      onnxRuntimeVersion: core.config.onnxRuntimeWebVersion,
      graphOptimizationLevel: onnxRuntimeDiagnostics.graphOptimizationLevel,
      numThreads: onnxRuntimeDiagnostics.numThreads,
      knownLiveBytes: diagnosticStageState.currentKnownLiveBytes,
      currentKnownLiveBytes: diagnosticStageState.currentKnownLiveBytes,
      peakKnownLiveBytes: diagnosticStageState.peakKnownLiveBytes,
      activeWorkers: { ...diagnosticStageState.activeWorkers },
      runtimeStates: { ...diagnosticStageState.runtimeStates },
      sourceMatCreateCount: diagnosticStageState.sourceMatCreateCount || 0,
    };
    const event = run.reporter.stage(stage, eventDetails);
    run.seq = event.seq;
    run.trace = run.reporter.trace;
    diagnosticStageState.currentKnownLiveBytes = run.reporter.knownLiveBytes;
    diagnosticStageState.peakKnownLiveBytes = run.reporter.peakKnownLiveBytes;
    diagnosticStageState.activeWorkers = run.reporter.activeWorkers;
    Object.assign(diagnosticStageState.runtimeStates, run.reporter.runtimeState);
    diagnosticStageState.trace = run.trace;
    diagnosticStageState.localStorageWrites = run.localStorageWrites;

    if (shouldPersistDiagnosticStage(stage, details)) {
      try {
        const storage = global.localStorage;
        if (!storage) throw new Error('localStorage is unavailable in this browser context.');
        if (stage === 'analysis-start' || stage === 'analysis-complete') {
          if (storage.getItem('magiaAnalysisPreviousTrace') !== null) {
            storage.removeItem('magiaAnalysisPreviousTrace');
            run.localStorageWrites += 1;
          }
        }
        if (stage === 'image-file-received' || stage === 'analysis-start') {
          storage.setItem('magiaAnalysisRunId', run.runId);
          run.localStorageWrites += 1;
        }
        storage.setItem('magiaAnalysisStage', stage);
        run.localStorageWrites += 1;
        const snapshot = {
          runId: run.runId,
          startedTimestamp: run.startedTimestamp,
          analysisStarted: run.analysisStarted,
          completed: run.completed,
          aborted: run.aborted,
          lastStage: stage,
          currentKnownLiveBytes: diagnosticStageState.currentKnownLiveBytes,
          peakKnownLiveBytes: diagnosticStageState.peakKnownLiveBytes,
          activeWorkers: { ...diagnosticStageState.activeWorkers },
          runtimeStates: { ...diagnosticStageState.runtimeStates },
          sourceMatCreateCount: diagnosticStageState.sourceMatCreateCount || 0,
          environment: currentEnvironment(),
          localStorageWrites: run.localStorageWrites + 1,
          trace: run.trace,
        };
        storage.setItem('magiaAnalysisTrace', JSON.stringify(snapshot));
        run.localStorageWrites += 1;
        diagnosticStageState.localStorageWrites = run.localStorageWrites;
      } catch (error) {
        warnStageStorageUnavailable(error);
      }
    }
    publishRuntimeDiagnostics();
  }

  function recordAllocation(job, stage, allocationId, estimatedBytes, metadata = {}, action = 'allocate') {
    recordAnalysisStage(job, stage, {
      scope: 'main', allocationId, estimatedBytes,
      ...metadata,
      allocationAction: action,
    });
  }

  function recordCanvasEstimate(job, canvas, name) {
    const width = Math.max(0, Number(canvas?.width) || 0);
    const height = Math.max(0, Number(canvas?.height) || 0);
    const estimatedRgbaBackingBytes = width * height * 4;
    recordAnalysisStage(job, `${name}-canvas-size`, {
      canvas: { name, width, height, estimatedRgbaBackingBytes, countedInKnownLiveBytes: false },
      estimatedBytes: estimatedRgbaBackingBytes,
      estimateKind: 'canvas-backing-estimate-not-counted-as-live-buffer',
    });
  }

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

  async function loadVocabularyIndex(job = null) {
    const stage = (name, details = {}) => { if (job) recordAnalysisStage(job, name, details); };
    stage('vocabulary-start');
    stage('vocabulary-cache-open-start');
    const dictionaryResults = await Promise.allSettled([
      kotodamaDictionaryCache.load(core.config.forbiddenWordsUrl),
      kotodamaDictionaryCache.load(core.config.commonWordsUrl),
    ]);
    stage('vocabulary-cache-open-done', { fulfilledCount: dictionaryResults.filter(result => result.status === 'fulfilled').length });
    for (const result of dictionaryResults) {
      if (result.status === 'rejected') console.warn('コトダマギアの目録を控えられませんでした。', result.reason);
    }
    if (dictionaryResults.some(result => result.status === 'rejected')) {
      stage('vocabulary-cache-open-error', {
        errors: dictionaryResults.filter(result => result.status === 'rejected').map(result => ({
          name: String(result.reason?.name || 'Error'), message: String(result.reason?.message || result.reason).slice(0, 180),
        })),
      });
      return null;
    }

    try {
      stage('vocabulary-response-text-start', { responseCount: dictionaryResults.length });
      const [forbiddenText, commonText] = await Promise.all(dictionaryResults.map(result => result.value.text()));
      stage('vocabulary-response-text-done', {
        forbiddenTextLength: forbiddenText.length, commonTextLength: commonText.length,
        estimatedJsonBytes: (forbiddenText.length + commonText.length) * 2,
      });
      const signature = core.vocabularySignature(commonText, forbiddenText);
      stage('vocabulary-cache-match-start', { cacheKey: KOTODAMA_NGRAM_INDEX_CACHE_URL });
      const cachedIndexResponse = await kotodamaDictionaryCache.match(KOTODAMA_NGRAM_INDEX_CACHE_URL);
      stage('vocabulary-cache-match-done', { hit: Boolean(cachedIndexResponse) });
      let index = null;
      if (cachedIndexResponse) {
        let jsonParseStarted = false;
        try {
          stage('vocabulary-response-text-start', { source: 'cached-index' });
          const indexText = await cachedIndexResponse.text();
          stage('vocabulary-response-text-done', { source: 'cached-index', textLength: indexText.length, estimatedJsonBytes: indexText.length * 2 });
          stage('vocabulary-json-parse-start', { textLength: indexText.length, estimatedJsonBytes: indexText.length * 2 });
          jsonParseStarted = true;
          const cachedIndex = JSON.parse(indexText);
          jsonParseStarted = false;
          stage('vocabulary-json-parse-done', { wordCount: cachedIndex?.words?.length || 0 });
          if (isValidVocabularyIndex(cachedIndex) && cachedIndex.signature === signature) {
            index = cachedIndex;
          } else {
            await kotodamaDictionaryCache.delete(KOTODAMA_NGRAM_INDEX_CACHE_URL);
          }
        } catch (error) {
          if (jsonParseStarted) stage('vocabulary-json-parse-error', {
            error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) },
          });
          await kotodamaDictionaryCache.delete(KOTODAMA_NGRAM_INDEX_CACHE_URL);
          console.warn('文字列索引の控えを読み取れませんでした。', error);
        }
      }
      if (!index) {
        await yieldToBrowser();
        stage('vocabulary-index-create-start', { commonTextLength: commonText.length, forbiddenTextLength: forbiddenText.length });
        index = core.createVocabularyNgramIndex(commonText, forbiddenText);
        stage('vocabulary-index-create-done', { wordCount: index?.words?.length || 0 });
        if (!isValidVocabularyIndex(index)) throw new Error('一般語彙辞書に使用できる単語が不足しています。');
        stage('vocabulary-json-stringify-start', { wordCount: index.words.length });
        const serializedIndex = JSON.stringify(index);
        stage('vocabulary-json-stringify-done', { textLength: serializedIndex.length, estimatedJsonBytes: serializedIndex.length * 2 });
        await kotodamaDictionaryCache.put(KOTODAMA_NGRAM_INDEX_CACHE_URL, new Response(serializedIndex, {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }));
      }
      stage('vocabulary-done', { wordCount: index?.words?.length || 0 });
      return index;
    } catch (error) {
      stage('vocabulary-error', { error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) } });
      console.warn('コトダマギアの目録を補正索引にできませんでした。', error);
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

  const diagnostics = diagnosticsEnabled
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
        const blob = new Blob([JSON.stringify({
          image: diagnostics.image,
          spell: diagnostics.spell,
          circle: diagnostics.circle,
          attribute: diagnostics.attribute,
          sigil: diagnostics.sigil,
          power: diagnostics.power,
          onnxRuntime: onnxRuntimeDiagnostics,
          analysisDiagnostics: createDiagnosticExport(),
        }, null, 2)], { type: 'application/json' });
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
    output.textContent = JSON.stringify({
      image: diagnostics.image,
      spell,
      circle,
      attribute: diagnostics.attribute,
      sigil: diagnostics.sigil,
      power: diagnostics.power,
      onnxRuntime: onnxRuntimeDiagnostics,
      analysisDiagnostics: createDiagnosticExport(),
    });
  }

  function createDiagnosticExport() {
    const showingPreviousRun = Boolean(diagnosticStageState.previousRun?.interrupted);
    const run = showingPreviousRun ? diagnosticStageState.previousRun : activeDiagnosticRun || diagnosticStageState.previousRun;
    const currentKnownLiveBytes = !showingPreviousRun && activeDiagnosticRun ? diagnosticStageState.currentKnownLiveBytes : run?.currentKnownLiveBytes ?? diagnosticStageState.currentKnownLiveBytes;
    const peakKnownLiveBytes = !showingPreviousRun && activeDiagnosticRun ? diagnosticStageState.peakKnownLiveBytes : run?.peakKnownLiveBytes ?? diagnosticStageState.peakKnownLiveBytes;
    return {
      runId: run?.runId || diagnosticStageState.runId,
      completed: Boolean(run?.completed),
      aborted: Boolean(run?.aborted),
      interrupted: Boolean(run?.interrupted),
      lastStage: run?.trace?.at(-1)?.stage || diagnosticStageState.currentStage,
      currentKnownLiveBytes,
      peakKnownLiveBytes,
      activeWorkers: { ...(!showingPreviousRun && activeDiagnosticRun ? diagnosticStageState.activeWorkers : run?.activeWorkers || diagnosticStageState.activeWorkers) },
      runtimeStates: { ...(!showingPreviousRun && activeDiagnosticRun ? diagnosticStageState.runtimeStates : run?.runtimeStates || diagnosticStageState.runtimeStates) },
      sourceMatCreateCount: diagnosticStageState.sourceMatCreateCount || run?.sourceMatCreateCount || 0,
      environment: run?.environment || currentEnvironment(),
      localStorageWrites: run?.localStorageWrites ?? diagnosticStageState.localStorageWrites,
      trace: (run?.trace || diagnosticStageState.trace).slice(-DIAGNOSTIC_TRACE_LIMIT),
      ...(run?.error ? { error: run.error } : {}),
    };
  }

  function diagnosticCauseForStage(stage) {
    const causes = {
      'ocr-detection-input-buffer-alloc-start': 'Detection Float32入力bufferの確保中に終了した可能性',
      'ocr-detection-run-start': 'Detection ONNX WASM inference中に終了した可能性',
      'ocr-detection-mask-buffer-alloc-start': 'Detection mask Uint8 bufferの確保中に終了した可能性',
      'ocr-opencv-import-start': 'OpenCV moduleのimport中に終了した可能性',
      'ocr-mask-mat-alloc-start': 'OpenCV mask Matの確保中に終了した可能性',
      'ocr-find-contours-start': 'OpenCV findContours内部処理中に終了した可能性',
      'ocr-source-align-buffer-alloc-start': 'source alignment RGBA bufferの確保中に終了した可能性',
      'ocr-source-mat-alloc-start': 'OpenCV source Matの確保中に終了した可能性',
      'ocr-line-materialize-start': 'Recognition対象line cropの実体化中に終了した可能性',
      'ocr-recognition-preprocess-start': 'Recognition前処理中に終了した可能性',
      'ocr-recognition-model-buffer-start': 'Recognition model ArrayBuffer生成中に終了した可能性',
      'ocr-recognition-session-create-start': 'Recognition ONNX Session生成中に終了した可能性',
      'ocr-recognition-input-buffer-alloc-start': 'Recognition Float32入力bufferの確保中に終了した可能性',
      'ocr-recognition-run-start': 'Recognition ONNX WASM inference中に終了した可能性',
      'structure-input-get-image-data-start': 'Structure Worker入力ImageDataの確保中に終了した可能性',
      'structure-worker-run-start': 'Structure Workerの構造解析中に終了した可能性',
      'master-image-get-image-data-start': 'full-size master ImageDataの確保中に終了した可能性',
      'structure-score-run-start': 'Structure score計算中に終了した可能性',
      'vocabulary-response-text-start': '大規模辞書Response.text()中に終了した可能性',
      'vocabulary-json-parse-start': '大規模辞書JSON.parse中に終了した可能性',
      'vocabulary-corrector-create-start': '大規模corrector Map/index生成中に終了した可能性',
      'embedding-worker-create-start': 'Embedding Worker生成中に終了した可能性',
      'embedding-model-load-start': 'Embeddingモデルロード中に終了した可能性',
      'embedding-pipeline-create-start': 'Transformers pipeline生成・モデル接続中に終了した可能性',
      'embedding-run-start': 'Embedding inference中に終了した可能性',
      'image-selection-commit-error': '画像のcanvas反映または選択確定処理で例外が発生した可能性',
    };
    return causes[stage] || (stage?.startsWith('ocr-') ? 'OCR処理中に終了した可能性'
      : stage?.startsWith('embedding-') ? 'Embedding処理中に終了した可能性'
        : stage?.startsWith('structure-') || stage?.startsWith('master-image-') ? 'Structure Analysis処理中に終了した可能性'
          : 'このstage付近で終了した可能性');
  }

  function publishRuntimeDiagnostics() {
    if (!diagnosticsEnabled) return;
    let panel = document.getElementById('analysisRuntimeDiagnostics');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'analysisRuntimeDiagnostics';
      panel.setAttribute('aria-label', '画像解析stageとメモリ見積もり');
      panel.style.cssText = 'margin:1rem 0;padding:1rem;border:1px solid #79909a;border-radius:8px;background:#111b25;color:#e5edf0';
      const heading = document.createElement('strong');
      heading.textContent = 'OCR runtime diagnostics';
      const output = document.createElement('pre');
      output.id = 'analysisRuntimeDiagnosticsText';
      output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:.5rem 0 0;font:12px/1.6 ui-monospace,monospace';
      const lastEvent = document.createElement('pre');
      lastEvent.id = 'analysisRuntimeDiagnosticsLastEvent';
      lastEvent.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:.5rem 0;padding:.75rem;background:#34261d;color:#fff0d9;font:12px/1.6 ui-monospace,monospace';
      const recentDetails = document.createElement('details');
      const recentSummary = document.createElement('summary');
      recentSummary.textContent = 'Previous 20 events';
      const recentEvents = document.createElement('pre');
      recentEvents.id = 'analysisRuntimeDiagnosticsRecentEvents';
      recentEvents.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace';
      recentDetails.append(recentSummary, recentEvents);
      const traceDetails = document.createElement('details');
      const traceSummary = document.createElement('summary');
      traceSummary.textContent = 'Full trace (up to 64 events)';
      const traceOutput = document.createElement('pre');
      traceOutput.id = 'analysisRuntimeDiagnosticsTrace';
      traceOutput.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;font:11px/1.45 ui-monospace,monospace';
      traceDetails.append(traceSummary, traceOutput);
      panel.append(heading, output, lastEvent, recentDetails, traceDetails);
      document.body.append(panel);
    }
    const output = document.getElementById('analysisRuntimeDiagnosticsText');
    const memory = diagnosticStageState.memory || {};
    const memoryMib = bytes => Number.isFinite(bytes) ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : 'pending';
    const previousRun = diagnosticStageState.previousRun;
    const showingPreviousRun = Boolean(previousRun?.interrupted);
    const trace = !showingPreviousRun && activeDiagnosticRun?.trace?.length ? activeDiagnosticRun.trace : diagnosticStageState.trace || [];
    const visibleTrace = showingPreviousRun ? previousRun.trace : trace.length ? trace : previousRun?.trace || [];
    const last = visibleTrace.at(-1) || null;
    const lastDetails = last?.details || {};
    const previousTraceDetails = showingPreviousRun
      ? [...visibleTrace].reverse().map(event => event.details || {})
      : [];
    const detailFor = key => previousTraceDetails.find(details => Number.isFinite(details[key]))?.[key];
    const displayMemory = showingPreviousRun ? {
      ocrInputWidth: detailFor('ocrInputWidth'),
      ocrInputHeight: detailFor('ocrInputHeight'),
      detectionTensorWidth: detailFor('detectionTensorWidth'),
      detectionTensorHeight: detailFor('detectionTensorHeight'),
      detectionMaskWidth: detailFor('detectionMaskWidth'),
      detectionMaskHeight: detailFor('detectionMaskHeight'),
      inputFloat32EstimatedBytes: detailFor('inputFloat32EstimatedBytes'),
      maskEstimatedBytes: detailFor('maskEstimatedBytes'),
    } : memory;
    const previousOcrSourceWidth = showingPreviousRun ? detailFor('ocrSourceWidth') : activeDiagnosticRun?.ocrSourceWidth;
    const previousOcrSourceHeight = showingPreviousRun ? detailFor('ocrSourceHeight') : activeDiagnosticRun?.ocrSourceHeight;
    const displayCanvas = showingPreviousRun
      ? previousTraceDetails.find(details => details.canvas)?.canvas || null
      : diagnosticStageState.canvas;
    const lastEstimatedAllocationBytes = Number.isFinite(lastDetails.estimatedBytes)
      ? lastDetails.estimatedBytes
      : Number.isFinite(lastDetails.inputEstimatedBytes) ? lastDetails.inputEstimatedBytes : null;
    const lastEvent = document.getElementById('analysisRuntimeDiagnosticsLastEvent');
    if (lastEvent) {
      lastEvent.textContent = [
        showingPreviousRun ? 'LAST EVENT BEFORE RELOAD' : 'LAST EVENT',
        last ? `#${last.seq} +${last.elapsedMs}ms` : 'No diagnostic events yet',
        last?.stage || diagnosticStageState.currentStage,
        `Likely: ${diagnosticCauseForStage(last?.stage || diagnosticStageState.currentStage)}`,
        Number.isFinite(lastEstimatedAllocationBytes) ? `Estimated allocation: ${memoryMib(lastEstimatedAllocationBytes)}` : null,
        Number.isFinite(lastDetails.currentKnownLiveBytes) ? `Known application-controlled buffers at this event: ${memoryMib(lastDetails.currentKnownLiveBytes)}` : null,
      ].filter(Boolean).join('\n');
    }
    const recentEvents = document.getElementById('analysisRuntimeDiagnosticsRecentEvents');
    if (recentEvents) recentEvents.textContent = visibleTrace.slice(-20)
      .map(event => `#${event.seq} +${event.elapsedMs}ms ${event.stage}${Number.isFinite(event.details?.estimatedBytes) ? ` (${memoryMib(event.details.estimatedBytes)})` : ''}`)
      .join('\n');
    const traceOutput = document.getElementById('analysisRuntimeDiagnosticsTrace');
    if (traceOutput) traceOutput.textContent = JSON.stringify(visibleTrace, null, 2);
    output.textContent = [
      `Previous interrupted run: ${showingPreviousRun ? 'yes' : 'no'}`,
      `Current stage: ${showingPreviousRun ? previousRun.lastStage || last?.stage : diagnosticStageState.currentStage}`,
      `Previous interrupted stage: ${showingPreviousRun ? previousRun.lastStage || last?.stage : diagnosticStageState.previousInterruptedStage}`,
      `Run ID: ${showingPreviousRun ? previousRun.runId : diagnosticStageState.runId}`,
      `Known application-controlled buffers (current): ${memoryMib(!showingPreviousRun && activeDiagnosticRun ? diagnosticStageState.currentKnownLiveBytes : previousRun?.currentKnownLiveBytes ?? diagnosticStageState.currentKnownLiveBytes)}`,
      `Known application-controlled buffers (peak): ${memoryMib(!showingPreviousRun && activeDiagnosticRun ? diagnosticStageState.peakKnownLiveBytes : previousRun?.peakKnownLiveBytes ?? diagnosticStageState.peakKnownLiveBytes)}`,
      `Active workers: ${JSON.stringify(!showingPreviousRun && activeDiagnosticRun ? diagnosticStageState.activeWorkers : previousRun?.activeWorkers || diagnosticStageState.activeWorkers)}`,
      `Runtime states: ${JSON.stringify(!showingPreviousRun && activeDiagnosticRun ? diagnosticStageState.runtimeStates : previousRun?.runtimeStates || diagnosticStageState.runtimeStates)}`,
      `OpenCV source Mat create count: ${diagnosticStageState.sourceMatCreateCount || previousRun?.sourceMatCreateCount || 0}`,
      `LocalStorage diagnostic writes: ${diagnosticStageState.localStorageWrites}`,
      `Analysis canvas estimated RGBA backing: ${displayCanvas ? `${displayCanvas.width}x${displayCanvas.height} (${memoryMib(displayCanvas.estimatedRgbaBackingBytes)})` : 'pending'}`,
      `OCR input: ${displayMemory.ocrInputWidth ?? previousOcrSourceWidth ?? lastDetails.ocrSourceWidth ?? 'pending'}x${displayMemory.ocrInputHeight ?? previousOcrSourceHeight ?? lastDetails.ocrSourceHeight ?? 'pending'}`,
      `Detection tensor: ${displayMemory.detectionTensorWidth ?? 'pending'}x${displayMemory.detectionTensorHeight ?? 'pending'}`,
      `Detection mask: ${displayMemory.detectionMaskWidth ?? 'pending'}x${displayMemory.detectionMaskHeight ?? 'pending'}`,
      `Input Float32 estimated: ${memoryMib(displayMemory.inputFloat32EstimatedBytes)}`,
      `Mask estimated: ${memoryMib(displayMemory.maskEstimatedBytes)}`,
      `ONNX Runtime version: ${onnxRuntimeDiagnostics.version}`,
      `Execution provider: ${onnxRuntimeDiagnostics.executionProvider}`,
      `Graph optimization level: ${onnxRuntimeDiagnostics.graphOptimizationLevel} (${onnxRuntimeDiagnostics.graphOptimizationLevelSource})`,
      `Execution mode: ${onnxRuntimeDiagnostics.executionMode}`,
      `numThreads: ${onnxRuntimeDiagnostics.numThreads}`,
      `enableCpuMemArena: ${onnxRuntimeDiagnostics.enableCpuMemArena}`,
      `enableMemPattern: ${onnxRuntimeDiagnostics.enableMemPattern}`,
      `Detection tensor shape: ${showingPreviousRun && displayMemory.detectionTensorHeight && displayMemory.detectionTensorWidth
        ? `1x3x${displayMemory.detectionTensorHeight}x${displayMemory.detectionTensorWidth}`
        : onnxRuntimeDiagnostics.detectionTensorShape?.join('x') ?? 'pending'}`,
      ...(diagnosticStageState.error ? [`Last OCR error: ${diagnosticStageState.error}`] : []),
    ].join('\n');
  }

  function recordDiagnosticError(error, job = activeAnalysisJob) {
    diagnosticStageState.error = String(error?.message || error || 'Unknown OCR error').slice(0, 240);
    if (job) recordAnalysisStage(job, 'ocr-worker-error', {
      error: { name: String(error?.name || 'Error'), message: diagnosticStageState.error },
      failedStage: diagnosticStageState.currentStage,
    });
    publishRuntimeDiagnostics();
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
      if (!pending || pending.worker !== worker || message.jobId !== pending.job.id) return;
      if (message.type === 'diagnostic-stage') {
        recordAnalysisStage(pending.job, message.stage, message.details || {});
        if (message.stage === 'structure-worker-run-done' && pending.structureAllocationId) {
          recordAllocation(pending.job, 'structure-input-buffer-release-done', pending.structureAllocationId, pending.structureEstimatedBytes || 0, {
            sourceWidth: pending.inputWidth, sourceHeight: pending.inputHeight, scope: 'main',
          }, 'release');
          pending.structureAllocationId = null;
        }
        return;
      }
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
      };
      try {
        worker = ensureAnalysisWorker(job);
        pending.worker = worker;
        pending.inputWidth = analysisImage.image.width;
        pending.inputHeight = analysisImage.image.height;
        analysisPending = pending;
        assertActiveAnalysisJob(job);
        const transferable = analysisImage.image.data.buffer;
        pending.structureAllocationId = 'structure-input-rgba';
        pending.structureEstimatedBytes = analysisImage.image.data.byteLength;
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
        analysisImage = null;
      } catch (error) {
        analysisPending = null;
        terminateAnalysisWorker(worker, job);
        if (pending.structureAllocationId && diagnosticAllocations.has(`main:${pending.structureAllocationId}`)) {
          recordAllocation(job, 'structure-input-transfer-failed-release', pending.structureAllocationId, pending.structureEstimatedBytes || 0, {}, 'release');
        } else if (analysisImage && diagnosticAllocations.has('main:structure-input-rgba')) {
          recordAllocation(job, 'structure-input-buffer-release-done', 'structure-input-rgba', analysisImage.image?.data?.byteLength || 0, { reason: 'worker-create-failed' }, 'release');
        }
        analysisImage = null;
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

  function terminateOcrWorker(job, worker = job?.ocrWorker) {
    if (!worker) return;
    recordAnalysisStage(job, 'ocr-worker-terminate-start', { workerType: 'ocr' });
    if (job.ocrWorker === worker) job.ocrWorker = null;
    worker.terminate();
    recordAnalysisStage(job, 'ocr-worker-terminate-done', {
      workerType: 'ocr', workerAction: 'stop',
      runtimeState: { ortDetectionLoaded: false, opencvLoaded: false, clipperLoaded: false, recognizerLoaded: false },
    });
    recordAnalysisStage(job, 'ocr-worker-reference-release', { workerType: 'ocr' });
    if (job.ocrSourceAllocationId && diagnosticAllocations.has(`main:${job.ocrSourceAllocationId}`)) {
      recordAllocation(job, 'ocr-source-rgba-release-done', job.ocrSourceAllocationId, job.ocrSourceEstimatedBytes || 0, {}, 'release');
      job.ocrSourceAllocationId = null;
    }
    recordAnalysisStage(job, 'ocr-worker-terminated');
  }

  function requestSpellRecognition(canvas, job) {
    return new Promise((resolve, reject) => {
      let worker = null;
      let pixels = null;
      let buffer = null;
      let abortTimeout = null;
      let settled = false;
      const cleanup = () => {
        job.signal.removeEventListener('abort', onAbort);
        clearTimeout(abortTimeout);
        abortTimeout = null;
        if (worker) {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          worker.removeEventListener('messageerror', onMessageError);
          terminateOcrWorker(job, worker);
          worker = null;
        }
        if (job.ocrSourceAllocationId && diagnosticAllocations.has(`main:${job.ocrSourceAllocationId}`)) {
          recordAllocation(job, 'ocr-source-rgba-release-done', job.ocrSourceAllocationId, job.ocrSourceEstimatedBytes || 0, { reason: 'worker-cleanup' }, 'release');
          job.ocrSourceAllocationId = null;
        }
        pixels = null;
        buffer = null;
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
        const error = new Error(event.error?.message || event.message || 'OCR Workerでエラーが発生しました。');
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
          recordAnalysisStage(job, message.stage, message.details || message.memory || {});
        } else if (message.type === 'progress') {
          setStatus(modelStatus, message.message || '環の呪文を読み取っています…', 'busy');
        } else if (message.type === 'success') {
          recordAnalysisStage(job, 'ocr-worker-result-received', { resultType: 'success' });
          finish(job.signal.aborted ? reject : resolve, job.signal.aborted ? job.signal.reason || makeAnalysisAbortError() : message.result);
        } else if (message.type === 'error') {
          const error = new Error(message.message || 'OCRに失敗しました。');
          error.name = message.name || 'Error';
          recordAnalysisStage(job, 'ocr-worker-result-received', { resultType: 'error', error: { name: error.name, message: String(error.message).slice(0, 240) } });
          recordDiagnosticError(error, job);
          finish(reject, job.signal.aborted ? job.signal.reason || error : error);
        }
      };

      try {
        assertActiveAnalysisJob(job);
        const width = canvas.width;
        const height = canvas.height;
        const estimatedBytes = width * height * 4;
        recordAnalysisStage(job, 'ocr-image-data-read-start', { width, height, estimatedBytes, allocationId: 'ocr-source-rgba' });
        pixels = captureContext.getImageData(0, 0, canvas.width, canvas.height);
        recordAllocation(job, 'ocr-image-data-read-done', 'ocr-source-rgba', pixels.data.byteLength, {
          width, height, sourceWidth: width, sourceHeight: height, type: 'Uint8ClampedArray',
        });
        recordAnalysisStage(job, 'ocr-transfer-buffer-ready', { width, height, estimatedBytes: pixels.data.byteLength, allocationId: 'ocr-source-rgba' });
        assertActiveAnalysisJob(job);
        recordAnalysisStage(job, 'ocr-worker-create-start', { workerType: 'ocr' });
        worker = new Worker(new URL('assets/js/magia-circle-ocr-worker.js', document.baseURI));
        job.ocrWorker = worker;
        job.ocrSourceAllocationId = 'ocr-source-rgba';
        job.ocrSourceEstimatedBytes = pixels.data.byteLength;
        recordAnalysisStage(job, 'ocr-worker-create-done', { workerType: 'ocr', workerAction: 'start' });
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.addEventListener('messageerror', onMessageError);
        job.signal.addEventListener('abort', onAbort, { once: true });
        buffer = pixels.data.buffer;
        recordAnalysisStage(job, 'ocr-worker-message-transfer-start', {
          width, height, estimatedBytes: pixels.data.byteLength, allocationId: 'ocr-source-rgba',
        });
        worker.postMessage({
          type: 'analyze',
          jobId: job.id,
          runId: job.runId,
          width: canvas.width,
          height: canvas.height,
          buffer,
          diagnostics: diagnosticsEnabled,
        }, [buffer]);
        recordAnalysisStage(job, 'ocr-worker-message-transfer-done', {
          width, height, estimatedBytes: job.ocrSourceEstimatedBytes, allocationId: 'ocr-source-rgba',
        });
        buffer = null;
        pixels = null;
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function recognizeSpell(canvas, job) {
    const recognition = requestSpellRecognition(canvas, job);
    const releasedRecognition = recognition.finally(async () => {
      recordAnalysisStage(job, 'post-ocr-wait-start', { waitMs: 150 });
      await new Promise(resolve => setTimeout(resolve, 150));
      recordAnalysisStage(job, 'post-ocr-wait-done', { waitMs: 150 });
    });
    activeOcrRun = releasedRecognition.then(() => undefined, () => undefined);
    const recognized = await awaitForAnalysisJob(job, releasedRecognition);
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
        onRecognitionRetry: async ({ error }) => {
          console.warn('OCR処理に失敗したため、一度だけ自動再試行します。', error);
          appendProcessingRecord(`${job.fileName}：OCR処理エラーのため、同じ画像で一度だけ自動再試行します。`);
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
      if (job.diagnosticRun.trace.at(-1)?.stage !== 'analysis-error') recordAnalysisStage(job, 'analysis-error', {
        error: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) },
        failedStage: diagnosticStageState.currentStage,
      });
      if (!isActiveAnalysisJob(job)) return;
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

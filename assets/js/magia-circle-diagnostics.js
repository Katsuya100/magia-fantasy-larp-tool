(function registerMagiaCircleDiagnostics(global) {
  'use strict';

  // A per-page diagnostic session owns allocation accounting and bounded storage.
  // Worker control remains in the application; diagnostics only observe events.
  function create({ config, enabled = false, onChange = () => {} }) {
    const diagnosticsEnabled = enabled;
    const DIAGNOSTIC_TRACE_LIMIT = global.MagiaAnalysisDiagnostics.TRACE_LIMIT;
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
    const onnxRuntimeDiagnostics = {
      version: config.onnxRuntimeWebVersion,
      ...config.onnxRuntimeDefaults,
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
      activeDiagnosticRun?.persistBatcher?.flush();
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
        previousTraceCleared: false,
        recognitionAllocationPeaks: new Map(),
        runIdStored: false,
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
        onnxRuntimeVersion: config.onnxRuntimeWebVersion,
        graphOptimizationLevel: onnxRuntimeDiagnostics.graphOptimizationLevel,
        numThreads: onnxRuntimeDiagnostics.numThreads,
      });
      run.persistBatcher = global.MagiaAnalysisDiagnostics.createStageBatcher(() => persistDiagnosticTrace(run));
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

    function persistDiagnosticTrace(run) {
      if (!run?.runId || !run.reporter) return;
      try {
        const storage = global.localStorage;
        if (!storage) throw new Error('localStorage is unavailable in this browser context.');
        const stage = run.trace.at(-1)?.stage || diagnosticStageState.currentStage;
        if (stage === 'analysis-start' && !run.previousTraceCleared) {
          if (storage.getItem('magiaAnalysisPreviousTrace') !== null) {
            storage.removeItem('magiaAnalysisPreviousTrace');
            run.localStorageWrites += 1;
          }
          run.previousTraceCleared = true;
        }
        if (stage === 'image-file-received' && !run.runIdStored) {
          storage.setItem('magiaAnalysisRunId', run.runId);
          run.localStorageWrites += 1;
          run.runIdStored = true;
        }
        if (stage === 'analysis-start' || stage === 'analysis-complete' || stage === 'analysis-error' || stage.startsWith('analysis-aborted-')) {
          storage.setItem('magiaAnalysisStage', stage);
          run.localStorageWrites += 1;
        }
        const nextWriteCount = run.localStorageWrites + 1;
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
          localStorageWrites: nextWriteCount,
          trace: run.trace,
        };
        storage.setItem('magiaAnalysisTrace', JSON.stringify(snapshot));
        run.localStorageWrites = nextWriteCount;
        diagnosticStageState.localStorageWrites = run.localStorageWrites;
      } catch (error) {
        warnStageStorageUnavailable(error);
      }
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
        onnxRuntimeVersion: config.onnxRuntimeWebVersion,
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
        onnxRuntimeVersion: config.onnxRuntimeWebVersion,
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

      run.persistBatcher?.add(global.MagiaAnalysisDiagnostics.isCriticalStage(stage, details, run.recognitionAllocationPeaks));
      onChange();
    }

    function recordAllocation(job, stage, allocationId, estimatedBytes, metadata = {}, action = 'allocate') {
      recordAnalysisStage(job, stage, {
        scope: 'main', allocationId, estimatedBytes,
        ...metadata,
        allocationAction: action,
      });
    }

    function clearDiagnosticAllocationsByScope(job, scope) {
      const run = job?.diagnosticRun || job;
      if (!run?.reporter) return { releasedTrackedBytes: 0, allocationCount: 0, remainingKnownLiveBytes: diagnosticStageState.currentKnownLiveBytes };
      const prefix = `${String(scope || '')}:`;
      let releasedFromMirror = 0;
      let mirroredCount = 0;
      for (const [id, allocation] of diagnosticAllocations) {
        if (!id.startsWith(prefix)) continue;
        releasedFromMirror += allocation.estimatedBytes;
        mirroredCount += 1;
        diagnosticAllocations.delete(id);
      }
      const cleared = run.reporter.clearAllocationsByScope(scope);
      diagnosticStageState.currentKnownLiveBytes = run.reporter.knownLiveBytes;
      diagnosticStageState.peakKnownLiveBytes = run.reporter.peakKnownLiveBytes;
      const result = {
        scope,
        releasedTrackedBytes: cleared.releasedTrackedBytes || releasedFromMirror,
        allocationCount: cleared.allocationCount || mirroredCount,
        remainingKnownLiveBytes: run.reporter.knownLiveBytes,
        currentKnownLiveBytes: run.reporter.knownLiveBytes,
      };
      recordAnalysisStage(job, 'diagnostic-scope-clear', result);
      return result;
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

    function recordDiagnosticError(error, job = null) {
      diagnosticStageState.error = String(error?.message || error || 'Unknown OCR error').slice(0, 240);
      if (job) recordAnalysisStage(job, 'ocr-worker-error', {
        error: { name: String(error?.name || 'Error'), message: diagnosticStageState.error },
        failedStage: diagnosticStageState.currentStage,
      });
      onChange();
    }


    return {
      enabled: diagnosticsEnabled, diagnosticStageState, diagnosticAllocations, onnxRuntimeDiagnostics,
      createAnalysisRunId, beginDiagnosticRun, recordAnalysisStage, recordAllocation,
      clearDiagnosticAllocationsByScope, recordCanvasEstimate, recordDiagnosticError,
      currentEnvironment,
      get activeRun() { return activeDiagnosticRun; },
    };
  }

  global.MagiaCircleDiagnostics = Object.freeze({ create });
}(globalThis));

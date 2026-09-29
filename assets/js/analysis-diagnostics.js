(function registerMagiaAnalysisDiagnostics(global) {
  'use strict';

  const TRACE_LIMIT = 64;

  function rgbaBytes(width, height) {
    return Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0) * 4;
  }

  function floatRgbBytes(width, height) {
    return Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0) * 3 * Float32Array.BYTES_PER_ELEMENT;
  }

  function createReporter(scope, send = () => {}) {
    let runId = 'none';
    let context = {};
    let seq = 0;
    let startedAt = global.performance?.now?.() ?? Date.now();
    let knownLiveBytes = 0;
    let peakKnownLiveBytes = 0;
    const allocations = new Map();
    const activeWorkers = { ocr: 0, structure: 0, embedding: 0 };
    const runtimeState = {};
    const trace = [];

    function begin(nextRunId, initialContext = {}) {
      runId = String(nextRunId || 'none');
      context = { ...initialContext };
      seq = 0;
      startedAt = global.performance?.now?.() ?? Date.now();
      knownLiveBytes = 0;
      peakKnownLiveBytes = 0;
      allocations.clear();
      trace.length = 0;
      for (const key of Object.keys(activeWorkers)) activeWorkers[key] = 0;
      for (const key of Object.keys(runtimeState)) delete runtimeState[key];
    }

    function updateContext(details = {}) {
      for (const key of [
        'sourceWidth', 'sourceHeight', 'ocrSourceWidth', 'ocrSourceHeight',
        'detectionTensorWidth', 'detectionTensorHeight', 'lineIndex', 'lineCount',
        'onnxRuntimeVersion', 'graphOptimizationLevel', 'numThreads',
      ]) {
        if (details[key] !== undefined) context[key] = details[key];
      }
    }

    function applyAllocation(details) {
      if (!details.allocationAction || !details.allocationId || details.countedInKnownLive === false) return;
      const id = `${details.scope || scope}:${details.allocationId}`;
      if (details.allocationAction === 'allocate') {
        const previous = allocations.get(id);
        if (previous) knownLiveBytes = Math.max(0, knownLiveBytes - previous.estimatedBytes);
        const estimatedBytes = Math.max(0, Number(details.estimatedBytes) || 0);
        allocations.set(id, {
          scope: String(details.scope || scope),
          name: String(details.name || details.allocationId),
          estimatedBytes,
          ...(Number.isFinite(details.width) ? { width: details.width } : {}),
          ...(Number.isFinite(details.height) ? { height: details.height } : {}),
          type: String(details.type || 'ArrayBuffer'),
        });
        knownLiveBytes += estimatedBytes;
        peakKnownLiveBytes = Math.max(peakKnownLiveBytes, knownLiveBytes);
      } else if (details.allocationAction === 'release') {
        const previous = allocations.get(id);
        if (previous) {
          knownLiveBytes = Math.max(0, knownLiveBytes - previous.estimatedBytes);
          allocations.delete(id);
        }
      }
    }

    function applyWorkerAndRuntimeState(details) {
      if (details.workerAction && details.workerType in activeWorkers) {
        const delta = details.workerAction === 'start' ? 1 : details.workerAction === 'stop' ? -1 : 0;
        activeWorkers[details.workerType] = Math.max(0, activeWorkers[details.workerType] + delta);
        runtimeState[`${details.workerType}WorkerActive`] = activeWorkers[details.workerType] > 0;
      }
      if (details.runtimeState && typeof details.runtimeState === 'object') Object.assign(runtimeState, details.runtimeState);
    }

    function stage(name, details = {}) {
      if (!details || typeof details !== 'object') details = {};
      updateContext(details);
      applyAllocation(details);
      applyWorkerAndRuntimeState(details);
      const event = {
        seq: ++seq,
        runId,
        stage: String(name),
        elapsedMs: Math.max(0, Number(((global.performance?.now?.() ?? Date.now()) - startedAt).toFixed(1))),
        timestamp: Date.now(),
        details: {
          ...context,
          ...details,
          scope: details.scope || scope,
          runId,
          knownLiveBytes,
          currentKnownLiveBytes: knownLiveBytes,
          peakKnownLiveBytes,
          activeWorkers: { ...activeWorkers },
          runtimeStates: { ...runtimeState },
        },
      };
      trace.push(event);
      if (trace.length > TRACE_LIMIT) trace.splice(0, trace.length - TRACE_LIMIT);
      send({ type: 'diagnostic-stage', ...event });
      return event;
    }

    function allocationStart(name, allocationId, estimatedBytes, metadata = {}) {
      return stage(name, { allocationId, estimatedBytes, ...metadata, allocationPhase: 'start' });
    }

    function allocationDone(name, allocationId, estimatedBytes, metadata = {}) {
      return stage(name, {
        allocationId,
        estimatedBytes,
        ...metadata,
        ...(metadata.countedInKnownLive === false ? { countedInKnownLive: false } : { allocationAction: 'allocate' }),
      });
    }

    function releaseStart(name, allocationId, metadata = {}) {
      const allocation = allocations.get(`${metadata.scope || scope}:${allocationId}`);
      return stage(name, {
        allocationId,
        ...(allocation ? { estimatedBytes: allocation.estimatedBytes } : {}),
        ...metadata,
        allocationPhase: 'start',
      });
    }

    function releaseDone(name, allocationId, metadata = {}) {
      const allocation = allocations.get(`${metadata.scope || scope}:${allocationId}`);
      return stage(name, {
        allocationId,
        ...(allocation ? { estimatedBytes: allocation.estimatedBytes } : {}),
        ...metadata,
        ...(allocation ? { allocationAction: 'release' } : {}),
      });
    }

    function clearAllocationsByScope(targetScope) {
      const prefix = `${String(targetScope || '')}:`;
      let releasedTrackedBytes = 0;
      let allocationCount = 0;
      for (const [id, allocation] of allocations) {
        if (!id.startsWith(prefix)) continue;
        releasedTrackedBytes += allocation.estimatedBytes;
        allocationCount += 1;
        allocations.delete(id);
      }
      knownLiveBytes = Math.max(0, knownLiveBytes - releasedTrackedBytes);
      return { releasedTrackedBytes, allocationCount, remainingKnownLiveBytes: knownLiveBytes };
    }

    return Object.freeze({
      begin,
      stage,
      updateContext,
      allocationStart,
      allocationDone,
      releaseStart,
      releaseDone,
      clearAllocationsByScope,
      get runId() { return runId; },
      get trace() { return trace.slice(); },
      get knownLiveBytes() { return knownLiveBytes; },
      get peakKnownLiveBytes() { return peakKnownLiveBytes; },
      get activeWorkers() { return { ...activeWorkers }; },
      get runtimeState() { return { ...runtimeState }; },
      get activeAllocations() { return [...allocations].map(([id, metadata]) => ({ id, ...metadata })); },
    });
  }

  // Keep detailed stages in memory until a meaningful boundary. Event-count or
  // timer-driven snapshots otherwise turn long Recognition runs into hundreds
  // of synchronous localStorage writes.
  function createStageBatcher(flush, { batchSize = Infinity, delayMs = -1 } = {}) {
    let pending = 0;
    let timer = null;

    function flushNow() {
      if (!pending) return false;
      if (timer !== null) global.clearTimeout(timer);
      timer = null;
      pending = 0;
      flush();
      return true;
    }

    function add(immediate = false) {
      pending += 1;
      if (immediate || pending >= Math.max(1, batchSize)) {
        flushNow();
        return;
      }
      if (timer === null && Number.isFinite(delayMs) && delayMs >= 0) timer = global.setTimeout(flushNow, delayMs);
    }

    return Object.freeze({ add, flush: flushNow, get pending() { return pending; } });
  }

  function isCriticalStage(stage, details = {}, recognitionAllocationPeaks = null) {
    if (typeof stage !== 'string') return false;
    if (stage === 'image-file-received' || stage.startsWith('analysis-') || stage.endsWith('-error')) return true;
    if ([
      'diagnostic-scope-clear',
      'structure-worker-ready',
      'structure-input-transfer-start',
      'structure-input-transfer-done',
      'structure-worker-message-received',
      'structure-worker-run-start',
      'structure-worker-run-done',
    ].includes(stage)) return true;
    if (details.workerAction || (stage === 'ocr-worker-result-received' && details.resultType === 'error')) return true;
    if (/^ocr-(?:detection|opencv-phase|recognition)-(?:start|done)$/.test(stage)) return true;
    const estimatedBytes = Number(details.estimatedBytes ?? details.inputEstimatedBytes);
    const largeBufferStart = Number.isFinite(estimatedBytes) && estimatedBytes >= 1024 * 1024 &&
      /(?:alloc|arraybuffer|image-data(?:-[a-z]+)?|transfer|mat|buffer|fill|copy|render|perspective)-start$/i.test(stage);
    if (largeBufferStart) {
      // Repeated line variants reuse the same allocation sizes. Persist the first
      // and any larger allocation; keep all other variants in the memory trace.
      if (recognitionAllocationPeaks && stage.startsWith('ocr-recognition-')) {
        if (estimatedBytes <= (recognitionAllocationPeaks.get(stage) || 0)) return false;
        recognitionAllocationPeaks.set(stage, estimatedBytes);
      }
      return true;
    }
    if (/-run-start$/.test(stage) && Number.isFinite(estimatedBytes) && estimatedBytes >= 1024 * 1024) return true;
    if (/detection-run-start$/.test(stage)) return true;
    return [
      /-session-create-start$/,
      /-json-parse-start$/,
      /-worker-create-start$/,
      /(?:model-(?:fetch|load)|ort-import|opencv-import|clipper-import|runtime-init|worker-processing)-start$/,
      /^ocr-worker-retry-start$/,
    ].some(pattern => pattern.test(stage));
  }

  global.MagiaAnalysisDiagnostics = Object.freeze({ createReporter, createStageBatcher, isCriticalStage, rgbaBytes, floatRgbBytes, TRACE_LIMIT });
})(globalThis);

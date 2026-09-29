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

    return Object.freeze({
      begin,
      stage,
      updateContext,
      allocationStart,
      allocationDone,
      releaseStart,
      releaseDone,
      get runId() { return runId; },
      get trace() { return trace.slice(); },
      get knownLiveBytes() { return knownLiveBytes; },
      get peakKnownLiveBytes() { return peakKnownLiveBytes; },
      get activeWorkers() { return { ...activeWorkers }; },
      get runtimeState() { return { ...runtimeState }; },
      get activeAllocations() { return [...allocations].map(([id, metadata]) => ({ id, ...metadata })); },
    });
  }

  global.MagiaAnalysisDiagnostics = Object.freeze({ createReporter, rgbaBytes, floatRgbBytes, TRACE_LIMIT });
})(globalThis);

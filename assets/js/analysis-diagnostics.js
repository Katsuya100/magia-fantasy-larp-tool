(function registerMagiaAnalysisDiagnostics(global) {
  'use strict';

  function rgbaBytes(width, height) {
    return Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0) * 4;
  }

  function floatRgbBytes(width, height) {
    return Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0) * 3 * Float32Array.BYTES_PER_ELEMENT;
  }

  function createReporter(scope, send) {
    let runId = 'none';
    let context = {};
    let knownLiveBytes = 0;
    let peakKnownLiveBytes = 0;
    const allocations = new Map();

    function begin(nextRunId, initialContext = {}) {
      runId = String(nextRunId || 'none');
      context = { ...initialContext };
      allocations.clear();
      knownLiveBytes = 0;
      peakKnownLiveBytes = 0;
    }

    function updateContext(details = {}) {
      for (const key of [
        'sourceWidth', 'sourceHeight', 'detectionTensorWidth', 'detectionTensorHeight',
        'lineIndex', 'lineCount', 'onnxRuntimeVersion', 'graphOptimizationLevel', 'numThreads',
      ]) {
        if (details[key] !== undefined) context[key] = details[key];
      }
    }

    function stage(name, details = {}) {
      updateContext(details);
      send({
        type: 'diagnostic-stage',
        stage: name,
        details: {
          ...context,
          ...details,
          scope,
          runId,
          knownLiveBytes,
          peakKnownLiveBytes,
        },
      });
    }

    function allocationStart(name, allocationId, estimatedBytes, metadata = {}) {
      stage(name, { allocationId, estimatedBytes, ...metadata, allocationPhase: 'start' });
    }

    function allocationDone(name, allocationId, estimatedBytes, metadata = {}) {
      const countedInKnownLive = metadata.countedInKnownLive !== false;
      if (countedInKnownLive && allocationId) {
        const previous = allocations.get(allocationId);
        if (previous) knownLiveBytes -= previous.estimatedBytes;
        const record = {
          name: String(metadata.name || allocationId),
          estimatedBytes: Math.max(0, Number(estimatedBytes) || 0),
          ...(Number.isFinite(metadata.width) ? { width: metadata.width } : {}),
          ...(Number.isFinite(metadata.height) ? { height: metadata.height } : {}),
          type: String(metadata.type || 'ArrayBuffer'),
        };
        allocations.set(allocationId, record);
        knownLiveBytes += record.estimatedBytes;
        peakKnownLiveBytes = Math.max(peakKnownLiveBytes, knownLiveBytes);
      }
      stage(name, {
        allocationId,
        estimatedBytes,
        ...metadata,
        ...(countedInKnownLive ? { allocationAction: 'allocate' } : { countedInKnownLive: false }),
      });
    }

    function releaseStart(name, allocationId, metadata = {}) {
      const allocation = allocations.get(allocationId);
      stage(name, {
        allocationId,
        ...(allocation ? { estimatedBytes: allocation.estimatedBytes } : {}),
        ...metadata,
        allocationPhase: 'start',
      });
    }

    function releaseDone(name, allocationId, metadata = {}) {
      const allocation = allocations.get(allocationId);
      if (allocation) {
        knownLiveBytes -= allocation.estimatedBytes;
        allocations.delete(allocationId);
      }
      stage(name, {
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
      get knownLiveBytes() { return knownLiveBytes; },
      get peakKnownLiveBytes() { return peakKnownLiveBytes; },
    });
  }

  global.MagiaAnalysisDiagnostics = Object.freeze({ createReporter, rgbaBytes, floatRgbBytes });
})(globalThis);

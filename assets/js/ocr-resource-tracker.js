(function registerMagiaOcrResourceTracker(global) {
  'use strict';

  function create(reportCleanupError = () => {}) {
    const resources = new Set();

    function track(resource) {
      if (!resource || typeof resource.delete !== 'function') return resource;
      resources.add(resource);
      return resource;
    }

    function deleteResource(resource, details = {}) {
      if (!resource) return false;
      if (!resources.has(resource)) return false;
      resources.delete(resource);
      try {
        const deleteMethod = resource.delete;
        if (typeof deleteMethod !== 'function') throw new TypeError('OpenCV resource has no delete method.');
        deleteMethod.call(resource);
        return true;
      } catch (error) {
        try { reportCleanupError(error, { ...details, resourceType: details.resourceType || 'opencv' }); }
        catch (reportError) { console.warn('OpenCV cleanup diagnostic could not be recorded.', reportError); }
        return false;
      }
    }

    function releaseAll(details = {}) {
      let succeeded = true;
      try {
        const pending = [...resources].reverse();
        for (const resource of pending) {
          if (!deleteResource(resource, details)) succeeded = false;
        }
      } catch (error) {
        succeeded = false;
        try { reportCleanupError(error, { ...details, resourceType: 'opencv-resource-release' }); }
        catch (reportError) { console.warn('OpenCV cleanup diagnostic could not be recorded.', reportError); }
        for (const resource of resources) {
          if (!deleteResource(resource, details)) succeeded = false;
        }
      }
      return succeeded && resources.size === 0;
    }

    return Object.freeze({
      track,
      delete: deleteResource,
      releaseAll,
      get size() { return resources.size; },
    });
  }

  function createCleanupErrorAggregator(reportFirst = () => {}, reportSummary = () => {}) {
    const errors = new Map();

    function record(resourceType, error, details = {}) {
      const normalized = {
        name: String(error?.name || 'Error'),
        message: String(error?.message || error).slice(0, 240),
      };
      const type = String(resourceType || 'cleanup');
      const key = `${type}\u0000${normalized.name}\u0000${normalized.message}`;
      const current = errors.get(key);
      if (current) {
        current.count += 1;
        return current.count;
      }
      const entry = { resourceType: type, count: 1, firstError: normalized, details: { ...details } };
      errors.set(key, entry);
      reportFirst(normalized, { ...details, resourceType: type });
      return entry.count;
    }

    function flush() {
      let summaryCount = 0;
      for (const entry of errors.values()) {
        if (entry.count <= 1) continue;
        reportSummary({
          stage: 'ocr-cleanup-error-summary',
          ...entry.details,
          errorType: entry.resourceType,
          resourceType: entry.resourceType,
          count: entry.count,
          firstError: entry.firstError,
        });
        summaryCount += 1;
      }
      errors.clear();
      return summaryCount;
    }

    return Object.freeze({ record, flush, get size() { return errors.size; } });
  }

  global.MagiaOcrResourceTracker = Object.freeze({ create, createCleanupErrorAggregator });
})(globalThis);

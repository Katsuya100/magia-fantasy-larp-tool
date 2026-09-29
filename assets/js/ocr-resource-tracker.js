(function registerMagiaOcrResourceTracker(global) {
  'use strict';

  function create(reportCleanupError = () => {}) {
    const resources = new Set();

    function track(resource) {
      try {
        if (!resource) return resource;
        if (typeof resource.delete === 'function') resources.add(resource);
        else throw new TypeError('OpenCV resource has no delete method.');
      }
      catch (error) {
        try { reportCleanupError(error, { resourceType: 'opencv-resource-track' }); }
        catch (reportError) { console.warn('OpenCV tracking diagnostic could not be recorded.', reportError); }
      }
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

  global.MagiaOcrResourceTracker = Object.freeze({ create });
})(globalThis);

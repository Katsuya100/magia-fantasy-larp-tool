(function registerMagiaOcrLineSplitter(global) {
  'use strict';

  function create(cv, clipper, mask, maskWidth, maskHeight, sourceImage, sourceWidth, sourceHeight, onMaskCopied = null, diagnostics = null, trackCvResource = null, deleteCvResource = null, perspectiveTransform = null) {
    let maskMat = null;
    let sourcePixels = null;
    let contours = null;
    let hierarchy = null;
    let succeeded = false;
    let alignmentTracked = false;
    const reportedMilestones = new Set();
    const lines = [];
    const report = (stage, details = {}) => diagnostics?.stage?.(stage, {
      sourceWidth: sourceImage.width,
      sourceHeight: sourceImage.height,
      maskWidth,
      maskHeight,
      countedInKnownLiveBytes: false,
      ...details,
    });
    const track = resource => trackCvResource ? trackCvResource(resource) : resource;
    const releaseCvResource = createCvResourceReleaser(deleteCvResource, diagnostics, 'opencv-line-resource');
    const releaseTracked = (resource, allocationId, estimatedBytes, metadata = {}) => {
      if (!resource) return;
      diagnostics?.releaseStart?.('ocr-mask-mat-release-start', allocationId, { estimatedBytes, ...metadata });
      releaseCvResource(resource);
      diagnostics?.releaseDone?.('ocr-mask-mat-release-done', allocationId, { estimatedBytes, ...metadata });
    };

    try {
      const maskBytes = maskWidth * maskHeight;
      diagnostics?.allocationStart?.('ocr-mask-mat-alloc-start', 'opencv-mask-mat', maskBytes, {
        name: 'OpenCV mask Mat payload', width: maskWidth, height: maskHeight, type: 'cv.Mat/CV_8UC1',
      });
      maskMat = track(new cv.Mat(maskHeight, maskWidth, cv.CV_8UC1));
      diagnostics?.allocationDone?.('ocr-mask-mat-alloc-done', 'opencv-mask-mat', maskBytes, {
        name: 'OpenCV mask Mat payload', width: maskWidth, height: maskHeight, type: 'cv.Mat/CV_8UC1',
      });
      report('ocr-mask-mat-copy-start', { estimatedBytes: mask?.byteLength || maskBytes });
      maskMat.data.set(mask);
      report('ocr-mask-mat-copy-done', { estimatedBytes: mask?.byteLength || maskBytes });
      mask = null;
      onMaskCopied?.();
      report('ocr-contours-mat-alloc-start', { allocationId: 'opencv-contours-mat-vector', type: 'cv.MatVector' });
      contours = track(new cv.MatVector());
      report('ocr-contours-mat-alloc-done', { allocationId: 'opencv-contours-mat-vector', type: 'cv.MatVector' });
      report('ocr-hierarchy-mat-alloc-start', { allocationId: 'opencv-hierarchy-mat', type: 'cv.Mat' });
      hierarchy = track(new cv.Mat());
      report('ocr-hierarchy-mat-alloc-done', { allocationId: 'opencv-hierarchy-mat', type: 'cv.Mat' });
      report('ocr-find-contours-start', { estimatedBytes: maskBytes, width: maskWidth, height: maskHeight });
      cv.findContours(maskMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const contourCount = contours.size();
      report('ocr-find-contours-done', { contourCount, width: maskWidth, height: maskHeight });
      report('ocr-contours-process-start', { contourCount });
      releaseTracked(maskMat, 'opencv-mask-mat', maskBytes, { width: maskWidth, height: maskHeight, type: 'cv.Mat/CV_8UC1' });
      maskMat = null;

      for (let index = 0; index < contours.size(); index += 1) {
        if (contourCount >= 128) {
          const percent = Math.floor((index + 1) / contourCount * 100);
          for (const milestone of [25, 50, 75]) {
            if (percent >= milestone && !reportedMilestones.has(milestone)) {
              reportedMilestones.add(milestone);
              report(`ocr-contours-process-${milestone}`, { contourIndex: index, contourCount, processedPercent: milestone });
            }
          }
        }
        let contour = null;
        let boxMap = null;
        try {
          contour = track(contours.get(index));
          const { points, sside } = getMiniBoxes(cv, contour, track, releaseCvResource);
          if (sside < 3) continue;
          const clipBox = unclip(clipper, points);
          boxMap = track(cv.matFromArray(clipBox.length / 2, 1, cv.CV_32SC2, clipBox));
          const result = getMiniBoxes(cv, boxMap, track, releaseCvResource);
          const box = result.points;
          if (result.sside < 5) continue;
          const rx = sourceWidth / maskWidth;
          const ry = sourceHeight / maskHeight;
          for (const point of box) {
            point[0] *= rx;
            point[1] *= ry;
          }
          const box1 = orderPointsClockwise(box);
          box1.forEach(point => {
            point[0] = clip(Math.round(point[0]), 0, sourceWidth);
            point[1] = clip(Math.round(point[1]), 0, sourceHeight);
          });
          const rectWidth = int(linalgNorm(box1[0], box1[1]));
          const rectHeight = int(linalgNorm(box1[0], box1[3]));
          if (rectWidth <= 3 || rectHeight <= 3) continue;
          lines.push({
            box,
            image: createLazyCrop(
              () => cropFromPixels(cv, sourcePixels, sourceWidth, sourceHeight, box, diagnostics, lines.length, () => lines.length, track, releaseCvResource, perspectiveTransform),
              box,
              diagnostics,
              lines.length,
              () => lines.length,
            ),
          });
        } finally {
          releaseCvResource(boxMap);
          releaseCvResource(contour);
        }
      }

      report('ocr-contours-process-done', { contourCount, lineCount: lines.length });

      releaseCvResource(contours);
      contours = null;
      releaseCvResource(hierarchy);
      hierarchy = null;

      const alignmentRequired = sourceImage.width !== sourceWidth || sourceImage.height !== sourceHeight;
      const alignedBytes = sourceWidth * sourceHeight * 4;
      report('ocr-source-align-check', {
        required: alignmentRequired,
        sourceWidth: sourceImage.width,
        sourceHeight: sourceImage.height,
        alignedWidth: sourceWidth,
        alignedHeight: sourceHeight,
        estimatedBytes: alignmentRequired ? alignedBytes : 0,
      });
      if (!alignmentRequired) {
        sourcePixels = sourceImage.data;
      } else {
        diagnostics?.allocationStart?.('ocr-source-align-buffer-alloc-start', 'source-aligned-rgba', alignedBytes, {
          name: 'OCR aligned source RGBA', width: sourceWidth, height: sourceHeight, type: 'Uint8ClampedArray',
        });
        sourcePixels = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
        diagnostics?.allocationDone?.('ocr-source-align-buffer-alloc-done', 'source-aligned-rgba', sourcePixels.byteLength, {
          name: 'OCR aligned source RGBA', width: sourceWidth, height: sourceHeight, type: 'Uint8ClampedArray',
        });
        alignmentTracked = true;
        report('ocr-source-align-render-start', {
          sourceWidth: sourceImage.width, sourceHeight: sourceImage.height,
          alignedWidth: sourceWidth, alignedHeight: sourceHeight, estimatedBytes: alignedBytes,
        });
        global.ImageAnalysisCore.resizeRgbaSharpContainInto(
          sourceImage.data,
          sourceImage.width,
          sourceImage.height,
          sourceWidth,
          sourceHeight,
          sourcePixels,
        );
        report('ocr-source-align-render-done', {
          sourceWidth: sourceImage.width, sourceHeight: sourceImage.height,
          alignedWidth: sourceWidth, alignedHeight: sourceHeight, estimatedBytes: alignedBytes,
        });
      }
      succeeded = true;
      return {
        lines,
        release() {
          for (const line of lines) {
            try { line.image.release(); }
            catch (error) {
              report('ocr-cleanup-error', {
                resourceType: 'line-image-release',
                cleanupError: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) },
              });
              console.warn('OCR line image cleanup failed.', error);
            }
          }
          if (alignmentTracked) {
            diagnostics?.releaseStart?.('ocr-source-align-buffer-release-start', 'source-aligned-rgba', { width: sourceWidth, height: sourceHeight });
            diagnostics?.releaseDone?.('ocr-source-align-buffer-release-done', 'source-aligned-rgba');
            alignmentTracked = false;
          }
          sourcePixels = null;
        },
      };
    } finally {
      releaseTracked(maskMat, 'opencv-mask-mat', maskWidth * maskHeight, { cleanup: true, width: maskWidth, height: maskHeight, type: 'cv.Mat/CV_8UC1' });
      releaseCvResource(contours);
      releaseCvResource(hierarchy);
      if (!succeeded && alignmentTracked) {
        diagnostics?.releaseStart?.('ocr-source-align-buffer-release-start', 'source-aligned-rgba', { cleanup: true, width: sourceWidth, height: sourceHeight });
        diagnostics?.releaseDone?.('ocr-source-align-buffer-release-done', 'source-aligned-rgba', { cleanup: true });
        alignmentTracked = false;
      }
      if (!succeeded) sourcePixels = null;
    }
  }

  function createLazyCrop(createPixels, points, diagnostics = null, lineIndex = null, getLineCount = () => null) {
    const width = int(Math.max(linalgNorm(points[0], points[1]), linalgNorm(points[2], points[3])));
    const height = int(Math.max(linalgNorm(points[0], points[3]), linalgNorm(points[1], points[2])));
    const rotate = height / width >= 1.5;
    let data = null;
    let released = false;
    const materialize = () => {
      if (data?.length) return data;
      released = false;
      const details = { lineIndex, lineCount: getLineCount(), width, height };
      diagnostics?.stage?.('ocr-line-materialize-start', details);
      data = createPixels();
      diagnostics?.stage?.('ocr-line-materialize-done', details);
      return data;
    };
    return {
      width: rotate ? height : width,
      height: rotate ? width : height,
      get data() { return materialize(); },
      set data(value) {
        if (!value?.length) {
          data = null;
          released = true;
        } else {
          data = value;
          released = false;
        }
      },
      release() {
        if (released && !data?.byteLength) return;
        diagnostics?.stage?.('ocr-line-release-start', { lineIndex, lineCount: getLineCount(), width, height });
        if (data?.byteLength) {
          diagnostics?.releaseStart?.('ocr-line-crop-buffer-release-start', `line-crop-${lineIndex}`, { lineIndex, lineCount: getLineCount() });
          data = null;
          diagnostics?.releaseDone?.('ocr-line-crop-buffer-release-done', `line-crop-${lineIndex}`, { lineIndex, lineCount: getLineCount() });
        } else data = null;
        released = true;
        diagnostics?.stage?.('ocr-line-release-done', { lineIndex, lineCount: getLineCount(), width, height });
      },
    };
  }

  function cropFromPixels(cv, sourcePixels, sourceWidth, sourceHeight, points, diagnostics = null, lineIndex = null, getLineCount = () => null, trackCvResource = null, releaseResource = null, perspectiveTransform = null) {
    if (!sourcePixels) throw new Error('OCR crop source pixels have already been released.');
    let sourceMat = null;
    const sourceMatId = `opencv-source-mat-${lineIndex}`;
    const sourceMatBytes = sourceWidth * sourceHeight * 4;
    let sourceMatTracked = false;
    const track = trackCvResource || (resource => resource);
    const releaseCvResource = releaseResource || createCvResourceReleaser(null, diagnostics, 'opencv-line-resource');
    try {
      diagnostics?.allocationStart?.('ocr-source-mat-alloc-start', sourceMatId, sourceMatBytes, {
        name: 'OpenCV source Mat payload', width: sourceWidth, height: sourceHeight,
        type: 'cv.Mat/CV_8UC4', lineIndex, lineCount: getLineCount(),
      });
      diagnostics?.stage?.('ocr-line-source-mat-alloc-start', {
        allocationId: sourceMatId, estimatedBytes: sourceMatBytes, width: sourceWidth, height: sourceHeight,
        type: 'cv.Mat/CV_8UC4', lineIndex, lineCount: getLineCount(),
      });
      sourceMat = track(new cv.Mat(sourceHeight, sourceWidth, cv.CV_8UC4));
      diagnostics?.allocationDone?.('ocr-source-mat-alloc-done', sourceMatId, sourceMatBytes, {
        name: 'OpenCV source Mat payload', width: sourceWidth, height: sourceHeight,
        type: 'cv.Mat/CV_8UC4', lineIndex, lineCount: getLineCount(),
      });
      sourceMatTracked = true;
      diagnostics?.stage?.('ocr-line-source-mat-alloc-done', {
        allocationId: sourceMatId, estimatedBytes: sourceMatBytes, width: sourceWidth, height: sourceHeight,
        type: 'cv.Mat/CV_8UC4', lineIndex, lineCount: getLineCount(),
      });
      diagnostics?.stage?.('ocr-source-mat-copy-start', { estimatedBytes: sourceMatBytes, width: sourceWidth, height: sourceHeight, lineIndex, lineCount: getLineCount() });
      diagnostics?.stage?.('ocr-line-source-mat-copy-start', { estimatedBytes: sourceMatBytes, lineIndex, lineCount: getLineCount() });
      sourceMat.data.set(sourcePixels);
      diagnostics?.stage?.('ocr-line-source-mat-copy-done', { estimatedBytes: sourceMatBytes, lineIndex, lineCount: getLineCount() });
      diagnostics?.stage?.('ocr-source-mat-copy-done', { estimatedBytes: sourceMatBytes, width: sourceWidth, height: sourceHeight, lineIndex, lineCount: getLineCount() });
      const width = int(Math.max(linalgNorm(points[0], points[1]), linalgNorm(points[2], points[3])));
      const height = int(Math.max(linalgNorm(points[0], points[3]), linalgNorm(points[1], points[2])));
      return cropToRgba(cv, sourceMat, points, width, height, height / width >= 1.5, diagnostics, lineIndex, getLineCount, track, releaseCvResource, perspectiveTransform);
    } finally {
      diagnostics?.stage?.('ocr-line-source-mat-release-start', { allocationId: sourceMatId, estimatedBytes: sourceMatBytes, lineIndex, lineCount: getLineCount() });
      releaseCvResource(sourceMat);
      if (sourceMatTracked) diagnostics?.releaseDone?.('ocr-source-mat-release-done', sourceMatId, { estimatedBytes: sourceMatBytes, lineIndex, lineCount: getLineCount() });
      diagnostics?.stage?.('ocr-line-source-mat-release-done', { allocationId: sourceMatId, estimatedBytes: sourceMatBytes, lineIndex, lineCount: getLineCount() });
    }
  }

  function cropToRgba(cv, source, points, width, height, rotate, diagnostics = null, lineIndex = null, getLineCount = () => null, trackCvResource = null, releaseResource = null, perspectiveTransform = null) {
    let sourceTriangle = null;
    let destinationTriangle = null;
    let transform = null;
    let destination = null;
    let destinationSize = null;
    let border = null;
    let rotated = null;
    let rotationCenter = null;
    let rotationTransform = null;
    let rotatedSize = null;
    let perspectiveId = null;
    let perspectiveBytes = 0;
    let perspectiveTracked = false;
    let rotatedId = null;
    let rotatedBytes = 0;
    let rotatedTracked = false;
    const track = trackCvResource || (resource => resource);
    const releaseCvResource = releaseResource || createCvResourceReleaser(null, diagnostics, 'opencv-line-resource');
    try {
      const standardPoints = [[0, 0], [width, 0], [width, height], [0, height]];
      sourceTriangle = track(cv.matFromArray(4, 1, cv.CV_32FC2, flatten(points)));
      destinationTriangle = track(cv.matFromArray(4, 1, cv.CV_32FC2, flatten(standardPoints)));
      transform = track(perspectiveTransform
        ? perspectiveTransform(sourceTriangle, destinationTriangle)
        : cv.getPerspectiveTransform(sourceTriangle, destinationTriangle));
      destination = track(new cv.Mat());
      destinationSize = track(new cv.Size(width, height));
      border = track(new cv.Scalar());
      perspectiveId = `opencv-line-perspective-${lineIndex}`;
      perspectiveBytes = width * height * 4;
      diagnostics?.allocationStart?.('ocr-line-perspective-start', perspectiveId, perspectiveBytes, {
        name: 'OpenCV perspective output Mat payload', width, height, type: 'cv.Mat/CV_8UC4', lineIndex, lineCount: getLineCount(),
      });
      cv.warpPerspective(source, destination, transform, destinationSize, cv.INTER_CUBIC, cv.BORDER_REPLICATE, border);
      diagnostics?.allocationDone?.('ocr-line-perspective-done', perspectiveId, destination.data?.byteLength || perspectiveBytes, {
        name: 'OpenCV perspective output Mat payload', width: destination.cols, height: destination.rows,
        type: 'cv.Mat/CV_8UC4', lineIndex, lineCount: getLineCount(),
      });
      perspectiveTracked = true;
      releaseCvResource(sourceTriangle);
      sourceTriangle = null;
      releaseCvResource(destinationTriangle);
      destinationTriangle = null;
      releaseCvResource(transform);
      transform = null;
      releaseCvResource(destinationSize);
      destinationSize = null;
      if (!rotate) {
        const allocationId = `line-crop-${lineIndex}`;
        const estimatedBytes = destination.data.byteLength;
        diagnostics?.allocationStart?.('ocr-line-crop-buffer-alloc-start', allocationId, estimatedBytes, {
          name: 'OCR line crop RGBA', width, height, type: 'Uint8ClampedArray', lineIndex, lineCount: getLineCount(),
        });
        const pixels = new Uint8ClampedArray(destination.data);
        diagnostics?.allocationDone?.('ocr-line-crop-buffer-ready', allocationId, pixels.byteLength, {
          name: 'OCR line crop RGBA', width, height, type: 'Uint8ClampedArray', lineIndex, lineCount: getLineCount(),
        });
        diagnostics?.releaseStart?.('ocr-line-perspective-release-start', perspectiveId, { estimatedBytes: perspectiveBytes, lineIndex, lineCount: getLineCount() });
        releaseCvResource(destination);
        destination = null;
        diagnostics?.releaseDone?.('ocr-line-perspective-release-done', perspectiveId, { estimatedBytes: perspectiveBytes, lineIndex, lineCount: getLineCount() });
        perspectiveTracked = false;
        return pixels;
      }

      rotated = track(new cv.Mat());
      rotatedSize = track(new cv.Size(destination.rows, destination.cols));
      rotationCenter = track(new cv.Point(destination.cols / 2, destination.cols / 2));
      rotationTransform = track(cv.getRotationMatrix2D(rotationCenter, 90, 1));
      rotatedId = `opencv-line-rotated-${lineIndex}`;
      rotatedBytes = destination.rows * destination.cols * 4;
      diagnostics?.allocationStart?.('ocr-line-rotate-start', rotatedId, rotatedBytes, {
        name: 'OpenCV rotated output Mat payload',
        sourceWidth: destination.cols, sourceHeight: destination.rows,
        outputWidth: destination.rows, outputHeight: destination.cols,
        width: destination.rows, height: destination.cols, type: 'cv.Mat/CV_8UC4', lineIndex, lineCount: getLineCount(),
      });
      cv.warpAffine(destination, rotated, rotationTransform, rotatedSize, cv.INTER_CUBIC, cv.BORDER_REPLICATE, border);
      diagnostics?.allocationDone?.('ocr-line-rotate-done', rotatedId, rotated.data?.byteLength || rotatedBytes, {
        name: 'OpenCV rotated output Mat payload',
        outputWidth: rotated.cols, outputHeight: rotated.rows,
        width: rotated.cols, height: rotated.rows, lineIndex, lineCount: getLineCount(), type: 'cv.Mat/CV_8UC4',
      });
      rotatedTracked = true;
      diagnostics?.releaseStart?.('ocr-line-perspective-release-start', perspectiveId, { estimatedBytes: perspectiveBytes, lineIndex, lineCount: getLineCount() });
      releaseCvResource(destination);
      destination = null;
      diagnostics?.releaseDone?.('ocr-line-perspective-release-done', perspectiveId, { estimatedBytes: perspectiveBytes, lineIndex, lineCount: getLineCount() });
      perspectiveTracked = false;
      const allocationId = `line-crop-${lineIndex}`;
      const estimatedBytes = rotated.data.byteLength;
      diagnostics?.allocationStart?.('ocr-line-crop-buffer-alloc-start', allocationId, estimatedBytes, {
        name: 'OCR line crop RGBA', width: rotated.cols, height: rotated.rows, type: 'Uint8ClampedArray', lineIndex, lineCount: getLineCount(),
      });
      const pixels = new Uint8ClampedArray(rotated.data);
      diagnostics?.allocationDone?.('ocr-line-crop-buffer-ready', allocationId, pixels.byteLength, {
        name: 'OCR line crop RGBA', width: rotated.cols, height: rotated.rows, type: 'Uint8ClampedArray', lineIndex, lineCount: getLineCount(),
      });
      diagnostics?.releaseStart?.('ocr-line-rotate-release-start', rotatedId, { estimatedBytes: rotatedBytes, lineIndex, lineCount: getLineCount() });
      releaseCvResource(rotated);
      rotated = null;
      diagnostics?.releaseDone?.('ocr-line-rotate-release-done', rotatedId, { estimatedBytes: rotatedBytes, lineIndex, lineCount: getLineCount() });
      rotatedTracked = false;
      return pixels;
    } finally {
      if (perspectiveTracked) diagnostics?.releaseStart?.('ocr-line-perspective-release-start', perspectiveId, { estimatedBytes: perspectiveBytes, cleanup: true, lineIndex, lineCount: getLineCount() });
      if (perspectiveTracked) releaseCvResource(destination);
      if (perspectiveTracked) diagnostics?.releaseDone?.('ocr-line-perspective-release-done', perspectiveId, { estimatedBytes: perspectiveBytes, cleanup: true, lineIndex, lineCount: getLineCount() });
      if (rotatedTracked) diagnostics?.releaseStart?.('ocr-line-rotate-release-start', rotatedId, { estimatedBytes: rotatedBytes, cleanup: true, lineIndex, lineCount: getLineCount() });
      if (rotatedTracked) releaseCvResource(rotated);
      if (rotatedTracked) diagnostics?.releaseDone?.('ocr-line-rotate-release-done', rotatedId, { estimatedBytes: rotatedBytes, cleanup: true, lineIndex, lineCount: getLineCount() });
      for (const resource of [sourceTriangle, destinationTriangle, transform, destination, destinationSize, border, rotated, rotationCenter, rotationTransform, rotatedSize]) {
        releaseCvResource(resource);
      }
    }
  }

  function getMiniBoxes(cv, contour, trackCvResource = null, disposeCvResource = null) {
    const boundingBox = trackCvResource ? trackCvResource(cv.minAreaRect(contour)) : cv.minAreaRect(contour);
    const releaseCvResource = disposeCvResource || createCvResourceReleaser(null, null, 'opencv-line-resource');
    try {
      const points = Array.from(boxPoints(boundingBox.center, boundingBox.size, boundingBox.angle)).sort((a, b) => a[0] - b[0]);
      let index1 = 0, index2 = 1, index3 = 2, index4 = 3;
      if (points[1][1] > points[0][1]) { index1 = 0; index4 = 1; }
      else { index1 = 1; index4 = 0; }
      if (points[3][1] > points[2][1]) { index2 = 2; index3 = 3; }
      else { index2 = 3; index3 = 2; }
      return {
        points: [points[index1], points[index2], points[index3], points[index4]],
        sside: Math.min(boundingBox.size.height, boundingBox.size.width),
      };
    } finally {
      releaseCvResource(boundingBox);
    }
  }

  function createCvResourceReleaser(deleteCvResource, diagnostics, resourceType) {
    return resource => {
      if (!resource) return false;
      try {
        if (deleteCvResource) return deleteCvResource(resource, { resourceType }) !== false;
        const deleteMethod = resource.delete;
        if (typeof deleteMethod !== 'function') throw new TypeError('OpenCV resource has no delete method.');
        deleteMethod.call(resource);
        return true;
      } catch (error) {
        try {
          diagnostics?.stage?.('ocr-cleanup-error', {
            resourceType,
            cleanupError: { name: String(error?.name || 'Error'), message: String(error?.message || error).slice(0, 240) },
          });
        } catch (diagnosticError) {
          console.warn('OpenCV cleanup diagnostic could not be recorded.', diagnosticError);
        }
        try { console.warn('OpenCVの一時領域を解放できませんでした。', error); }
        catch { /* Cleanup reporting must not mask OCR work. */ }
        return false;
      }
    };
  }

  function unclip(clipper, box) {
    const area = Math.abs(polygonArea(box));
    const distance = (area * 1.5) / polygonLength(box);
    const path = box.map(([X, Y]) => ({ X, Y }));
    const offset = new clipper.ClipperOffset();
    const expanded = [];
    try {
      offset.AddPath(path, clipper.JoinType.jtRound, clipper.EndType.etClosedPolygon);
      offset.Execute(expanded, distance);
    } finally {
      offset.Clear?.();
    }
    return expanded[0] ? expanded[0].flatMap(point => [point.X, point.Y]) : [];
  }

  function boxPoints(center, size, angle) {
    const theta = angle * Math.PI / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const dx = size.width * .5;
    const dy = size.height * .5;
    return [
      [center.x - dx * cos + dy * sin, center.y - dx * sin - dy * cos],
      [center.x + dx * cos + dy * sin, center.y + dx * sin - dy * cos],
      [center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos],
      [center.x - dx * cos - dy * sin, center.y - dx * sin + dy * cos],
    ];
  }

  function orderPointsClockwise(points) {
    const sums = points.map(point => point[0] + point[1]);
    const result = [[0, 0], [0, 0], [0, 0], [0, 0]];
    result[0] = points[sums.indexOf(Math.min(...sums))];
    result[2] = points[sums.indexOf(Math.max(...sums))];
    const remaining = points.filter(point => point !== result[0] && point !== result[2]);
    const differences = remaining[1].map((value, index) => value - remaining[0][index]);
    result[1] = remaining[differences.indexOf(Math.min(...differences))];
    result[3] = remaining[differences.indexOf(Math.max(...differences))];
    return result;
  }

  function polygonArea(polygon) {
    let area = 0;
    let previous = polygon.at(-1);
    for (const point of polygon) {
      area += previous[1] * point[0] - previous[0] * point[1];
      previous = point;
    }
    return area / 2;
  }

  function polygonLength(polygon) {
    let length = 0;
    let previous = polygon.at(-1);
    for (const point of polygon) {
      length += linalgNorm(previous, point);
      previous = point;
    }
    return length;
  }

  function linalgNorm(first, second) {
    return Math.hypot(first[0] - second[0], first[1] - second[1]);
  }

  function flatten(points) { return points.flat(); }
  function int(value) { return value > 0 ? Math.floor(value) : Math.ceil(value); }
  function clip(value, min, max) { return Math.max(min, Math.min(value, max)); }

  global.MagiaOcrLineSplitter = { create };
})(globalThis);

(function registerMagiaOcrLineSplitter(global) {
  'use strict';

  function create(cv, clipper, mask, maskWidth, maskHeight, sourceImage, sourceWidth, sourceHeight, onMaskCopied = null) {
    let maskMat = null;
    let sourcePixels = null;
    let contours = null;
    let hierarchy = null;
    let succeeded = false;
    const lines = [];
    const dispose = resource => {
      try { resource?.delete?.(); } catch (error) { console.warn('OpenCVの一時領域を解放できませんでした。', error); }
    };

    try {
      maskMat = new cv.Mat(maskHeight, maskWidth, cv.CV_8UC1);
      maskMat.data.set(mask);
      mask = null;
      onMaskCopied?.();
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(maskMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      dispose(maskMat);
      maskMat = null;

      for (let index = 0; index < contours.size(); index += 1) {
        let contour = null;
        let boxMap = null;
        try {
          contour = contours.get(index);
          const { points, sside } = getMiniBoxes(cv, contour);
          if (sside < 3) continue;
          const clipBox = unclip(clipper, points);
          boxMap = cv.matFromArray(clipBox.length / 2, 1, cv.CV_32SC2, clipBox);
          const result = getMiniBoxes(cv, boxMap);
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
              () => cropFromPixels(cv, sourcePixels, sourceWidth, sourceHeight, box),
              box,
            ),
          });
        } finally {
          dispose(boxMap);
          dispose(contour);
        }
      }

      dispose(contours);
      contours = null;
      dispose(hierarchy);
      hierarchy = null;

      if (sourceImage.width === sourceWidth && sourceImage.height === sourceHeight) {
        sourcePixels = sourceImage.data;
      } else {
        sourcePixels = new Uint8ClampedArray(sourceWidth * sourceHeight * 4);
        global.ImageAnalysisCore.resizeRgbaSharpContainInto(
          sourceImage.data,
          sourceImage.width,
          sourceImage.height,
          sourceWidth,
          sourceHeight,
          sourcePixels,
        );
      }
      succeeded = true;
      return {
        lines,
        release() {
          for (const line of lines) line.image.release();
          sourcePixels = null;
        },
      };
    } finally {
      dispose(maskMat);
      dispose(contours);
      dispose(hierarchy);
      if (!succeeded) sourcePixels = null;
    }
  }

  function createLazyCrop(createPixels, points) {
    const width = int(Math.max(linalgNorm(points[0], points[1]), linalgNorm(points[2], points[3])));
    const height = int(Math.max(linalgNorm(points[0], points[3]), linalgNorm(points[1], points[2])));
    const rotate = height / width >= 1.5;
    let data = null;
    const materialize = () => {
      if (data?.length) return data;
      data = createPixels();
      return data;
    };
    return {
      width: rotate ? height : width,
      height: rotate ? width : height,
      get data() { return materialize(); },
      set data(value) {
        if (!value?.length) data = null;
        else data = value;
      },
      release() { data = null; },
    };
  }

  function cropFromPixels(cv, sourcePixels, sourceWidth, sourceHeight, points) {
    if (!sourcePixels) throw new Error('OCR crop source pixels have already been released.');
    let sourceMat = null;
    try {
      sourceMat = new cv.Mat(sourceHeight, sourceWidth, cv.CV_8UC4);
      sourceMat.data.set(sourcePixels);
      const width = int(Math.max(linalgNorm(points[0], points[1]), linalgNorm(points[2], points[3])));
      const height = int(Math.max(linalgNorm(points[0], points[3]), linalgNorm(points[1], points[2])));
      return cropToRgba(cv, sourceMat, points, width, height, height / width >= 1.5);
    } finally {
      try { sourceMat?.delete?.(); } catch {}
    }
  }

  function cropToRgba(cv, source, points, width, height, rotate) {
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
    try {
      const standardPoints = [[0, 0], [width, 0], [width, height], [0, height]];
      sourceTriangle = cv.matFromArray(4, 1, cv.CV_32FC2, flatten(points));
      destinationTriangle = cv.matFromArray(4, 1, cv.CV_32FC2, flatten(standardPoints));
      transform = cv.getPerspectiveTransform(sourceTriangle, destinationTriangle);
      destination = new cv.Mat();
      destinationSize = new cv.Size(width, height);
      border = new cv.Scalar();
      cv.warpPerspective(source, destination, transform, destinationSize, cv.INTER_CUBIC, cv.BORDER_REPLICATE, border);
      sourceTriangle?.delete?.();
      sourceTriangle = null;
      destinationTriangle?.delete?.();
      destinationTriangle = null;
      transform?.delete?.();
      transform = null;
      destinationSize?.delete?.();
      destinationSize = null;
      if (!rotate) return new Uint8ClampedArray(destination.data);

      rotated = new cv.Mat();
      rotatedSize = new cv.Size(destination.rows, destination.cols);
      rotationCenter = new cv.Point(destination.cols / 2, destination.cols / 2);
      rotationTransform = cv.getRotationMatrix2D(rotationCenter, 90, 1);
      cv.warpAffine(destination, rotated, rotationTransform, rotatedSize, cv.INTER_CUBIC, cv.BORDER_REPLICATE, border);
      destination?.delete?.();
      destination = null;
      return new Uint8ClampedArray(rotated.data);
    } finally {
      for (const resource of [sourceTriangle, destinationTriangle, transform, destination, destinationSize, border, rotated, rotationCenter, rotationTransform, rotatedSize]) {
        try { resource?.delete?.(); } catch {}
      }
    }
  }

  function getMiniBoxes(cv, contour) {
    const boundingBox = cv.minAreaRect(contour);
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
      try { boundingBox?.delete?.(); } catch {}
    }
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

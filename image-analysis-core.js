(function attachImageAnalysisCore(global) {
  'use strict';

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function makeGrayImage(buffer, width, height, maxSide = 620) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const smallWidth = Math.max(1, Math.round(width * scale));
    const smallHeight = Math.max(1, Math.round(height * scale));
    const gray = new Uint8Array(smallWidth * smallHeight);
    const source = new Uint8Array(buffer);
    for (let y = 0; y < smallHeight; y += 1) {
      const sourceY = Math.min(height - 1, Math.round(y / scale));
      for (let x = 0; x < smallWidth; x += 1) {
        const sourceX = Math.min(width - 1, Math.round(x / scale));
        const index = (sourceY * width + sourceX) * 4;
        gray[y * smallWidth + x] = Math.round(source[index] * .299 + source[index + 1] * .587 + source[index + 2] * .114);
      }
    }
    return { gray, width: smallWidth, height: smallHeight, scale };
  }

  function makeEdgeImage(gray, width, height) {
    const edge = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const gx = gray[index + 1] - gray[index - 1];
        const gy = gray[index + width] - gray[index - width];
        edge[index] = Math.min(255, Math.round(Math.hypot(gx, gy)));
      }
    }
    return edge;
  }

  function traceClosedPath(edge, width, height, cx, cy, radius, searchRatio = .12, samples = 96, radialStepRatio = .035, distancePenalty = 0, continuityPenalty = 0) {
    const search = Math.max(3, Math.round(radius * searchRatio));
    const step = Math.max(1, Math.round(radius * radialStepRatio));
    const radii = [];
    const choices = [];
    let edgeTotal = 0;
    for (let index = 0; index < samples; index += 1) {
      const theta = index / samples * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      let bestEdge = 0;
      let bestScore = -Infinity;
      let bestRadius = 0;
      const angleChoices = [];
      for (let offset = -search; offset <= search; offset += step) {
        const candidateRadius = radius + offset;
        const x = Math.round(cx + cos * candidateRadius);
        const y = Math.round(cy + sin * candidateRadius);
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
        const edgeScore = edge[y * width + x];
        if (edgeScore >= 18) angleChoices.push({ radius: candidateRadius, edgeScore, offset });
        const score = edgeScore - Math.abs(offset) * distancePenalty;
        if (score > bestScore) {
          bestScore = score;
          bestEdge = edgeScore;
          bestRadius = candidateRadius;
        }
      }
      if (bestEdge >= 18) {
        radii.push(bestRadius);
        choices.push(angleChoices);
        edgeTotal += bestEdge / 255;
      } else {
        radii.push(0);
        choices.push([]);
      }
    }
    if (continuityPenalty > 0) {
      if (samples > 180) {
        const validRadii = radii.filter(value => value > 0).sort((a, b) => a - b);
        const medianRadius = validRadii[Math.floor(validRadii.length / 2)] || radius;
        let startIndex = 0;
        let startError = Infinity;
        for (let index = 0; index < samples; index += 1) {
          if (!choices[index].length) continue;
          const error = Math.abs(radii[index] - medianRadius);
          if (error < startError) {
            startError = error;
            startIndex = index;
          }
        }
        const startChoice = choices[startIndex].reduce((best, choice) => {
          const score = choice.edgeScore - Math.abs(choice.offset) * distancePenalty;
          return !best || score > best.score ? { choice, score } : best;
        }, null)?.choice;
        if (startChoice) {
          const order = Array.from({ length: samples }, (_, stepIndex) => (startIndex + stepIndex) % samples);
          let scores = [startChoice.edgeScore - Math.abs(startChoice.offset) * distancePenalty];
          const backPointers = [];
          const choicesByStep = [[startChoice]];
          for (let stepIndex = 1; stepIndex < samples; stepIndex += 1) {
            const index = order[stepIndex];
            const options = choices[index].length ? choices[index] : [{ radius, edgeScore: 0, offset: 0, missing: true }];
            const nextScores = new Array(options.length).fill(-Infinity);
            const previousPointers = new Int32Array(options.length);
            for (let choiceIndex = 0; choiceIndex < options.length; choiceIndex += 1) {
              const choice = options[choiceIndex];
              const localScore = choice.edgeScore - Math.abs(choice.offset) * distancePenalty;
              for (let previousIndex = 0; previousIndex < scores.length; previousIndex += 1) {
                const previousChoice = choicesByStep[stepIndex - 1][previousIndex];
                const score = scores[previousIndex] + localScore
                  - continuityPenalty * Math.abs(choice.radius - previousChoice.radius);
                if (score > nextScores[choiceIndex]) {
                  nextScores[choiceIndex] = score;
                  previousPointers[choiceIndex] = previousIndex;
                }
              }
            }
            scores = nextScores;
            backPointers.push(previousPointers);
            choicesByStep.push(options);
          }
          const lastChoices = choicesByStep[choicesByStep.length - 1];
          let lastChoiceIndex = 0;
          let bestCycleScore = -Infinity;
          for (let choiceIndex = 0; choiceIndex < scores.length; choiceIndex += 1) {
            const score = scores[choiceIndex]
              - continuityPenalty * Math.abs(lastChoices[choiceIndex].radius - startChoice.radius);
            if (score > bestCycleScore) {
              bestCycleScore = score;
              lastChoiceIndex = choiceIndex;
            }
          }
          let choiceIndex = lastChoiceIndex;
          for (let stepIndex = samples - 1; stepIndex > 0; stepIndex -= 1) {
            const index = order[stepIndex];
            const choice = choicesByStep[stepIndex][choiceIndex];
            radii[index] = choice.missing ? 0 : choice.radius;
            choiceIndex = backPointers[stepIndex - 1][choiceIndex];
          }
          radii[startIndex] = startChoice.radius;
        }
      } else {
        for (let pass = 0; pass < 4; pass += 1) {
          for (let index = 0; index < samples; index += 1) {
            if (!choices[index].length) continue;
            const previous = radii[(index - 1 + samples) % samples] || radius;
            const next = radii[(index + 1) % samples] || radius;
            let best = null;
            let bestScore = -Infinity;
            for (const choice of choices[index]) {
              const score = choice.edgeScore - Math.abs(choice.offset) * distancePenalty
                - continuityPenalty * (Math.abs(choice.radius - previous) + Math.abs(choice.radius - next)) / 2;
              if (score > bestScore) {
                bestScore = score;
                best = choice;
              }
            }
            if (best) radii[index] = best.radius;
          }
        }
      }
    }
    edgeTotal = radii.reduce((sum, selectedRadius, index) => {
      const selected = choices[index].find(choice => choice.radius === selectedRadius);
      return sum + (selected ? selected.edgeScore / 255 : 0);
    }, 0);
    const valid = radii.filter(value => value > 0);
    const coverage = valid.length / samples;
    const meanRadius = valid.reduce((sum, value) => sum + value, 0) / (valid.length || 1);
    const variance = valid.reduce((sum, value) => sum + (value - meanRadius) ** 2, 0) / (valid.length || 1);
    const radialVariation = Math.sqrt(variance) / (meanRadius || 1);
    const roundness = clamp(1 - radialVariation * 1.7);
    const edgeStrength = edgeTotal / samples;
    return {
      coverage,
      roundness,
      edgeStrength,
      meanRadius,
      radii,
      circleAccuracy: clamp(coverage * roundness),
      pathScore: coverage * edgeStrength,
    };
  }

  function smoothRadialProfile(radii, smoothingWindow) {
    const size = radii.length;
    const profile = radii.slice();
    const valid = profile.map((radius, index) => radius > 0 ? index : -1).filter(index => index >= 0);
    if (!valid.length) return profile;
    if (valid.length < size) {
      for (let validIndex = 0; validIndex < valid.length; validIndex += 1) {
        const start = valid[validIndex];
        const end = valid[(validIndex + 1) % valid.length];
        const distance = (end - start + size) % size || size;
        for (let offset = 1; offset < distance; offset += 1) {
          const index = (start + offset) % size;
          const fraction = offset / distance;
          profile[index] = profile[start] + (profile[end] - profile[start]) * fraction;
        }
      }
    }
    const windowSize = smoothingWindow || Math.max(3, Math.round(size / 72) | 1);
    const halfWindow = Math.floor(windowSize / 2);
    return profile.map((radius, index) => {
      const neighbors = [];
      for (let offset = -halfWindow; offset <= halfWindow; offset += 1) {
        neighbors.push(profile[(index + offset + size) % size]);
      }
      neighbors.sort((a, b) => a - b);
      return neighbors[halfWindow];
    });
  }

  function centerDarkStroke(gray, width, height, cx, cy, radii, searchRatio = .06) {
    const size = radii.length;
    const medianRadius = radii.slice().sort((a, b) => a - b)[Math.floor(size / 2)] || 1;
    const search = Math.max(4, Math.round(medianRadius * searchRatio));
    const centered = radii.slice();
    for (let index = 0; index < size; index += 1) {
      const theta = index / size * Math.PI * 2;
      const expected = radii[index];
      let bestDistance = Infinity;
      let bestCenter = expected;
      let runStart = -1;
      const considerRun = end => {
        if (runStart < 0 || end - runStart < 2) return;
        const center = (runStart + end - 1) / 2;
        const distance = Math.abs(center - expected);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCenter = center;
        }
      };
      for (let radius = Math.max(2, Math.round(expected - search)); radius <= expected + search; radius += 1) {
        const x = Math.round(cx + Math.cos(theta) * radius);
        const y = Math.round(cy + Math.sin(theta) * radius);
        const dark = x >= 0 && y >= 0 && x < width && y < height && gray[y * width + x] < 165;
        if (dark && runStart < 0) runStart = radius;
        if (!dark && runStart >= 0) {
          considerRun(radius);
          runStart = -1;
        }
      }
      if (runStart >= 0) considerRun(Math.round(expected + search) + 1);
      centered[index] = bestCenter;
    }
    return centered;
  }

  function profileRadius(path, theta) {
    if (!path.radii?.length) return path.r;
    const size = path.radii.length;
    const position = ((theta / (Math.PI * 2)) % 1 + 1) % 1 * size;
    const lower = Math.floor(position);
    const upper = (lower + 1) % size;
    const fraction = position - lower;
    const first = path.radii[lower] || path.r;
    const second = path.radii[upper] || path.r;
    return first + (second - first) * fraction;
  }

  function scorePointsOnRing(paths, points, width, height) {
    if (!paths.inner || !points?.length) return 0;
    let inside = 0;
    for (const point of points) {
      const x = Number(point.x) * width;
      const y = Number(point.y) * height;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const centerX = (paths.inner.x + paths.outer.x) / 2;
      const centerY = (paths.inner.y + paths.outer.y) / 2;
      const theta = Math.atan2(y - centerY, x - centerX);
      const distance = Math.hypot(x - centerX, y - centerY);
      const inner = profileRadius(paths.inner, theta);
      const outer = profileRadius(paths.outer, theta);
      const gap = outer - inner;
      const relativeRadius = (distance - inner) / (gap || 1);
      if (relativeRadius >= .08 && relativeRadius <= .92) inside += clamp(1 - Math.abs(relativeRadius - .5) * 1.4);
    }
    return inside / points.length;
  }

  function scoreInkInRing(gray, width, height, paths) {
    if (!paths.inner) return 0;
    const angularSamples = 64;
    const radialSamples = 14;
    let covered = 0;
    for (let index = 0; index < angularSamples; index += 1) {
      const theta = index / angularSamples * Math.PI * 2;
      const centerX = (paths.inner.x + paths.outer.x) / 2;
      const centerY = (paths.inner.y + paths.outer.y) / 2;
      const inner = profileRadius(paths.inner, theta);
      const outer = profileRadius(paths.outer, theta);
      let dark = 0;
      for (let step = 0; step < radialSamples; step += 1) {
        const t = .12 + step / Math.max(1, radialSamples - 1) * .76;
        const radius = inner + (outer - inner) * t;
        const x = Math.round(centerX + Math.cos(theta) * radius);
        const y = Math.round(centerY + Math.sin(theta) * radius);
        if (x >= 0 && y >= 0 && x < width && y < height && gray[y * width + x] < 170) dark += 1;
      }
      if (dark >= 1) covered += 1;
    }
    return covered / angularSamples;
  }

  function scoreInkInsidePath(gray, width, height, path) {
    const angularSamples = 48;
    const radialSamples = 12;
    let occupied = 0;
    for (let index = 0; index < angularSamples; index += 1) {
      const theta = index / angularSamples * Math.PI * 2;
      const boundary = profileRadius(path, theta);
      let hasSigilInk = false;
      for (let step = 0; step < radialSamples; step += 1) {
        const radius = boundary * (.15 + step / Math.max(1, radialSamples - 1) * .7);
        const x = Math.round(path.x + Math.cos(theta) * radius);
        const y = Math.round(path.y + Math.sin(theta) * radius);
        if (x >= 0 && y >= 0 && x < width && y < height && gray[y * width + x] < 170) {
          hasSigilInk = true;
          break;
        }
      }
      if (hasSigilInk) occupied += 1;
    }
    return occupied / angularSamples;
  }

  function scoreNestedPaths(inner, outer) {
    const centerDistance = Math.hypot(outer.x - inner.x, outer.y - inner.y);
    let contained = 0;
    const samples = Math.min(inner.radii?.length || 96, outer.radii?.length || 96);
    for (let index = 0; index < samples; index += 1) {
      const theta = index / samples * Math.PI * 2;
      const innerRadius = profileRadius(inner, theta) + centerDistance * .5;
      const outerRadius = profileRadius(outer, theta) - centerDistance * .5;
      if (innerRadius + 2 < outerRadius) contained += 1;
    }
    return contained / samples;
  }

  function polarCornerAngle(radii, index, span) {
    const size = radii.length;
    const point = offset => {
      const sample = (index + offset + size) % size;
      const theta = sample / size * Math.PI * 2;
      return [radii[sample] * Math.cos(theta), radii[sample] * Math.sin(theta)];
    };
    const current = point(0);
    const before = point(-span);
    const after = point(span);
    const first = [before[0] - current[0], before[1] - current[1]];
    const second = [after[0] - current[0], after[1] - current[1]];
    const magnitude = Math.hypot(...first) * Math.hypot(...second);
    if (!magnitude) return Math.PI;
    const cosine = clamp((first[0] * second[0] + first[1] * second[1]) / magnitude, -1, 1);
    return Math.acos(cosine);
  }

  function detectClosedPathsJs(buffer, width, height) {
    const image = makeGrayImage(buffer, width, height);
    const edge = makeEdgeImage(image.gray, image.width, image.height);
    const shortSide = Math.min(image.width, image.height);
    const candidates = [];
    const centerStep = Math.max(1, Math.round(shortSide * .015));
    const radiusStep = Math.max(3, Math.round(shortSide * .015));
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const cx = image.width / 2 + dx * centerStep;
        const cy = image.height / 2 + dy * centerStep;
        for (let radius = Math.round(shortSide * .08); radius <= Math.round(shortSide * .72); radius += radiusStep) {
          const path = traceClosedPath(edge, image.width, image.height, cx, cy, radius, .12, 96, .02);
          if (path.coverage >= .58 && path.edgeStrength > .035) {
            candidates.push({
              x: cx, y: cy, r: path.meanRadius, coverage: path.coverage,
              circleAccuracy: path.circleAccuracy, pathScore: path.pathScore,
            });
          }
        }
      }
    }
    candidates.sort((a, b) => b.pathScore - a.pathScore);
    const selected = [];
    for (const candidate of candidates) {
      if (selected.some(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) < shortSide * .035 && Math.abs(candidate.r - other.r) < shortSide * .035)) continue;
      selected.push(candidate);
      if (selected.length >= 220) break;
    }
    for (const path of selected) {
      const profile = traceClosedPath(edge, image.width, image.height, path.x, path.y, path.r, .08, 180, .008);
      path.radii = smoothRadialProfile(profile.radii, 9);
      path.innerInk = scoreInkInsidePath(image.gray, image.width, image.height, path);
    }
    let best = null;
    let bestScore = -Infinity;
    for (let firstIndex = 0; firstIndex < selected.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < selected.length; secondIndex += 1) {
        const first = selected[firstIndex];
        const second = selected[secondIndex];
        const outer = first.r >= second.r ? first : second;
        const inner = outer === first ? second : first;
        const ratio = inner.r / outer.r;
        const centerError = Math.hypot(outer.x - inner.x, outer.y - inner.y) / outer.r;
        if (outer.r < shortSide * .3 || inner.r < shortSide * .13 || ratio < .52 || ratio > .88 || centerError > .1) continue;
        const containment = scoreNestedPaths(inner, outer);
        if (containment < .72) continue;
        const paths = { outer, inner };
        const inkFit = scoreInkInRing(image.gray, image.width, image.height, paths);
        const innerCenterError = Math.hypot(inner.x - image.width / 2, inner.y - image.height / 2) / shortSide;
        const outerCenterError = Math.hypot(outer.x - image.width / 2, outer.y - image.height / 2) / shortSide;
        if (innerCenterError > .06 || outerCenterError > .06) continue;
        const innerCenterPrior = clamp(1 - innerCenterError / .08);
        const outerCenterPrior = clamp(1 - outerCenterError / .08);
        const score = outer.pathScore + inner.pathScore + (1 - centerError) * 2 + outer.r / shortSide * .35
          + (outer.circleAccuracy + inner.circleAccuracy) * 2.5 + containment * .8
          + innerCenterPrior * 3.5 + outerCenterPrior * 3.5
          + inkFit * .45 + inner.innerInk * .55;
        if (score > bestScore) {
          bestScore = score;
          best = { outer, inner, circleAccuracy: clamp((outer.circleAccuracy + inner.circleAccuracy) / 2) };
        }
      }
    }
    if (!best && selected.length) {
      const single = selected.reduce((outer, candidate) => candidate.r > outer.r ? candidate : outer, selected[0]);
      best = { outer: single, inner: null, circleAccuracy: single.circleAccuracy };
    }
    if (!best) throw new Error('閉じた線のパスを見つけられませんでした。');
    if (best.inner) {
      best.inner.analysisBoundary = {
        x: best.inner.x,
        y: best.inner.y,
        r: best.inner.r,
        radii: best.inner.radii.slice(),
      };
    }
    for (const path of [best.outer, best.inner].filter(Boolean)) {
      const centerSearch = Math.max(1, Math.round(shortSide * .03));
      let refinedCenter = { x: path.x, y: path.y, score: -Infinity };
      for (let yStep = -5; yStep <= 5; yStep += 1) {
        const dy = Math.round(yStep * centerSearch / 5);
        for (let xStep = -5; xStep <= 5; xStep += 1) {
          const dx = Math.round(xStep * centerSearch / 5);
          const x = path.x + dx;
          const y = path.y + dy;
          const profile = traceClosedPath(edge, image.width, image.height, x, y, path.r, .1, 96, .003, 1.25, 2);
          const score = profile.pathScore + profile.circleAccuracy * 1.5 - Math.hypot(dx, dy) * .01;
          if (score > refinedCenter.score) refinedCenter = { x, y, score };
        }
      }
      path.x = refinedCenter.x;
      path.y = refinedCenter.y;
    }
    for (const path of [best.outer, best.inner].filter(Boolean)) {
      const refined = traceClosedPath(edge, image.width, image.height, path.x, path.y, path.r, .1, 360, .003, 3, 3);
      const edgeProfile = smoothRadialProfile(refined.radii, 21);
      const centerlineProfile = centerDarkStroke(image.gray, image.width, image.height, path.x, path.y, edgeProfile);
      const smoothed = smoothRadialProfile(centerlineProfile, 29);
      const sortedRadii = smoothed.slice().sort((a, b) => a - b);
      const medianRadius = sortedRadii[Math.floor(sortedRadii.length / 2)] || refined.meanRadius;
      const radialTolerance = Math.max(3, medianRadius * .12);
      path.radii = smoothed.map(radius => medianRadius + clamp(radius - medianRadius, -radialTolerance, radialTolerance));
      path.r = medianRadius;
      path.coverage = refined.coverage;
      path.circleAccuracy = refined.circleAccuracy;
    }
    if (best.inner) {
      const minimumGap = Math.max(3, shortSide * .04);
      for (let index = 0; index < best.inner.radii.length; index += 1) {
        best.inner.radii[index] = Math.min(best.inner.radii[index], best.outer.radii[index] - minimumGap);
      }
    }
    best.circleAccuracy = best.inner
      ? clamp((best.outer.circleAccuracy + best.inner.circleAccuracy) / 2)
      : best.outer.circleAccuracy;
    const restore = path => path && ({
      x: path.x / image.scale,
      y: path.y / image.scale,
      r: path.r / image.scale,
      coverage: path.coverage,
      circleAccuracy: path.circleAccuracy,
      radii: path.radii.map(radius => radius / image.scale),
      analysisBoundary: path.analysisBoundary && ({
        x: path.analysisBoundary.x / image.scale,
        y: path.analysisBoundary.y / image.scale,
        r: path.analysisBoundary.r / image.scale,
        radii: path.analysisBoundary.radii.map(radius => radius / image.scale),
      }),
    });
    return { outer: restore(best.outer), inner: restore(best.inner), circleAccuracy: best.circleAccuracy, confidence: best.circleAccuracy };
  }

  function analyzeSigilMetricsJs(buffer, width, height, paths) {
    const image = makeGrayImage(buffer, width, height);
    if (!paths?.inner) {
      return {
        scores: { debuff: .25, attack: .25, defense: .25, support: .25 },
        lineStraightness: 0,
      };
    }
    const analysisBoundary = paths.inner.analysisBoundary || paths.inner;
    const cx = analysisBoundary.x * image.scale;
    const cy = analysisBoundary.y * image.scale;
    const radius = analysisBoundary.r * image.scale;
    const samples = 288;
    const radii = [];
    const darkRatio = [];
    for (let index = 0; index < samples; index += 1) {
      const theta = index / samples * Math.PI * 2;
      let found = 0;
      let dark = 0;
      const boundary = (analysisBoundary.radii?.[Math.floor(index / samples * (analysisBoundary.radii.length || samples))] || analysisBoundary.r) * image.scale;
      for (let step = Math.round(boundary * .12); step < boundary * .94; step += Math.max(1, boundary * .012)) {
        const x = Math.round(cx + Math.cos(theta) * step);
        const y = Math.round(cy + Math.sin(theta) * step);
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        if (image.gray[y * image.width + x] < 150) { found = step / boundary; dark += 1; }
      }
      radii.push(found);
      darkRatio.push(dark);
    }
    const valid = radii.filter(value => value > 0);
    const mean = valid.reduce((sum, value) => sum + value, 0) / (valid.length || 1);
    const variance = valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (valid.length || 1);
    let roughness = 0;
    let turns = 0;
    let measuredCorners = 0;
    let broadCorners = 0;
    let sharpCorners = 0;
    for (let index = 0; index < samples; index += 1) {
      const previous = radii[(index + samples - 1) % samples];
      const current = radii[index];
      const next = radii[(index + 1) % samples];
      roughness += Math.abs(current - previous);
      if ((current - previous) * (next - current) < -.002) {
        turns += 1;
        if (previous > 0 && current > 0 && next > 0) {
          const angle = polarCornerAngle(radii, index, 5);
          measuredCorners += 1;
          if (angle >= Math.PI / 2) broadCorners += 1;
          if (angle < Math.PI / 3) sharpCorners += 1;
        }
      }
    }
    roughness /= samples;
    const dark = darkRatio.reduce((sum, value) => sum + value, 0) / (samples * Math.max(1, Math.round(radius * .82)));
    const angularity = clamp(turns / 48 + roughness * 2);
    const lineDensity = clamp(dark * 6 + roughness * 1.4);
    const missingRayRatio = radii.filter(value => value === 0).length / samples;
    const closedness = clamp(1 - missingRayRatio);
    const solidContour = clamp(closedness * (1 - roughness * 6));
    const compactness = clamp(1 - mean);
    const cornerCountFactor = clamp(measuredCorners / 12);
    const broadCornerScore = measuredCorners ? broadCorners / measuredCorners * cornerCountFactor : 0;
    const sharpCornerScore = measuredCorners ? sharpCorners / measuredCorners * cornerCountFactor : 0;
    // 中心寄りの閉じた尖りは攻撃、途切れた放射線は弱体として読む。
    // 90度以上の角が複数ある大きな閉輪郭は防御へ、鋭角の多い輪郭は攻撃へ寄せる。
    const raw = {
      attack: Math.max(0, compactness * solidContour * 2.5 + sharpCornerScore * 2.5),
      defense: (angularity * .9 + broadCornerScore * .8 + (1 - lineDensity) * .25 + (1 - roughness) * .05) * solidContour,
      support: mean * Math.max(0, 1 - angularity * 1.7) + (1 - roughness) * .08,
      debuff: roughness * 1.5 + missingRayRatio * 1.2 + lineDensity * .1,
    };
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
    const scores = { attack: raw.attack / total, defense: raw.defense / total, support: raw.support / total, debuff: raw.debuff / total };
    return {
      scores,
      features: { mean, roughness, angularity, lineDensity, missingRayRatio, closedness, solidContour, compactness, cornerCountFactor, broadCornerScore, sharpCornerScore },
      // Angular contour changes are a proxy for wobble in the drawn lines.
      lineStraightness: clamp(1 - roughness * 6),
    };
  }

  function analyzeSigilJs(buffer, width, height, circle) {
    return analyzeSigilMetricsJs(buffer, width, height, circle).scores;
  }

  function scoreInkCoverage(buffer, imageWidth, imageHeight, paths, options = {}) {
    if (!paths?.inner || !paths?.outer) return 0;
    const polarWidth = options.width || 1200;
    const polarHeight = options.height || 180;
    const innerGap = options.innerGap ?? 10;
    const outerGap = options.outerGap ?? 10;
    let covered = 0;
    const pathRadius = (path, sampleIndex) => {
      const profile = path.radii;
      if (!profile?.length) return path.r;
      const lower = Math.floor(sampleIndex) % profile.length;
      const upper = (lower + 1) % profile.length;
      const fraction = sampleIndex - Math.floor(sampleIndex);
      const first = profile[lower] || path.r;
      const second = profile[upper] || path.r;
      return first + (second - first) * fraction;
    };

    for (let x = 0; x < polarWidth; x += 1) {
      const theta = x / polarWidth * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const sampleIndex = x / polarWidth * (paths.inner.radii?.length || 96);
      const inner = pathRadius(paths.inner, sampleIndex) + innerGap;
      const outer = pathRadius(paths.outer, sampleIndex) - outerGap;
      let dark = 0;
      for (let y = 0; y < polarHeight; y += 1) {
        const t = y / Math.max(1, polarHeight - 1);
        const radius = inner + t * Math.max(1, outer - inner);
        const centerX = paths.inner.x + (paths.outer.x - paths.inner.x) * t;
        const centerY = paths.inner.y + (paths.outer.y - paths.inner.y) * t;
        const sourceX = Math.round(centerX + cos * radius);
        const sourceY = Math.round(centerY + sin * radius);
        if (sourceX < 0 || sourceY < 0 || sourceX >= imageWidth || sourceY >= imageHeight) continue;
        const offset = (sourceY * imageWidth + sourceX) * 4;
        const luminance = buffer[offset] * .299 + buffer[offset + 1] * .587 + buffer[offset + 2] * .114;
        if (luminance < 150) dark += 1;
      }
      if (dark >= Math.max(2, polarHeight * .055)) covered += 1;
    }
    return covered / polarWidth;
  }

  global.ImageAnalysisCore = { detectClosedPathsJs, detectCirclesJs: detectClosedPathsJs, scorePointsOnRing, scoreInkCoverage, analyzeSigilJs, analyzeSigilMetricsJs };
}(typeof globalThis !== 'undefined' ? globalThis : self));

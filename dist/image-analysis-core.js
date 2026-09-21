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

  function circleEdgeScore(edge, width, height, cx, cy, radius) {
    if (cx - radius < -width * .04 || cy - radius < -height * .04 || cx + radius > width * 1.04 || cy + radius > height * 1.04) return 0;
    const samples = 160;
    let total = 0;
    let visible = 0;
    for (let index = 0; index < samples; index += 1) {
      const theta = index / samples * Math.PI * 2;
      const x = Math.round(cx + Math.cos(theta) * radius);
      const y = Math.round(cy + Math.sin(theta) * radius);
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      let local = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const px = Math.round(cx + Math.cos(theta) * (radius + offset));
        const py = Math.round(cy + Math.sin(theta) * (radius + offset));
        if (px >= 1 && py >= 1 && px < width - 1 && py < height - 1) local = Math.max(local, edge[py * width + px]);
      }
      total += local;
      visible += 1;
    }
    return visible ? total / visible / 255 : 0;
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

  function detectCirclesJs(buffer, width, height) {
    const image = makeGrayImage(buffer, width, height);
    const edge = makeEdgeImage(image.gray, image.width, image.height);
    const shortSide = Math.min(image.width, image.height);
    const candidates = [];
    const centerStep = Math.max(1, Math.round(shortSide * .045));
    const radiusStep = Math.max(3, Math.round(shortSide * .018));
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const cx = image.width / 2 + dx * centerStep;
        const cy = image.height / 2 + dy * centerStep;
        for (let radius = Math.round(shortSide * .1); radius <= Math.round(shortSide * .72); radius += radiusStep) {
          const score = circleEdgeScore(edge, image.width, image.height, cx, cy, radius);
          if (score > .06) candidates.push({ x: cx, y: cy, r: radius, score });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = [];
    for (const candidate of candidates) {
      if (selected.some(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) < shortSide * .05 && Math.abs(candidate.r - other.r) < shortSide * .035)) continue;
      selected.push(candidate);
      if (selected.length >= 180) break;
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
        if (outer.r < shortSide * .35 || inner.r < shortSide * .25 || ratio < .35 || ratio > .84 || centerError > .24) continue;
        const score = outer.score + inner.score + (1 - centerError) * .32 + outer.r / shortSide * 1.4;
        if (score > bestScore) {
          bestScore = score;
          best = { outer, inner, confidence: clamp(score / 1.4) };
        }
      }
    }
    if (!best) throw new Error('二重円の姿をつかめなかった。外円全体が見えるよう、魔法陣を正面から写してください。');
    const restore = circle => ({ x: circle.x / image.scale, y: circle.y / image.scale, r: circle.r / image.scale });
    return { outer: restore(best.outer), inner: restore(best.inner), confidence: best.confidence };
  }

  function analyzeSigilMetricsJs(buffer, width, height, circle) {
    const image = makeGrayImage(buffer, width, height);
    const cx = circle.inner.x * image.scale;
    const cy = circle.inner.y * image.scale;
    const radius = circle.inner.r * image.scale;
    const samples = 180;
    const radii = [];
    const darkRatio = [];
    for (let index = 0; index < samples; index += 1) {
      const theta = index / samples * Math.PI * 2;
      let found = 0;
      let dark = 0;
      for (let step = Math.round(radius * .12); step < radius * .94; step += Math.max(1, radius * .012)) {
        const x = Math.round(cx + Math.cos(theta) * step);
        const y = Math.round(cy + Math.sin(theta) * step);
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        if (image.gray[y * image.width + x] < 150) { found = step / radius; dark += 1; }
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
      attack: Math.max(0, compactness * solidContour * 1.5 + sharpCornerScore * .8),
      defense: (angularity * 1.8 + broadCornerScore * .8 + (1 - lineDensity) * .25 + (1 - roughness) * .05) * solidContour,
      support: mean * Math.max(0, 1 - angularity * 1.7) + (1 - roughness) * .08,
      debuff: roughness * 4 + missingRayRatio * 2 + lineDensity * .2,
    };
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
    return {
      scores: { attack: raw.attack / total, defense: raw.defense / total, support: raw.support / total, debuff: raw.debuff / total },
      // Angular contour changes are a proxy for wobble in the drawn lines.
      lineStraightness: clamp(1 - roughness * 6),
    };
  }

  function analyzeSigilJs(buffer, width, height, circle) {
    return analyzeSigilMetricsJs(buffer, width, height, circle).scores;
  }

  global.ImageAnalysisCore = { detectCirclesJs, analyzeSigilJs, analyzeSigilMetricsJs };
}(typeof globalThis !== 'undefined' ? globalThis : self));

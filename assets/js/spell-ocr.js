/* Shared post-processing for browser and batch OCR.
 * It may rank a sequence using language roles, but it never replaces a word
 * with a vocabulary entry. The returned text is always made from OCR output.
 */
(function attachSpellOcrCore(global) {
  'use strict';

  const config = Object.freeze({
    maxInputSide: 2048,
    analysisInputSide: 1400,
    detectionModelUrl: 'https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.2.2/ch_PP-OCRv4_det_infer.onnx',
    recognitionModelUrl: 'https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.2.2/ch_PP-OCRv4_rec_infer.onnx',
    dictionaryUrl: 'https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.2.2/ppocr_keys_v1.txt',
    onnxRuntimeWebVersion: '1.17.3',
    rotationAngles: Object.freeze([0, 90, 180, 270]),
    preprocessingModes: Object.freeze(['source', 'contrast', 'binary']),
  });

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').replace(/[^A-Za-z .,!?'-]/g, '').trim();
  }

  function words(value) {
    return clean(value).toLowerCase().split(/\s+/).map(word => word.replace(/[^a-z]/g, '')).filter(Boolean);
  }

  function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    if (reason instanceof Error) throw reason;
    const error = new Error(reason || '解析は中断されました。');
    error.name = 'AbortError';
    throw error;
  }

  function normalize(value) {
    const recognized = words(value);
    if (!recognized.length) return '';
    const sentence = recognized.join(' ');
    return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
  }

  function srgbToLinear(channel) {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }

  function linearToSrgb(value) {
    const srgb = value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
    return Math.max(0, Math.min(255, Math.round(srgb * 255)));
  }

  function grayscaleByte(red, green, blue) {
    return linearToSrgb(.2126 * srgbToLinear(red) + .7152 * srgbToLinear(green) + .0722 * srgbToLinear(blue));
  }

  function lineGeometry(box) {
    const values = (Array.isArray(box) ? box.flat() : Array.from(box || []))
      .map(Number)
      .filter(Number.isFinite);
    const points = [];
    for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
    if (!points.length) return { x: 0, y: 0, angle: 0, length: 1 };
    let farthest = [points[0], points[0], 0];
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        const distance = Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
        if (distance > farthest[2]) farthest = [points[a], points[b], distance];
      }
    }
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      angle: Math.atan2(farthest[1].y - farthest[0].y, farthest[1].x - farthest[0].x),
      length: Math.max(24, farthest[2]),
    };
  }

  // Polar-unwarp the annulus into overlapping, tangent-aligned strips for the existing line recognizer.
  function unwrapRingSectors(image, options = {}) {
    const { data, width, height } = image || {};
    if (!data || !width || !height) return [];
    const centerX = Number(options.centerX ?? width / 2);
    const centerY = Number(options.centerY ?? height / 2);
    const side = Math.min(width, height);
    const innerRadius = side * (options.innerRadiusRatio ?? 0.36);
    const outerRadius = side * (options.outerRadiusRatio ?? 0.5);
    const sectorCount = options.sectorCount ?? 4;
    const overlap = options.overlap ?? Math.PI / 8;
    const output = [];
    for (let sector = 0; sector < sectorCount; sector += 1) {
      const start = -Math.PI / 2 + sector * Math.PI * 2 / sectorCount - overlap;
      const end = -Math.PI / 2 + (sector + 1) * Math.PI * 2 / sectorCount + overlap;
      const middle = (start + end) / 2;
      const radius = (innerRadius + outerRadius) / 2;
      const arcLength = Math.max(48, Math.round(radius * (end - start)));
      const bandHeight = Math.max(48, Math.round(outerRadius - innerRadius));
      const pixels = new Uint8ClampedArray(arcLength * bandHeight * 4);
      for (let y = 0; y < bandHeight; y += 1) {
        const r = outerRadius - (y + 0.5) / bandHeight * (outerRadius - innerRadius);
        for (let x = 0; x < arcLength; x += 1) {
          const theta = start + (x + 0.5) / arcLength * (end - start);
          const sx = Math.max(0, Math.min(width - 1, Math.round(centerX + Math.cos(theta) * r)));
          const sy = Math.max(0, Math.min(height - 1, Math.round(centerY + Math.sin(theta) * r)));
          const source = (sy * width + sx) * 4;
          pixels.set(data.subarray ? data.subarray(source, source + 4) : Array.from(data).slice(source, source + 4), (y * arcLength + x) * 4);
        }
      }
      const lineLength = radius * (end - start);
      const tangent = middle + Math.PI / 2;
      const cx = centerX + Math.cos(middle) * radius;
      const cy = centerY + Math.sin(middle) * radius;
      const axisX = Math.cos(tangent) * lineLength / 2;
      const axisY = Math.sin(tangent) * lineLength / 2;
      const normalX = Math.cos(middle) * bandHeight / 2;
      const normalY = Math.sin(middle) * bandHeight / 2;
      output.push({
        image: { data: pixels, width: arcLength, height: bandHeight },
        box: [[cx - axisX - normalX, cy - axisY - normalY], [cx + axisX - normalX, cy + axisY - normalY], [cx + axisX + normalX, cy + axisY + normalY], [cx - axisX + normalX, cy - axisY + normalY]],
        geometry: { x: cx, y: cy, angle: tangent, length: lineLength },
        groupId: `ring:${sector}`,
      });
    }
    return output;
  }

  function expandWords(text, geometry, groupId, confidence) {
    const recognized = words(text);
    const axis = { x: Math.cos(geometry.angle), y: Math.sin(geometry.angle) };
    const output = [];
    for (const reverse of recognized.length > 1 ? [false, true] : [false]) {
      const ordered = reverse ? [...recognized].reverse() : recognized;
      ordered.forEach((word, index) => {
        const offset = ((index + 0.5) / ordered.length - 0.5) * geometry.length * 0.72;
        const wordIndex = reverse ? recognized.length - index - 1 : index;
        output.push({ text: word, x: geometry.x + axis.x * offset, y: geometry.y + axis.y * offset, groupId: `${groupId}:${wordIndex}`, confidence });
      });
    }
    return output;
  }

  function editDistance(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let row = 1; row <= left.length; row += 1) {
      let diagonal = previous[0];
      previous[0] = row;
      for (let column = 1; column <= right.length; column += 1) {
        const above = previous[column];
        previous[column] = Math.min(
          previous[column] + 1,
          previous[column - 1] + 1,
          diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
        );
        diagonal = above;
      }
    }
    return previous[right.length];
  }

  // Join overlapping polar strips by observed character overlap; OCR letters remain literal.
  function stitchRingText(records) {
    const ordered = [...records].sort((left, right) => Number(String(left.groupId).split(':').at(-1)) - Number(String(right.groupId).split(':').at(-1)));
    if (ordered.length < 2) return ordered[0]?.selected.text || '';
    const fragments = ordered.map(record => {
      const letters = [];
      const boundaries = [];
      let wasSpace = false;
      for (const character of String(record.selected.text || '').toLowerCase()) {
        if (/[a-z]/.test(character)) {
          letters.push(character);
          wasSpace = false;
        } else if (letters.length && !wasSpace) {
          boundaries.push(letters.length);
          wasSpace = true;
        }
      }
      return { letters: letters.join(''), boundaries };
    }).filter(fragment => fragment.letters);
    if (fragments.length < 2) return fragments[0]?.letters || '';

    const anchor = fragments.reduce((best, fragment, index) => fragment.letters.length > fragments[best].letters.length ? index : best, 0);
    const orderedFragments = [...fragments.slice(anchor), ...fragments.slice(0, anchor)];
    let stitched = orderedFragments[0].letters;
    const boundaries = new Set(orderedFragments[0].boundaries);
    for (const fragment of orderedFragments.slice(1)) {
      const maxOffset = Math.min(24, fragment.letters.length - 3);
      let match = null;
      for (let offset = 0; offset <= maxOffset; offset += 1) {
        const maxLength = Math.min(stitched.length - offset, fragment.letters.length - offset);
        for (let length = maxLength; length >= 4; length -= 1) {
          const rightStart = stitched.length - length - offset;
          if (rightStart < 0) continue;
          if (stitched.slice(stitched.length - length, stitched.length) !== fragment.letters.slice(offset, offset + length)) continue;
          if (offset && stitched.slice(rightStart, rightStart + offset) !== fragment.letters.slice(0, offset)) continue;
          match = { offset, length, rightStart };
          break;
        }
        if (match) break;
      }

      let fragmentStart;
      if (match) {
        fragmentStart = match.rightStart;
        stitched += fragment.letters.slice(match.offset + match.length);
      } else {
        fragmentStart = stitched.length;
        boundaries.add(fragmentStart);
        stitched += fragment.letters;
      }
      for (const boundary of fragment.boundaries) {
        const position = fragmentStart + boundary;
        if (position > 0 && position < stitched.length) boundaries.add(position);
      }
    }

    const startText = orderedFragments[0].letters;
    const maxClosingOverlap = Math.min(startText.length, Math.floor(stitched.length / 2));
    for (let length = maxClosingOverlap; length >= 4; length -= 1) {
      if (!stitched.endsWith(startText.slice(0, length))) continue;
      stitched = stitched.slice(0, -length);
      for (const boundary of [...boundaries]) if (boundary >= stitched.length) boundaries.delete(boundary);
      break;
    }

    return [...stitched].map((character, index) => `${boundaries.has(index) ? ' ' : ''}${character}`).join('').trim();
  }

  function chooseConsensus(options, preferWordBoundaries = false) {
    const compare = (left, right) => {
      if (left.votes !== right.votes) return right.votes - left.votes;
      const leftLetters = String(left.text).replace(/[^a-z]/gi, '');
      const rightLetters = String(right.text).replace(/[^a-z]/gi, '');
      if (preferWordBoundaries && leftLetters === rightLetters) {
        const wordDifference = words(right.text).length - words(left.text).length;
        if (wordDifference) return wordDifference;
      }
      return right.text.length - left.text.length;
    };
    const ranked = [...options].sort(compare);
    const leader = ranked[0];
    if (!leader) return null;
    const leaderWordCount = words(leader.text).length;
    const primary = ranked.filter(option =>
      leader.votes - option.votes <= 1 && words(option.text).length === leaderWordCount,
    ).sort((left, right) => {
      const leftLetters = String(left.text).replace(/[^a-z]/gi, '');
      const rightLetters = String(right.text).replace(/[^a-z]/gi, '');
      if (preferWordBoundaries && leftLetters === rightLetters) {
        const wordDifference = words(right.text).length - words(left.text).length;
        if (wordDifference) return wordDifference;
      }
      return right.text.length - left.text.length || right.votes - left.votes;
    })[0] || leader;
    const mode = option => Math.max(-1, ...option.observations.map(({ variant }) => variant ?? -1));
    const closeAlternate = [...options].sort((left, right) => right.votes - left.votes || right.text.length - left.text.length).filter(option =>
      option !== primary && primary.votes - option.votes <= 1 &&
      mode(option) > mode(primary) && option.text.length >= primary.text.length && editDistance(primary.text, option.text) <= 1,
    ).sort((left, right) => mode(right) - mode(left) || right.votes - left.votes)[0];
    // Treat a one-vote lead as ambiguous across OCR runtimes and keep the
    // established longer-text tie break for those near-equal candidates.
    return closeAlternate || primary;
  }

  async function runRecognizeVariants({ source, preprocess, rotate, recognize, signal }) {
    const observations = [];
    for (const angle of config.rotationAngles) {
      for (const [variant, mode] of config.preprocessingModes.entries()) {
        throwIfAborted(signal);
        const prepared = await preprocess(source, mode);
        throwIfAborted(signal);
        const oriented = await rotate(prepared, angle);
        throwIfAborted(signal);
        const result = await recognize(oriented);
        throwIfAborted(signal);
        observations.push(result && typeof result === 'object'
          ? { ...result, angle, variant }
          : { text: result, angle, variant });
      }
    }
    return observations;
  }

  function decodeGreedyCtc(output, dictionary) {
    return decodeGreedyCtcDetailed(output, dictionary).text;
  }

  function decodeGreedyCtcDetailed(output, dictionary) {
    const steps = output.dims.at(-2);
    const classes = output.dims.at(-1);
    const chars = [];
    const tokens = [];
    let previous = -1;
    for (let step = 0; step < steps; step += 1) {
      const start = step * classes;
      const row = output.data.slice(start, start + classes);
      let best = 0;
      for (let index = 1; index < row.length; index += 1) {
        if (row[index] > row[best]) best = index;
      }
      if (best && best !== previous) {
        const character = dictionary[best - 1] || '';
        chars.push(character);
        if (character) tokens.push({ character, x: (step + 0.5) / steps });
      }
      previous = best;
    }
    return { text: clean(chars.join('')), tokens };
  }

  // Warped circular text can lose spaces in recognition while the unwrapped image retains blank columns.
  function insertSpacesAtPixelGaps(image, decoded) {
    const { data, width, height } = image || {};
    if (!data || !width || !height || !decoded?.tokens?.length) return clean(decoded?.text || '');
    const bandStart = Math.floor(height * 0.18);
    const bandEnd = Math.ceil(height * 0.82);
    const bandHeight = Math.max(1, bandEnd - bandStart);
    const inkLimit = Math.max(1, Math.floor(bandHeight * 0.012));
    const columnInk = new Uint16Array(width);
    for (let y = bandStart; y < bandEnd; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const luminance = .2126 * data[offset] + .7152 * data[offset + 1] + .0722 * data[offset + 2];
        if (luminance < 150) columnInk[x] += 1;
      }
    }
    const tokens = decoded.tokens.map(token => ({ ...token, x: Math.max(0, Math.min(width - 1, Math.round(token.x * width))) }));
    const minimumGap = Math.max(4, Math.round(height * .09));
    const breaks = new Set();
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      if (!/[a-z]/i.test(tokens[index].character) || !/[a-z]/i.test(tokens[index + 1].character)) continue;
      const left = tokens[index].x;
      const right = tokens[index + 1].x;
      if (right <= left) continue;
      let longestBlank = 0;
      let currentBlank = 0;
      for (let x = left + 1; x < right; x += 1) {
        if (columnInk[x] <= inkLimit) {
          currentBlank += 1;
          longestBlank = Math.max(longestBlank, currentBlank);
        } else currentBlank = 0;
      }
      if (longestBlank >= minimumGap) breaks.add(index + 1);
    }
    if (!breaks.size) return clean(decoded.text);
    let text = '';
    for (let index = 0; index < tokens.length; index += 1) {
      if (breaks.has(index) && text && !text.endsWith(' ')) text += ' ';
      text += tokens[index].character;
    }
    return clean(text);
  }

  function preprocessRgba(image, mode) {
    const data = Uint8ClampedArray.from(image.data);
    if (mode === 'source') return { data, width: image.width, height: image.height };
    for (let index = 0; index < data.length; index += 4) {
      const luminance = grayscaleByte(data[index], data[index + 1], data[index + 2]);
      const value = mode === 'binary'
        ? (luminance < 160 ? 0 : 255)
        : Math.max(0, Math.min(255, Math.round(luminance * 1.35 - 44.8)));
      data[index] = data[index + 1] = data[index + 2] = value;
      data[index + 3] = 255;
    }
    return { data, width: image.width, height: image.height };
  }

  function rotateRgba(image, angle) {
    const quarter = ((Math.round(angle / 90) % 4) + 4) % 4;
    if (!quarter) return { data: Uint8ClampedArray.from(image.data), width: image.width, height: image.height };
    const width = quarter % 2 ? image.height : image.width;
    const height = quarter % 2 ? image.width : image.height;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        let targetX; let targetY;
        if (quarter === 1) { targetX = image.height - 1 - y; targetY = x; }
        else if (quarter === 2) { targetX = image.width - 1 - x; targetY = image.height - 1 - y; }
        else { targetX = y; targetY = image.width - 1 - x; }
        const source = (y * image.width + x) * 4;
        const target = (targetY * width + targetX) * 4;
        data.set(image.data.subarray ? image.data.subarray(source, source + 4) : Array.from(image.data).slice(source, source + 4), target);
      }
    }
    return { data, width, height };
  }

  function combineRgbaLines(first, second, firstAngle, secondAngle, resize) {
    const targetHeight = 240;
    const gap = 15;
    const prepare = (image, angle) => {
      const rotated = rotateRgba(image, angle);
      const width = Math.max(1, Math.round(rotated.width * targetHeight / rotated.height));
      return { data: resize(rotated.data, rotated.width, rotated.height, width, targetHeight), width };
    };
    const left = prepare(first, firstAngle);
    const right = prepare(second, secondAngle);
    const width = left.width + gap + right.width;
    const data = new Uint8ClampedArray(width * targetHeight * 4);
    data.fill(255);
    for (let y = 0; y < targetHeight; y += 1) {
      data.set(left.data.subarray(y * left.width * 4, (y + 1) * left.width * 4), y * width * 4);
      data.set(right.data.subarray(y * right.width * 4, (y + 1) * right.width * 4), (y * width + left.width + gap) * 4);
    }
    return { image: { data, width, height: targetHeight } };
  }

  function selectPath(candidates, width, height) {
    const groups = new Map();
    for (const [index, candidate] of candidates.entries()) {
      const groupId = candidate.groupId ?? index;
      const group = groups.get(groupId) || [];
      group.push(candidate);
      groups.set(groupId, group);
    }
    const center = { x: width / 2, y: height / 2 };
    const representatives = [...groups.values()].map(group => {
      return [...group].sort((a, b) => (b.confidence || 0) * Math.max(1, String(b.text).length) - (a.confidence || 0) * Math.max(1, String(a.text).length) || String(b.text).length - String(a.text).length)[0];
    }).filter(candidate => Number.isFinite(candidate.x) && Number.isFinite(candidate.y));
    if (!representatives.length) return { text: '', words: [], points: [], score: -Infinity };

    // Spell text can occupy more than one concentric track. A largest-radius-gap
    // split drops every word on the inner track, so retain word-sized detections
    // across the annulus and reject only detections close to the central sigil.
    const ringFloor = Math.min(width, height) * 0.28;
    const onRing = representatives.filter(candidate => Math.hypot(candidate.x - center.x, candidate.y - center.y) >= ringFloor);
    const selected = onRing.filter(candidate => {
      const text = String(candidate.text || '');
      return text.length >= 2 || (/^(a|i)$/i.test(text) && (candidate.confidence || 0) >= 2 / 12);
    }).sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    if (!selected.length) return { text: '', words: [], points: [], score: -Infinity };
    let largestAngularGap = -1;
    let start = 0;
    for (let index = 0; index < selected.length; index += 1) {
      const current = Math.atan2(selected[index].y - center.y, selected[index].x - center.x);
      const next = index + 1 < selected.length ? Math.atan2(selected[index + 1].y - center.y, selected[index + 1].x - center.x) : Math.atan2(selected[0].y - center.y, selected[0].x - center.x) + Math.PI * 2;
      const gap = next - current;
      if (gap > largestAngularGap) { largestAngularGap = gap; start = (index + 1) % selected.length; }
    }
    const ordered = selected.slice(start).concat(selected.slice(0, start));
    const words = ordered.map(candidate => candidate.text);
    return {
      text: normalize(words.join(' ')),
      words,
      points: ordered.map(candidate => ({ x: candidate.x / (width || 1), y: candidate.y / (height || 1) })),
      score: ordered.reduce((sum, candidate) => sum + (candidate.confidence || 0), 0),
    };
  }

  async function recognizeLineImages({ lineImages, width, height, recognizeVariants, combineLines, signal }) {
    const rawCandidates = [];
    const baseCandidates = [];
    const ringCandidates = [];
    const recognizedLines = [];
    for (const [lineIndex, line] of (lineImages || []).entries()) {
      throwIfAborted(signal);
      if (!line?.image) continue;
      const geometry = line.geometry || lineGeometry(line.box);
      const groupId = line.groupId ?? lineIndex;
      const votes = new Map();
      const observations = await recognizeVariants(line);
      throwIfAborted(signal);
      for (const observation of observations) {
        const text = words(observation?.text ?? observation).join(' ');
        if (!text) continue;
        const current = votes.get(text) || { text, votes: 0, observations: [] };
        current.votes += 1;
        if (observation && typeof observation === 'object') {
          const { angle, variant, spacingText } = observation;
          if (angle !== undefined || variant !== undefined) current.observations.push({ angle, variant });
          if (spacingText) (current.spacingTexts ||= []).push(spacingText);
        }
        votes.set(text, current);
      }
      const options = [...votes.values()];
      for (const option of options) {
        rawCandidates.push({ line: lineIndex, text: option.text, votes: option.votes, observations: option.observations });
      }
      const selected = chooseConsensus(options, String(groupId).startsWith('ring:'));
      if (selected && selected.spacingTexts?.length) {
        const letters = value => String(value || '').replace(/[^a-z]/gi, '').toLowerCase();
        const spacedVotes = new Map();
        for (const text of selected.spacingTexts) {
          if (letters(text) !== letters(selected.text)) continue;
          spacedVotes.set(text, (spacedVotes.get(text) || 0) + 1);
        }
        const preferredSpacing = [...spacedVotes].sort((left, right) => right[1] - left[1] || words(right[0]).length - words(left[0]).length)[0]?.[0];
        if (preferredSpacing) selected.text = preferredSpacing;
      }
      if (selected) recognizedLines.push({ line, lineIndex, geometry, groupId, selected });
    }

    const suppressedLines = new Set();
    if (combineLines && recognizedLines.length > 1) {
      const minSide = Math.min(width, height);
      const pairs = [];
      for (const shortLine of recognizedLines) {
        if (String(shortLine.groupId).startsWith('ring:')) continue;
        if (String(shortLine.selected.text).replace(/[^a-z]/gi, '').length !== 1) continue;
        for (const longLine of recognizedLines) {
          if (String(longLine.groupId).startsWith('ring:')) continue;
          if (shortLine === longLine || String(longLine.selected.text).replace(/[^a-z]/gi, '').length < 2) continue;
          if (shortLine.geometry.length > longLine.geometry.length * 0.6) continue;
          const center = { x: width / 2, y: height / 2 };
          const shortRadius = Math.hypot(shortLine.geometry.x - center.x, shortLine.geometry.y - center.y);
          const longRadius = Math.hypot(longLine.geometry.x - center.x, longLine.geometry.y - center.y);
          if (Math.abs(shortRadius - longRadius) > minSide * 0.06) continue;
          const shortAngle = Math.atan2(shortLine.geometry.y - center.y, shortLine.geometry.x - center.x);
          const longAngle = Math.atan2(longLine.geometry.y - center.y, longLine.geometry.x - center.x);
          const angularGap = Math.abs(shortAngle - longAngle);
          if (Math.min(angularGap, Math.PI * 2 - angularGap) > 0.35) continue;
          const distance = Math.hypot(shortLine.geometry.x - longLine.geometry.x, shortLine.geometry.y - longLine.geometry.y);
          if (distance > minSide * 0.15) continue;
          const first = shortAngle < longAngle ? shortLine : longLine;
          const second = first === shortLine ? longLine : shortLine;
          pairs.push({ first, second, shortLine, longLine, distance });
        }
      }
      pairs.sort((left, right) => left.distance - right.distance);
      for (const { first, second, shortLine } of pairs) {
        throwIfAborted(signal);
        if (suppressedLines.has(first.lineIndex) || suppressedLines.has(second.lineIndex)) continue;
        const firstLength = String(first.selected.text).replace(/[^a-z]/gi, '').length;
        const secondLength = String(second.selected.text).replace(/[^a-z]/gi, '').length;

        for (const quarterTurn of [90, 0, 270]) {
          const joined = await combineLines(first.line, second.line, first === shortLine ? quarterTurn : 0, second === shortLine ? quarterTurn : 0);
          throwIfAborted(signal);
          if (!joined?.image) continue;
          const optionsByText = new Map();
          const observations = await recognizeVariants(joined);
          throwIfAborted(signal);
          for (const observation of observations) {
            const text = words(observation?.text ?? observation).join(' ');
            if (!text) continue;
            const current = optionsByText.get(text) || { text, votes: 0, observations: [] };
            current.votes += 1;
            if (observation && typeof observation === 'object') {
              const { angle, variant } = observation;
              if (angle !== undefined || variant !== undefined) current.observations.push({ angle, variant });
            }
            optionsByText.set(text, current);
          }
          const options = [...optionsByText.values()];
          for (const option of options) rawCandidates.push({ line: `${first.lineIndex}+${second.lineIndex}`, text: option.text, votes: option.votes, observations: option.observations });
          const selected = chooseConsensus(options);
          const joinedLength = String(selected?.text || '').replace(/[^a-z]/gi, '').length;
          if (!selected || joinedLength < Math.max(firstLength, secondLength) + 1) continue;

          // Keep a successful composite OCR result in place of its fragments.
          suppressedLines.add(first.lineIndex);
          suppressedLines.add(second.lineIndex);
          const midpoint = { x: (first.geometry.x + second.geometry.x) / 2, y: (first.geometry.y + second.geometry.y) / 2 };
          baseCandidates.push(...expandWords(selected.text, { ...midpoint, angle: 0, length: Math.max(first.geometry.length, second.geometry.length) }, `joined:${first.groupId}:${second.groupId}`, selected.votes / 12));
          break;
        }
      }
    }
    for (const record of recognizedLines) {
      throwIfAborted(signal);
      if (!suppressedLines.has(record.lineIndex)) {
        const destination = String(record.groupId).startsWith('ring:') ? ringCandidates : baseCandidates;
        destination.push(...expandWords(record.selected.text, record.geometry, record.groupId, record.selected.votes / 12));
      }
    }
    const basePath = selectPath(baseCandidates, width || 1, height || 1);
    const ringPath = selectPath(ringCandidates, width || 1, height || 1);
    const ringRecords = recognizedLines.filter(record => !suppressedLines.has(record.lineIndex) && String(record.groupId).startsWith('ring:'));
    const stitchedRingText = stitchRingText(ringRecords);
    const letterCount = text => String(text || '').replace(/[^a-z]/gi, '').length;
    const ringRescues = letterCount(stitchedRingText) >= Math.max(16, letterCount(basePath.text) * 3) &&
      words(stitchedRingText).length >= words(basePath.text).length + 2;
    const selectedCandidates = ringRescues ? ringCandidates : baseCandidates;
    const selectedPath = ringRescues
      ? { ...ringPath, text: normalize(stitchedRingText), words: words(stitchedRingText) }
      : basePath;
    return { rawCandidates, candidates: selectedCandidates, path: selectedPath, ringRescues };
  }

  async function run({ detect, recognizeVariants, combineLines, signal }) {
    throwIfAborted(signal);
    const detected = await detect();
    throwIfAborted(signal);
    const width = detected.resizedImageWidth || detected.width || 1;
    const height = detected.resizedImageHeight || detected.height || 1;
    const recognition = await recognizeLineImages({
      lineImages: detected.lineImages,
      width,
      height,
      recognizeVariants,
      combineLines,
      signal,
    });
    throwIfAborted(signal);
    return { ...detected, ...recognition };
  }

  global.SpellOcrCore = {
    config,
    clean,
    words,
    normalize,
    selectPath,
    recognizeLineImages,
    runRecognizeVariants,
    decodeGreedyCtc,
    decodeGreedyCtcDetailed,
    insertSpacesAtPixelGaps,
    preprocessRgba,
    rotateRgba,
    combineRgbaLines,
    unwrapRingSectors,
    run,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));

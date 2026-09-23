/* Shared post-processing for browser and batch OCR.
 * It may rank a sequence using language roles, but it never replaces a word
 * with a vocabulary entry. The returned text is always made from OCR output.
 */
(function attachSpellOcrCore(global) {
  'use strict';

  const config = Object.freeze({
    maxInputSide: 0,
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

  function normalize(value) {
    const recognized = words(value);
    if (!recognized.length) return '';
    const sentence = recognized.join(' ');
    return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
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

  function chooseConsensus(options) {
    const ranked = [...options].sort((left, right) => right.votes - left.votes || right.text.length - left.text.length);
    const primary = ranked[0];
    if (!primary) return null;
    const mode = option => Math.max(-1, ...option.observations.map(({ variant }) => variant ?? -1));
    const closeAlternate = ranked.filter(option =>
      option !== primary && primary.votes - option.votes <= 1 &&
      mode(option) > mode(primary) && option.text.length >= primary.text.length && editDistance(primary.text, option.text) <= 1,
    ).sort((left, right) => mode(right) - mode(left) || right.votes - left.votes)[0];
    // When preprocessing variants disagree by one glyph, let the thresholded
    // pass break the tie; otherwise retain the strongest exact OCR vote.
    return closeAlternate || primary;
  }

  async function runRecognizeVariants({ source, preprocess, rotate, recognize }) {
    const observations = [];
    for (const angle of config.rotationAngles) {
      for (const [variant, mode] of config.preprocessingModes.entries()) {
        const prepared = await preprocess(source, mode);
        const oriented = await rotate(prepared, angle);
        observations.push({ text: await recognize(oriented), angle, variant });
      }
    }
    return observations;
  }

  function decodeGreedyCtc(output, dictionary) {
    const steps = output.dims.at(-2);
    const classes = output.dims.at(-1);
    const chars = [];
    let previous = -1;
    for (let step = 0; step < steps; step += 1) {
      const start = step * classes;
      const row = output.data.slice(start, start + classes);
      let best = 0;
      for (let index = 1; index < row.length; index += 1) {
        if (row[index] > row[best]) best = index;
      }
      if (best && best !== previous) chars.push(dictionary[best - 1] || '');
      previous = best;
    }
    return clean(chars.join(''));
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

  async function recognizeLineImages({ lineImages, width, height, recognizeVariants, combineLines }) {
    const rawCandidates = [];
    const candidates = [];
    const recognizedLines = [];
    for (const [lineIndex, line] of (lineImages || []).entries()) {
      if (!line?.image) continue;
      const geometry = lineGeometry(line.box);
      const groupId = line.groupId ?? lineIndex;
      const votes = new Map();
      for (const observation of await recognizeVariants(line)) {
        const text = words(observation?.text ?? observation).join(' ');
        if (!text) continue;
        const current = votes.get(text) || { text, votes: 0, observations: [] };
        current.votes += 1;
        if (observation && typeof observation === 'object') {
          const { angle, variant } = observation;
          if (angle !== undefined || variant !== undefined) current.observations.push({ angle, variant });
        }
        votes.set(text, current);
      }
      const options = [...votes.values()];
      for (const option of options) {
        rawCandidates.push({ line: lineIndex, text: option.text, votes: option.votes, observations: option.observations });
      }
      const selected = chooseConsensus(options);
      if (selected) recognizedLines.push({ line, lineIndex, geometry, groupId, selected });
    }

    const suppressedLines = new Set();
    if (combineLines && recognizedLines.length > 1) {
      const minSide = Math.min(width, height);
      const pairs = [];
      for (const shortLine of recognizedLines) {
        if (String(shortLine.selected.text).replace(/[^a-z]/gi, '').length !== 1) continue;
        for (const longLine of recognizedLines) {
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
        if (suppressedLines.has(first.lineIndex) || suppressedLines.has(second.lineIndex)) continue;
        const firstLength = String(first.selected.text).replace(/[^a-z]/gi, '').length;
        const secondLength = String(second.selected.text).replace(/[^a-z]/gi, '').length;

        for (const quarterTurn of [90, 0, 270]) {
          const joined = await combineLines(first.line, second.line, first === shortLine ? quarterTurn : 0, second === shortLine ? quarterTurn : 0);
          if (!joined?.image) continue;
          const optionsByText = new Map();
          for (const observation of await recognizeVariants(joined)) {
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
          candidates.push(...expandWords(selected.text, { ...midpoint, angle: 0, length: Math.max(first.geometry.length, second.geometry.length) }, `joined:${first.groupId}:${second.groupId}`, selected.votes / 12));
          break;
        }
      }
    }
    for (const record of recognizedLines) {
      if (!suppressedLines.has(record.lineIndex)) candidates.push(...expandWords(record.selected.text, record.geometry, record.groupId, record.selected.votes / 12));
    }
    return { rawCandidates, candidates, path: selectPath(candidates, width || 1, height || 1) };
  }

  async function run({ detect, recognizeVariants, combineLines }) {
    const detected = await detect();
    const width = detected.resizedImageWidth || detected.width || 1;
    const height = detected.resizedImageHeight || detected.height || 1;
    const recognition = await recognizeLineImages({
      lineImages: detected.lineImages,
      width,
      height,
      recognizeVariants,
      combineLines,
    });
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
    run,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));

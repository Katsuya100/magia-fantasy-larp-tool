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
        output.push({ text: word, x: geometry.x + axis.x * offset, y: geometry.y + axis.y * offset, groupId, confidence });
      });
    }
    return output;
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

    const radii = representatives.map(candidate => Math.hypot(candidate.x - center.x, candidate.y - center.y)).sort((a, b) => a - b);
    let split = -1;
    let largestGap = 0;
    for (let index = 0; index + 1 < radii.length; index += 1) {
      const gap = radii[index + 1] - radii[index];
      if (gap > largestGap) { largestGap = gap; split = index; }
    }
    const threshold = split >= 0 && largestGap >= Math.min(width, height) * 0.12
      ? (radii[split] + radii[split + 1]) / 2
      : radii[Math.floor(radii.length / 2)];
    const outer = representatives.filter(candidate => Math.hypot(candidate.x - center.x, candidate.y - center.y) >= threshold);
    const multiOuter = outer.filter(candidate => String(candidate.text || '').length >= 2);
    const filteredOuter = multiOuter.length >= 4 ? multiOuter : outer;
    const selected = (filteredOuter.length >= 2 ? filteredOuter : representatives).sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
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

  async function recognizeLineImages({ lineImages, width, height, recognizeVariants }) {
    const rawCandidates = [];
    const candidates = [];
    for (const [lineIndex, line] of (lineImages || []).entries()) {
      if (!line?.image) continue;
      const geometry = lineGeometry(line.box);
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
      for (const option of [...votes.values()].sort((a, b) => b.votes - a.votes)) {
        rawCandidates.push({ line: lineIndex, text: option.text, votes: option.votes, observations: option.observations });
        candidates.push(...expandWords(option.text, geometry, lineIndex, option.votes / 12));
      }
    }
    return { rawCandidates, candidates, path: selectPath(candidates, width || 1, height || 1) };
  }

  async function run({ detect, recognizeVariants }) {
    const detected = await detect();
    const width = detected.resizedImageWidth || detected.width || 1;
    const height = detected.resizedImageHeight || detected.height || 1;
    const recognition = await recognizeLineImages({
      lineImages: detected.lineImages,
      width,
      height,
      recognizeVariants,
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

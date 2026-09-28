(function registerMagiaImagePipeline(global) {
  'use strict';

  const spellCore = global.SpellOcrCore;
  const imageCore = global.ImageAnalysisCore;
  const attributeCore = global.AttributeScoringCore;
  const powerCore = global.PowerCalculationCore;
  if (!spellCore || !imageCore || !attributeCore || !powerCore) {
    throw new Error('MagiaImagePipeline requires the spell, image, attribute, and power cores.');
  }

  const ATTRIBUTE_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
  const DEFAULT_SIGIL_SCORES = Object.freeze({ debuff: .25, attack: .25, defense: .25, support: .25 });

  function fitDimensions(width, height, maxSide) {
    const sourceWidth = Math.max(1, Number(width) || 1);
    const sourceHeight = Math.max(1, Number(height) || 1);
    const limit = Math.max(1, Number(maxSide) || Math.max(sourceWidth, sourceHeight));
    const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
      scale,
    };
  }

  function fitInputDimensions(width, height) {
    return fitDimensions(width, height, spellCore.config.maxInputSide);
  }

  function fitAnalysisDimensions(width, height) {
    return fitDimensions(width, height, spellCore.config.analysisInputSide);
  }

  async function createAnalysisInput({ width, height, read, resize }) {
    const dimensions = fitAnalysisDimensions(width, height);
    const image = dimensions.scale < 1
      ? await resize(dimensions.width, dimensions.height)
      : await read();
    return { image, width: dimensions.width, height: dimensions.height, scale: dimensions.scale };
  }

  function scalePath(path, factor) {
    if (!path || factor === 1) return path;
    return {
      ...path,
      x: path.x * factor,
      y: path.y * factor,
      r: path.r * factor,
      radii: path.radii?.map(radius => radius * factor),
    };
  }

  function restoreStructureScale(structure, scale) {
    if (!structure || !scale || scale === 1) return structure;
    const factor = 1 / scale;
    return {
      ...structure,
      paths: structure.paths && {
        ...structure.paths,
        outer: scalePath(structure.paths.outer, factor),
        inner: scalePath(structure.paths.inner, factor),
      },
    };
  }

  function analyzeStructure(buffer, width, height) {
    const paths = imageCore.detectClosedPathsJs(buffer, width, height);
    const metrics = imageCore.analyzeSigilMetricsJs(buffer, width, height, paths);
    return { paths, sigilScores: metrics.scores, lineStraightness: metrics.lineStraightness };
  }

  function attributeInputTexts(text) {
    const keys = Object.keys(attributeCore.attributes);
    const descriptions = keys.flatMap(key => attributeCore.attributes[key].descriptions);
    return [`query: ${text}`, ...descriptions.map(description => `passage: ${description}`)];
  }

  function cosine(left, right) {
    let dot = 0;
    let leftLength = 0;
    let rightLength = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftLength += left[index] * left[index];
      rightLength += right[index] * right[index];
    }
    return dot / (Math.sqrt(leftLength) * Math.sqrt(rightLength) || 1);
  }

  function scoreAttributeEmbedding(embedding) {
    const keys = Object.keys(attributeCore.attributes);
    const descriptions = keys.flatMap(key => attributeCore.attributes[key].descriptions);
    const vectorSize = embedding?.dims?.at(-1);
    if (!Number.isInteger(vectorSize) || vectorSize < 1 || !embedding.data || embedding.data.length < vectorSize * (descriptions.length + 1)) {
      throw new TypeError('The attribute embedding has an invalid shape.');
    }
    const data = embedding.data;
    const query = data.subarray(0, vectorSize);
    let vectorIndex = 1;
    const similarities = keys.map(key => {
      const values = attributeCore.attributes[key].descriptions.map(() => {
        const start = vectorIndex * vectorSize;
        vectorIndex += 1;
        return cosine(query, data.subarray(start, start + vectorSize));
      }).sort((left, right) => right - left);
      return [key, values.slice(0, 2).reduce((sum, value) => sum + value, 0) / Math.min(2, values.length)];
    });
    const rates = attributeCore.normalizeSimilarities(similarities.slice().sort((left, right) => right[1] - left[1]))
      .sort((left, right) => right[1] - left[1]);
    return { top: rates[0]?.[0] || null, certainty: rates[0]?.[1] || 0, rates, similarities: Object.fromEntries(similarities) };
  }

  function fallbackAttribute(error = null) {
    const keys = Object.keys(attributeCore.attributes);
    return {
      top: keys[0] || null,
      certainty: 0,
      rates: keys.map(key => [key, 0, 0]),
      similarities: Object.fromEntries(keys.map(key => [key, 0])),
      error: error?.message || (error ? String(error) : null),
    };
  }

  function scoreSigil(scores, hasInnerPath = true) {
    const source = hasInnerPath && scores ? scores : DEFAULT_SIGIL_SCORES;
    const entries = Object.entries(source).map(([key, score]) => [key, Math.max(0, Number(score) || 0)]);
    const total = entries.reduce((sum, [, score]) => sum + score, 0);
    const rates = total
      ? entries.map(([key, score]) => [key, score / total]).sort((left, right) => right[1] - left[1])
      : entries.map(([key]) => [key, 1 / Math.max(entries.length, 1)]).sort((left, right) => right[1] - left[1]);
    const percentages = attributeCore.allocateWholePercentages(rates);
    return {
      top: rates[0]?.[0] || null,
      certainty: rates[0]?.[1] || 0,
      rates,
      percentages: Object.fromEntries(percentages),
      scores: Object.fromEntries(entries),
    };
  }

  function scoreStructure(structure, spellPoints, masterImage, reportStage = null) {
    const paths = structure?.paths || null;
    const hasPaths = Boolean(paths);
    reportStage?.('structure-score-image-read-start', {
      width: masterImage?.width || 0, height: masterImage?.height || 0,
      estimatedBytes: masterImage?.data?.byteLength || 0,
    });
    const inkCoverage = paths?.inner
      ? imageCore.scoreInkCoverage(masterImage.data, masterImage.width, masterImage.height, paths)
      : 0;
    reportStage?.('structure-score-image-read-done', { inkCoverage });
    const textCoverage = paths
      ? imageCore.scorePointsOnRing(paths, spellPoints, masterImage.width, masterImage.height)
      : 0;
    const ringCoverage = spellPoints.length ? (inkCoverage + textCoverage) / 2 : inkCoverage;
    const sigil = scoreSigil(structure?.sigilScores, Boolean(paths?.inner));
    return {
      paths,
      lineStraightness: Number(structure?.lineStraightness) || 0,
      circleAccuracy: Number(paths?.circleAccuracy) || 0,
      inkCoverage,
      textCoverage,
      ringCoverage,
      sigil,
      error: structure?.error || null,
    };
  }

  function calculatePower({ structure, attribute, words }) {
    return powerCore.calculatePower({
      circleAccuracy: structure.circleAccuracy,
      lineStraightness: structure.lineStraightness,
      ringCoverage: structure.ringCoverage,
      attributeCertainty: attribute.certainty,
      sigilCertainty: structure.sigil.certainty,
      words,
    });
  }

  function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error(signal.reason || 'Image analysis was cancelled.');
    error.name = 'AbortError';
    throw error;
  }

  function emptySpell(error = null) {
    return {
      path: { text: '', words: [], points: [] },
      lineImages: [],
      error: error?.message || null,
    };
  }

  function isEmptySpell(spell) {
    return !String(spell?.path?.text || '').trim() && !(spell?.path?.words?.length);
  }

  function isMemoryRelatedError(error) {
    const text = [error?.message, error?.cause?.message, error].filter(Boolean).join(' ').toLowerCase();
    if (error?.name === 'RangeError' && /(alloc|buffer|typed array|array length|memory|size)/i.test(text)) return true;
    return [
      'out of memory', 'out-of-memory', '\\boom\\b', 'allocation failed', 'failed to allocate',
      'cannot allocate', 'can\'t allocate', 'could not allocate', 'memory allocation', 'memory access out of bounds',
      'webassembly.memory', 'webassembly memory', 'wasm memory', 'wasm out of memory',
      'cannot enlarge memory', 'cannot enlarge memory arrays', 'failed to grow memory', 'memory growth', 'memory limit', 'memory.*exhaust', 'array buffer allocation failed',
      'invalid typed array length', 'invalid array length', 'maximum array buffer', 'bad alloc',
      'not enough memory', 'enomem', 'opencv.*alloc', 'alloc.*opencv', 'onnx.*alloc', 'alloc.*onnx',
    ].some(pattern => new RegExp(pattern).test(text));
  }

  async function run({ recognizeSpell, correctSpell, getStructureInput, getMasterImage, releaseMasterImage, analyzeStructure: analyzeStructureAdapter, embedAttributes, releaseEmbedding, releaseAttributeModel, onRecognitionRetry, reportStage = null, signal }) {
    let embedding;
    let structureInput;
    let masterImage;
    try {
      throwIfAborted(signal);
      let spell;
      let recognitionError = null;
      try {
        spell = await recognizeSpell(0);
      } catch (error) {
        throwIfAborted(signal);
        recognitionError = error;
        if (!isMemoryRelatedError(error)) {
          await onRecognitionRetry?.({ attempt: 1, error, empty: false });
          // The first disposable OCR worker has been stopped before this single retry.
          await new Promise(resolve => {
            if (typeof setTimeout === 'function') setTimeout(resolve, 0);
            else resolve();
          });
          throwIfAborted(signal);
          try {
            spell = await recognizeSpell(1);
          } catch (retryError) {
            throwIfAborted(signal);
            recognitionError = retryError;
            spell = emptySpell(retryError);
          }
        } else {
          spell = emptySpell(error);
        }
      }
      if (!spell || isEmptySpell(spell)) {
        spell = emptySpell(spell?.error
          ? new Error(spell.error)
          : recognitionError || new Error('OCR returned no spell text.'));
      }
      throwIfAborted(signal);

      reportStage?.('structure-input-build-start');
      structureInput = await getStructureInput();
      reportStage?.('structure-input-build-done', {
        width: structureInput?.analysis?.image?.width || structureInput?.analysis?.width || null,
        height: structureInput?.analysis?.image?.height || structureInput?.analysis?.height || null,
        scale: structureInput?.analysis?.scale || null,
      });
      throwIfAborted(signal);
      let rawStructure;
      try {
        rawStructure = await (analyzeStructureAdapter || (input => {
          const image = input.image || input;
          const data = image.data?.buffer || image.data || image.buffer || image;
          return analyzeStructure(data, image.width || input.width, image.height || input.height);
        }))(structureInput.analysis);
      } catch (error) {
        throwIfAborted(signal);
        rawStructure = {
          paths: { outer: null, inner: null, circleAccuracy: 0 },
          sigilScores: DEFAULT_SIGIL_SCORES,
          lineStraightness: 0,
          error: error?.message || String(error),
        };
      }
      throwIfAborted(signal);
      reportStage?.('structure-scale-restore-start', { scale: structureInput.analysis.scale });
      const structure = restoreStructureScale(rawStructure, structureInput.analysis.scale);
      reportStage?.('structure-scale-restore-done', { scale: structureInput.analysis.scale });
      reportStage?.('structure-input-buffer-release-done', { allocationId: 'structure-input-rgba', allocationAction: 'release' });
      structureInput.analysis = null;

      reportStage?.('post-structure-start');
      reportStage?.('master-image-request-start');
      masterImage = structureInput.master || await getMasterImage();
      reportStage?.('master-image-ready', { width: masterImage?.width || null, height: masterImage?.height || null, estimatedBytes: masterImage?.data?.byteLength || 0 });
      throwIfAborted(signal);
      const spellPoints = spell?.path?.points || [];
      reportStage?.('structure-score-start');
      reportStage?.('structure-score-run-start', { width: masterImage?.width || 0, height: masterImage?.height || 0 });
      const structureResult = scoreStructure(structure, spellPoints, masterImage, reportStage);
      reportStage?.('structure-score-run-done');
      reportStage?.('structure-score-cleanup');
      masterImage = null;
      await releaseMasterImage?.();
      reportStage?.('master-image-release-done', { allocationId: 'master-image-rgba', allocationAction: 'release' });
      reportStage?.('structure-score-done');
      structureInput = null;

      if (correctSpell) {
        spell = await correctSpell(spell);
        throwIfAborted(signal);
      }
      const path = spell?.path || {};
      const spellWords = path.words || [];

      let attribute;
      try {
        embedding = await embedAttributes(path.text || '');
        throwIfAborted(signal);
        attribute = scoreAttributeEmbedding(embedding);
        embedding?.dispose?.();
        embedding = null;
        await releaseEmbedding?.();
        reportStage?.('embedding-output-buffer-release-done', { allocationId: 'embedding-output-float32', allocationAction: 'release' });
      } catch (error) {
        throwIfAborted(signal);
        attribute = fallbackAttribute(error);
      }
      const power = calculatePower({ structure: structureResult, attribute, words: spellWords });
      return {
        spell,
        structure: structureResult,
        attribute,
        sigil: structureResult.sigil,
        wordCount: power.normalized.wordCount,
        power,
      };
    } finally {
      try {
        embedding?.dispose?.();
        if (embedding) {
          embedding = null;
          await releaseEmbedding?.();
          reportStage?.('embedding-output-buffer-release-done', { allocationId: 'embedding-output-float32', allocationAction: 'release', cleanup: true });
        }
      }
      finally {
        if (masterImage) {
          masterImage = null;
          await releaseMasterImage?.();
          reportStage?.('master-image-release-done', { allocationId: 'master-image-rgba', allocationAction: 'release', cleanup: true });
        }
        masterImage = null;
        structureInput = null;
        await releaseAttributeModel?.();
      }
    }
  }

  global.MagiaImagePipeline = Object.freeze({
    ATTRIBUTE_MODEL_ID,
    DEFAULT_SIGIL_SCORES,
    fitDimensions,
    fitInputDimensions,
    fitAnalysisDimensions,
    createAnalysisInput,
    restoreStructureScale,
    analyzeStructure,
    attributeInputTexts,
    scoreAttributeEmbedding,
    fallbackAttribute,
    isMemoryRelatedError,
    scoreSigil,
    scoreStructure,
    calculatePower,
    run,
  });
})(globalThis);

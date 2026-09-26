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

  function scoreStructure(structure, spellPoints, masterImage) {
    const paths = structure?.paths || null;
    const hasPaths = Boolean(paths);
    const inkCoverage = paths?.inner
      ? imageCore.scoreInkCoverage(masterImage.data, masterImage.width, masterImage.height, paths)
      : 0;
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

  async function run({ recognizeSpell, getStructureInput, getMasterImage, analyzeStructure: analyzeStructureAdapter, embedAttributes, releaseAttributeModel, onRecognitionRetry, signal }) {
    let embedding;
    let structureInput;
    let masterImage;
    try {
      throwIfAborted(signal);
      let spell = null;
      let recognitionError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          spell = await recognizeSpell(attempt);
          if (!isEmptySpell(spell)) break;
          if (attempt === 1) break;
        } catch (error) {
          throwIfAborted(signal);
          recognitionError = error;
          if (attempt === 1) break;
          await onRecognitionRetry?.({ attempt: attempt + 1, error, empty: false });
          continue;
        }
        if (attempt === 0) await onRecognitionRetry?.({ attempt: attempt + 1, error: null, empty: true });
      }
      if (!spell || isEmptySpell(spell)) {
        spell = emptySpell(recognitionError || spell?.error || new Error('OCR returned no spell text after retry.'));
      }
      throwIfAborted(signal);

      structureInput = await getStructureInput();
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
      const structure = restoreStructureScale(rawStructure, structureInput.analysis.scale);

      masterImage = structureInput.master || await getMasterImage();
      throwIfAborted(signal);
      const path = spell?.path || {};
      const spellPoints = path.points || [];
      const spellWords = path.words || [];
      const structureResult = scoreStructure(structure, spellPoints, masterImage);
      masterImage = null;
      structureInput = null;

      let attribute;
      try {
        embedding = await embedAttributes(path.text || '');
        throwIfAborted(signal);
        attribute = scoreAttributeEmbedding(embedding);
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
      try { embedding?.dispose?.(); }
      finally {
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
    scoreSigil,
    scoreStructure,
    calculatePower,
    run,
  });
})(globalThis);

(function attachPowerCalculationCore(global) {
  'use strict';

  const PARAMETER_KEYS = Object.freeze([
    'lineStraightness',
    'ringCoverage',
    'attributeCertainty',
    'sigilCertainty',
    'wordCount',
  ]);

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function finiteNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
    return number;
  }

  function normalizeQuality(value, name) {
    return clamp(finiteNumber(value, name));
  }

  function normalizeWordCount(value) {
    const count = finiteNumber(value, 'wordCount');
    if (count < 0) throw new RangeError('wordCount must be zero or greater');
    return Math.floor(count);
  }

  function countUniqueWords(words) {
    if (!Array.isArray(words)) throw new TypeError('words must be an array');
    const normalizedWords = words
      .map(word => String(word).toLowerCase().replace(/[^a-z]/g, ''))
      .filter(Boolean);
    return new Set(normalizedWords).size;
  }

  function normalizeInputs(input = {}) {
    const wordCount = input.words !== undefined ? countUniqueWords(input.words) : input.wordCount;
    // Keep accepting the old field for existing callers; new calculations use ringCoverage.
    return {
      lineStraightness: normalizeQuality(input.lineStraightness, 'lineStraightness'),
      ringCoverage: normalizeQuality(input.ringCoverage ?? input.circleAccuracy ?? 0, 'ringCoverage'),
      attributeCertainty: normalizeQuality(input.attributeCertainty, 'attributeCertainty'),
      sigilCertainty: normalizeQuality(input.sigilCertainty, 'sigilCertainty'),
      wordCount: normalizeWordCount(wordCount),
    };
  }

  function calculatePower(input) {
    const normalized = normalizeInputs(input);
    const scores = {
      lineStraightness: normalized.lineStraightness,
      ringCoverage: normalized.ringCoverage,
      attributeCertainty: normalized.attributeCertainty,
      sigilCertainty: normalized.sigilCertainty,
    };
    const qualityAverage = Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length;
    return {
      power: Math.round(qualityAverage * normalized.wordCount * 100),
      normalized,
      scores,
      qualityAverage,
      formula: '((lineStraightness + ringCoverage + attributeCertainty + sigilCertainty) / 4) * wordCount * 100',
    };
  }

  global.PowerCalculationCore = Object.freeze({
    PARAMETER_KEYS,
    clamp,
    countUniqueWords,
    normalizeInputs,
    calculatePower,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));

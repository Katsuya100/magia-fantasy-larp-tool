(function attachPowerCalculationCore(global) {
  'use strict';

  const PARAMETER_KEYS = Object.freeze([
    'circleAccuracy',
    'lineStraightness',
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

  function normalizeInputs(input = {}) {
    return {
      circleAccuracy: normalizeQuality(input.circleAccuracy, 'circleAccuracy'),
      lineStraightness: normalizeQuality(input.lineStraightness, 'lineStraightness'),
      attributeCertainty: normalizeQuality(input.attributeCertainty, 'attributeCertainty'),
      sigilCertainty: normalizeQuality(input.sigilCertainty, 'sigilCertainty'),
      wordCount: normalizeWordCount(input.wordCount),
    };
  }

  function calculatePower(input) {
    const normalized = normalizeInputs(input);
    const scores = {
      circleAccuracy: normalized.circleAccuracy,
      lineStraightness: normalized.lineStraightness,
      attributeCertainty: normalized.attributeCertainty,
      sigilCertainty: normalized.sigilCertainty,
    };
    const qualityAverage = Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length;
    return {
      power: Math.round(qualityAverage * normalized.wordCount * 100),
      normalized,
      scores,
      qualityAverage,
      formula: '((circleAccuracy + lineStraightness + attributeCertainty + sigilCertainty) / 4) * wordCount * 100',
    };
  }

  global.PowerCalculationCore = Object.freeze({
    PARAMETER_KEYS,
    clamp,
    normalizeInputs,
    calculatePower,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));

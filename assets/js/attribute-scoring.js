(function registerAttributeScoring(global) {
  'use strict';

  const attributes = Object.freeze({
    flame: { label: 'flame', icon: '🔥', descriptions: ['A spell that controls fire and heat.', 'A spell that burns enemies with intense crimson flames.', 'A destructive spell that creates explosions and blazing fire.'] },
    bolt: { label: 'bolt', icon: '⚡', descriptions: ['A spell that commands lightning and electric energy.', 'A sudden attack that strikes with thunder and flashing light.', 'A fast spell that releases a powerful electrical shock.'] },
    aqua: { label: 'aqua', icon: '💧', descriptions: ['A spell that controls water and flowing currents.', 'A spell that summons rain, waves, rivers, or the sea.', 'A fluid spell that washes away danger and restores calm.'] },
    gravity: { label: 'gravity', icon: '⬤', descriptions: ['A spell that controls gravity, weight, and falling force.', 'A heavy spell that pulls enemies down toward the ground.', 'A spell that bends mass, orbit, and the force of attraction.'] },
    storm: { label: 'storm', icon: '🌪', descriptions: ['A spell that commands wind, clouds, rain, and thunder together.', 'A violent spell that summons a raging storm across the sky.', 'A swirling spell that tears through the air with weather and wind.'] },
    law: { label: 'law', icon: '⚖', descriptions: ['A spell that creates order, rules, justice, and binding contracts.', 'A precise spell that judges enemies and enforces a command.', 'A protective spell that establishes a system and restores order.'] },
    chaos: { label: 'chaos', icon: '☄', descriptions: ['A spell that spreads disorder, randomness, and confusion.', 'A wild spell that breaks rules and twists reality unpredictably.', 'A strange destructive spell filled with noise, madness, and entropy.'] },
  });

  function normalizeSimilarities(scores, temperature = 0.04) {
    if (!scores.length) return [];
    if (!Number.isFinite(temperature) || temperature <= 0) throw new RangeError('temperature must be positive');

    const maximum = Math.max(...scores.map(([, score]) => score));
    const weights = scores.map(([key, score]) => [key, Math.exp((score - maximum) / temperature)]);
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    const shares = weights.map(([key, weight]) => [key, weight / total]);

    const tenths = shares.map(([, share]) => share * 1000);
    const wholeTenths = tenths.map(Math.floor);
    let remaining = 1000 - wholeTenths.reduce((sum, value) => sum + value, 0);
    const remainders = tenths.map((value, index) => [index, value - wholeTenths[index]])
      .sort((a, b) => b[1] - a[1] || String(shares[a[0]][0]).localeCompare(String(shares[b[0]][0])));
    for (let index = 0; index < remaining; index += 1) wholeTenths[remainders[index][0]] += 1;

    return shares.map(([key, share], index) => [key, share, wholeTenths[index] / 10]);
  }

  function allocateWholePercentages(entries) {
    if (!entries.length) return new Map();
    const weights = entries.map(([, value]) => Math.max(0, Number(value) || 0));
    const total = weights.reduce((sum, value) => sum + value, 0);
    const shares = weights.map(value => total > 0 ? value / total : 1 / weights.length);
    const percentages = shares.map(share => share * 100);
    const whole = percentages.map(Math.floor);
    const remaining = 100 - whole.reduce((sum, value) => sum + value, 0);
    const remainders = percentages.map((value, index) => [index, value - whole[index]])
      .sort((a, b) => b[1] - a[1] || String(entries[a[0]][0]).localeCompare(String(entries[b[0]][0])));
    for (let index = 0; index < remaining; index += 1) whole[remainders[index][0]] += 1;
    return new Map(entries.map(([key], index) => [key, whole[index]]));
  }

  global.AttributeScoringCore = { attributes, normalizeSimilarities, allocateWholePercentages };
})(globalThis);

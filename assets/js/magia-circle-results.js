(function registerMagiaCircleResults(global) {
  'use strict';

  // Rendering consumes the shared scores without changing their calculation.
  // Templates contain internal labels/icons and computed numeric values only.
  function create({ elements, powerInputs, diagnostics, setStatus }) {
    const { powerResult, powerDetail, shapeResult, shapeDetail, attributeResult, attributeDetail, modelStatus } = elements;
    const powerCalculation = global.PowerCalculationCore;
    const imagePipeline = global.MagiaImagePipeline;
    const ATTRIBUTES = global.AttributeScoringCore.attributes;
    function renderPower(precomputed = null) {
      const ready = Object.values(powerInputs).every(value => Number.isFinite(value));
      if (!ready) {
        powerResult.className = 'result-empty';
        powerResult.innerHTML = '<div class="altar-placeholder">共鳴率が揃うと、威力が現れます。</div>';
        powerDetail.className = 'detail-result result-empty';
        powerDetail.textContent = '威力の内訳は、すべての共鳴率が揃うと現れます。';
        return;
      }
      const result = precomputed || powerCalculation.calculatePower(powerInputs);
      if (diagnostics) diagnostics.power = result;
      const rows = [
        ['円の共鳴率', result.scores.circleAccuracy, `${Math.round(result.normalized.circleAccuracy * 100)}%`],
        ['線の共鳴率', result.scores.lineStraightness, `${Math.round(result.normalized.lineStraightness * 100)}%`],
        ['環と呪文の共鳴率', result.scores.ringCoverage, `${Math.round(result.normalized.ringCoverage * 100)}%`],
        ['相の共鳴率', result.scores.attributeCertainty, `${Math.round(result.normalized.attributeCertainty * 100)}%`],
        ['紋の共鳴率', result.scores.sigilCertainty, `${Math.round(result.normalized.sigilCertainty * 100)}%`],
      ];
      powerResult.className = 'altar-result altar-result--power';
      powerResult.innerHTML = `<strong class="altar-value">${result.power}</strong>`;
      powerDetail.className = 'detail-result';
      powerDetail.innerHTML = `<div class="power-lead"><span class="label">総合威力</span><strong class="value">${result.power}</strong></div><div class="bars">${rows.map(([label, score, value]) => `<div class="bar-row"><span>${label}</span><div class="bar"><span style="width:${Math.round(score * 100)}%"></span></div><strong>${value}</strong></div>`).join('')}</div><div class="power-count"><span>単語の数</span><strong>${result.normalized.wordCount}語</strong></div>`;
    }

    function renderShape(value) {
      const sigil = value?.rates ? value : imagePipeline.scoreSigil(value || imagePipeline.DEFAULT_SIGIL_SCORES);
      const names = { attack: '攻撃の紋', defense: '防御の紋', support: '回復の紋', debuff: '弱体の紋' };
      const icons = { attack: '⚔️', defense: '🛡️', support: '✚', debuff: '🕸️' };
      const rates = sigil.rates;
      const percentages = new Map(Object.entries(sigil.percentages));
      const top = [sigil.top, sigil.certainty];
      if (diagnostics) diagnostics.sigil = { top: sigil.top, rates, percentages: sigil.percentages };
      shapeResult.className = 'altar-result altar-result--shape';
      shapeResult.innerHTML = `<span class="altar-symbol">${icons[top[0]]}</span><div><div class="altar-kicker">最も共鳴した紋</div><strong class="altar-value">${names[top[0]].replace('の紋', '')}</strong></div>`;
      shapeDetail.className = 'detail-result';
      shapeDetail.innerHTML = `<div class="shape-title"><b>${icons[top[0]]} ${names[top[0]]}</b></div><div class="bars">${rates.map(([key]) => { const percentage = percentages.get(key); return `<div class="bar-row"><span>${icons[key]} ${names[key]}</span><div class="bar"><span style="width:${percentage}%"></span></div><strong>${percentage}%</strong></div>`; }).join('')}</div>`;
      return top[1];
    }

    function renderAttribute(attribute) {
      const rates = attribute.rates;
      const top = rates[0];
      if (!top || attribute.error) return renderAttributeFallback(attribute.error);
      if (diagnostics) diagnostics.attribute = { top: attribute.top, rates, similarities: attribute.similarities };
      attributeResult.className = 'altar-result altar-result--attribute';
      attributeResult.innerHTML = `<span class="altar-symbol">${ATTRIBUTES[top[0]].icon}</span><div><div class="altar-kicker">最も共鳴した相</div><strong class="altar-value">${ATTRIBUTES[top[0]].label}</strong></div>`;
      attributeDetail.className = 'detail-result';
      attributeDetail.innerHTML = `<div class="shape-title"><b>${ATTRIBUTES[top[0]].icon} ${ATTRIBUTES[top[0]].label}</b></div><div class="bars">${rates.map(([key, , percentage]) => `<div class="bar-row attribute-detail-row"><span>${ATTRIBUTES[key].icon} ${ATTRIBUTES[key].label}</span><div class="bar"><span style="width:${percentage}%"></span></div><strong>${percentage.toFixed(1)}%</strong></div>`).join('')}</div>`;
      setStatus(modelStatus, '呪文の相がひとつ、頁の上に現れた。', 'good');
      return attribute.certainty;
    }

    function renderAttributeFallback(error = null) {
      const fallback = imagePipeline.fallbackAttribute(error);
      const [top] = fallback.rates;
      attributeResult.className = 'altar-result altar-result--attribute';
      attributeResult.innerHTML = `<span class="altar-symbol">${ATTRIBUTES[top[0]].icon}</span><div><div class="altar-kicker">最も共鳴した相</div><strong class="altar-value">${ATTRIBUTES[top[0]].label}</strong></div>`;
      attributeDetail.className = 'detail-result';
      attributeDetail.innerHTML = `<div class="shape-title"><b>${ATTRIBUTES[top[0]].icon} ${ATTRIBUTES[top[0]].label}</b></div><div class="bars">${fallback.rates.map(([key]) => `<div class="bar-row attribute-detail-row"><span>${ATTRIBUTES[key].icon} ${ATTRIBUTES[key].label}</span><div class="bar"><span style="width:0%"></span></div><strong>0%</strong></div>`).join('')}</div><p class="note">呪文から相を判定できませんでした。</p>`;
      setStatus(modelStatus, '相を判定できませんでした。', 'error');
      if (diagnostics) diagnostics.attribute = { top: top[0], rates: fallback.rates, fallback: true, error: fallback.error };
      return 0;
    }


    return { renderPower, renderShape, renderAttribute, renderAttributeFallback };
  }

  global.MagiaCircleResults = Object.freeze({ create });
}(globalThis));

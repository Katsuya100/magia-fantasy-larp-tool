import { ATTRS } from "./kotodama-attributes.js";
import { norm, add, cosine, pctFromCos } from "./kotodama-scoring.js";
export function escapeHtml(value){return String(value).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
export function createKotodamaRenderer({ $, getCandidateVectors, getScoring, getLogs, knownAttrs }) {
const PUBLIC_ATTRS = () => Object.keys(ATTRS).filter(a => !ATTRS[a].hidden);
const KNOWN_ATTRS = knownAttrs;
const candidateVectors = { get: word => getCandidateVectors().get(word) };
const attrVec = name => getScoring().attrVec(name);
const nearestWords = (...args) => getScoring().nearestWords(...args);
const wordsFromMagicFormula = text => getScoring().wordsFromMagicFormula(text);
const pretty = n => Math.round(n).toLocaleString("ja-JP");
function renderAttrResults(scores, active=null, success=false, vec=null){
  const el=$('attrResults'); el.innerHTML='';
  const data = scores || PUBLIC_ATTRS().map(a=>[a,0]);
  let current=null, exclude=null;
  if(vec){
    current = norm(vec);
    exclude = new Set(Object.keys(ATTRS));
    const used = new Set(wordsFromMagicFormula($('spell').value || ''));
    for(const w of used) exclude.add(w);
  }
  function missingOne(a){
    if(!current) return '';
    const av = attrVec(a);
    if(!av) return '';
    const attr = norm(av);

    // 陽: この言霊を足した時に、その相へ近づく欠片。
    // 陰: この言霊を引いた時に、その相へ近づく欠片。
    // 以前は気まぐれで陰陽を出していたが、いまは実際に共鳴率が高くなる方を啓示する。
    function candidate(sign){
      const residual = sign > 0 ? add(attr, current, -1) : add(current, attr, -1);
      const mag = Math.sqrt(residual.reduce((sum,x)=>sum+x*x,0));
      if(mag < 1e-9) return null;
      const one = nearestWords(residual, exclude, 1)[0];
      if(!one) return null;
      const wv = candidateVectors.get(one[0]);
      if(!wv) return null;
      const trial = add(current, norm(wv), sign);
      return {word: one[0], sign, score: cosine(trial, av)};
    }

    const yang = candidate(+1);
    const yin = candidate(-1);
    const best = (!yin || (yang && yang.score >= yin.score)) ? yang : yin;
    if(!best) return '欠片<sub>無</sub>: なし';
    return best.sign > 0
      ? `欠片<sub>陽</sub>: +${escapeHtml(best.word)}`
      : `欠片<sub>陰</sub>: -${escapeHtml(best.word)}`;
  }
  for(const [i, item] of data.entries()){
    const [a,c] = item;
    if(ATTRS[a].hidden && !(success && active===a && KNOWN_ATTRS.has(a))) continue;
    const p = pctFromCos(c)*100;
    const forbidden = ATTRS[a].hidden && success && active===a;
    const mark = (success && active===a) ? (forbidden ? ' ✦ 禁忌顕現' : ' ✦ 顕現') : '';
    const hint = missingOne(a);
    el.insertAdjacentHTML('beforeend', `<div class="result-line ${forbidden?'forbidden':''}"><b class="attr-name">${ATTRS[a].icon} ${a}${mark}${hint?`<span class="missing-hint">${hint}</span>`:''}</b><div class="bar"><span style="width:${p.toFixed(1)}%"></span></div><span>${p.toFixed(1)}%</span></div>`);
  }
}
function renderNearResults(words){
  const el=$('nearResults'); el.innerHTML='';
  if(!words){ el.innerHTML='<div class="small">顕現後、魔導式の近似解がここに浮かぶ。</div>'; return; }
  for(const [w,c] of words){
    const p=pctFromCos(c)*100;
    el.insertAdjacentHTML('beforeend', `<div class="result-line"><b>${escapeHtml(w)}</b><div class="bar"><span style="width:${p.toFixed(1)}%"></span></div><span>${p.toFixed(1)}%</span></div>`);
  }
}
function renderInverseResults(vec){
  const el=$('inverseResults');
  if(!el) return;
  el.innerHTML='';
  if(!vec){
    el.innerHTML='<div class="small inverse-empty">術式の裏面がひらく時、反転術式の近似解がここに滲む。</div>';
    return;
  }
  // 反転術式の近似解は、相との一致度ではなく、魔導式ベクトルに -1 を掛けた先の近傍言霊を見る。
  // つまり「魔導式の近似解」の裏面版。
  const inv = vec.map(x=>-x);
  const exclude = new Set(Object.keys(ATTRS));
  const used = new Set(wordsFromMagicFormula($('spell').value || ''));
  for(const w of used) exclude.add(w);
  const words = nearestWords(inv, exclude, 8);
  if(!words || !words.length){
    el.innerHTML='<div class="small inverse-empty">裏返した術式に応える言霊は、まだ書架の闇に沈んでいる。</div>';
    return;
  }
  for(const [w,c] of words){
    const p = pctFromCos(c)*100;
    el.insertAdjacentHTML('beforeend', `<div class="result-line inverse-line"><b>${escapeHtml(w)}</b><div class="bar"><span style="width:${p.toFixed(1)}%"></span></div><span>${p.toFixed(1)}%</span></div>`);
  }
}
function renderLog(){
  const logs = getLogs();
  const el=$('log'); el.innerHTML='';
  if(!logs.length){ el.innerHTML='<div class="small">まだ一枚の頁も焦げていない。顕現したギアはここに写される。</div>'; return; }
  for(const l of logs){
    if(l.failed){
      const topText = l.top && ATTRS[l.top] ? ` / 最も近き表の相 ${ATTRS[l.top].icon} ${l.top}` : '';
      el.insertAdjacentHTML('beforeend', `<div class="logitem"><b>✧ 不発</b> / 顕現魔力 <b>0</b> / 共鳴率 ${(l.affinity*100).toFixed(1)}%${topText}<br><code>${escapeHtml(l.raw)}</code><br><span class="small">相は、まだ頁の裏に沈んだまま。</span></div>`);
    }else{
      const rare = l.forbidden ? '<br><span class="small">禁忌の相が顕現した。書架の奥で、封印の留め金がひとつ外れた。</span>' : '';
      const down = l.direct ? '↓' : '';
      el.insertAdjacentHTML('beforeend', `<div class="logitem ${l.forbidden?'forbidden':''}"><b>${ATTRS[l.target].icon} ${l.target}</b> / 顕現魔力 <b>${pretty(l.power)}${down}</b> / 共鳴率 ${(l.affinity*100).toFixed(1)}%<br><code>${escapeHtml(l.raw)}</code><br><span class="small">もっとも強く応えた相: ${ATTRS[l.top].icon} ${l.top}${l.direct?' / 真名の煤により顕現魔力のみ減衰':''}</span>${rare}</div>`);
    }
  }
}
function renderTabs(){
  const tabs=$('tabs'); tabs.innerHTML='';
  for(const a of PUBLIC_ATTRS()){
    tabs.insertAdjacentHTML('beforeend', `<button class="tab" data-a="${a}" title="書架のささやき">${ATTRS[a].icon} ${a}</button>`);
  }
  tabs.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{ updateLore(b.dataset.a); }));
  updateLore('flame');
}
function updateLore(active){
  const a = active || $('target').value || 'flame';
  if(ATTRS[a]?.hidden && !KNOWN_ATTRS.has(a)){ return; }
  $('lore').innerHTML = `<b>${ATTRS[a].icon} ${a}</b><br>${ATTRS[a].lore}<br><br><span class="small">関連言霊: ${ATTRS[a].words.join(', ')}</span>`;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.a===a));
}
return { renderAttrResults, renderNearResults, renderInverseResults, renderLog, renderTabs, updateLore };
}

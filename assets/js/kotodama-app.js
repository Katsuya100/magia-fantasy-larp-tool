import { ATTRS } from "./kotodama-attributes.js";
import { VectorStore } from "./kotodama-vector-store.js";
import { createKotodamaScoring, norm, add, cosine, pctFromCos } from "./kotodama-scoring.js";
import { createKotodamaRenderer } from "./kotodama-rendering.js";
import { loadKotodamaData, clearKotodamaCaches, clearLegacyKotodamaCaches } from "./kotodama-data.js";
let candidateVectors = new VectorStore();
let inputVectors = candidateVectors;
let dim = 0;
let loadedName = 'GloVe外典 未読';
let logs = [];
let isLoading = false;
let isCasting = false;
let vocabCache = null;
let forbiddenWords = new Set();
let frequencyRanks = null;
let candidateWords = null;
let candidateWordSet = new Set();
const MIN_AFFINITY = 0.75;
const HIDDEN_MIN_AFFINITY = 0.90;
const PUBLIC_ATTRS = () => Object.keys(ATTRS).filter(a => !ATTRS[a].hidden);
const KNOWN_ATTRS = new Set(PUBLIC_ATTRS());
const $ = id => document.getElementById(id);

let scoring = createKotodamaScoring({inputVectors,candidateVectors});
const attrVec = name => scoring.attrVec(name);
const nearestWords = (...args) => scoring.nearestWords(...args);
const parseSpell = text => scoring.parseSpell(text);
const attrScores = (...args) => scoring.attrScores(...args);
const wordsFromMagicFormula = text => scoring.wordsFromMagicFormula(text);
const spellToText = terms => scoring.spellToText(terms);
const parseTermsOnly = text => scoring.parseTermsOnly(text);
const vecFromTerms = terms => scoring.vecFromTerms(terms);
const closestPublicAttr = vec => scoring.closestPublicAttr(vec);
const bestFragmentForAttr = (...args) => scoring.bestFragmentForAttr(...args);
const { renderAttrResults, renderNearResults, renderInverseResults, renderLog, renderTabs, updateLore } = createKotodamaRenderer({ $, getCandidateVectors:()=>candidateVectors, getScoring:()=>scoring, getLogs:()=>logs, knownAttrs:KNOWN_ATTRS });
const CANDIDATE_FREQ_LIMIT = 5000;
const RANDOM_INK_FREQ_LIMIT = 3000;
const pretty = n => Math.round(n).toLocaleString("ja-JP");
const isCandidateWord = word => candidateWordSet.has(word);
const getFrequencyRank = word => frequencyRanks?.get(word) || Number.POSITIVE_INFINITY;
function showWarning(element, message) { const span=document.createElement("span"); span.className="warn"; span.textContent=message; element.replaceChildren(span); }
function showBusyMask(title='魔導司書が頁を読んでいる', detail='頁に触れず、燭台の火が落ち着くのを待て。', pct=null){
  const mask = $('busyMask');
  if(!mask) return;
  $('busyTitle').textContent = title;
  $('busyDetail').textContent = detail;
  if(pct == null){
    $('busyBar').style.width = '100%';
    $('busyBar').style.opacity = '.55';
  }else{
    $('busyBar').style.opacity = '1';
    $('busyBar').style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  }
  mask.classList.add('show');
}
function hideBusyMask(){
  const mask = $('busyMask');
  if(mask) mask.classList.remove('show');
}
function updateStatus(){ $('loadStatus').textContent = `${loadedName}: 入力 ${inputVectors.size.toLocaleString('ja-JP')}語 / 候補 ${candidateWords.length.toLocaleString('ja-JP')}語 / ${dim}次元`; }
function setBusy(loading=false, casting=false){
  isLoading = loading;
  isCasting = casting;
  const disabled = loading || casting;
  // Keep the input snapshot stable while an uncached word's page is being fetched.
  $('spell').readOnly = disabled;
  $('clearSpell').disabled = disabled;
  $('cast').disabled = disabled;
  $('randomSpell').disabled = disabled;
  $('dailyQuest').disabled = disabled;
  $('loadRemoteGlove').disabled = disabled;
}
function setLoadFailedMode(active, message=''){
  document.body.classList.toggle('load-failed', !!active);
  if(active){
    document.body.classList.remove('forbidden-awake');
    if(message){
      showWarning($('loadStatus'), message);
    }
  }
}
function resetEphemeralState(){
  logs = [];
  for(const a of Object.keys(ATTRS)){ if(ATTRS[a].hidden) KNOWN_ATTRS.delete(a); }
  document.body.classList.remove('forbidden-awake');
  $('sigil').classList.remove('forbidden');
  $('sigil').textContent = '✧';
  $('power').textContent = '0';
  $('rawMana').textContent = '0';
  $('affinity').textContent = '0%';
  $('mainMeter').style.width = '0%';
  $('target').value = '';
  $('usedWords').textContent = '言霊: -';
  $('judgement').textContent = '新たな外典が開かれた。頁はまだ何も知らない。';
  $('err').textContent = '';
  renderNearResults(null);
  renderLog();
}
function nextFrame(){ return new Promise(resolve => requestAnimationFrame(()=>resolve())); }

function revealFailure(message){
  try{
    hideBusyMask();
    setBusy(false, false);
    setLoadFailedMode(true, message || '頁のどこかで魔力が途切れた。外典の扉だけが、まだこちらを向いている。');
  }catch(e){
    console.error('failure reveal failed', e);
  }
}
window.addEventListener('error', (ev)=>{
  console.error('unhandled error', ev.error || ev.message);
  revealFailure('頁のどこかで魔力が途切れた。外典の扉から開き直してほしい。');
});
window.addEventListener('unhandledrejection', (ev)=>{
  console.error('unhandled rejection', ev.reason);
  revealFailure('魔導司書の手元で目録がほどけた。外典の扉から開き直してほしい。');
});
async function loadRemoteGlove(options={}){
  if(isLoading || isCasting) return;
  setBusy(true, false);
  showBusyMask('魔導司書が軽き写本を開いている', 'この頁のために選び抜かれた言霊を、書架から取り出している。', null);
  try {
    if(options.purgeCache) await clearKotodamaCaches().catch(error => console.warn('Kotodama cache cleanup:', error));
    else await clearLegacyKotodamaCaches().catch(error => console.warn('Legacy Kotodama cache cleanup:', error));
    // Release the previous dictionary before allocating the next one on mobile.
    candidateVectors = new VectorStore(); dim = 0; candidateWords = null; candidateWordSet = new Set(); vocabCache = null;
    inputVectors = candidateVectors;
    scoring = createKotodamaScoring({inputVectors,candidateVectors});
    const data = await loadKotodamaData({refresh:!!options.purgeCache});
    candidateVectors = data.candidateVectors; inputVectors = data.inputVectors; dim = inputVectors.dim;
    forbiddenWords = data.forbiddenWords; candidateWords = data.candidateWords;
    candidateWordSet = new Set(candidateWords);
    frequencyRanks = data.frequencyRanks;
    scoring = createKotodamaScoring({inputVectors,candidateVectors,candidateWords,forbiddenWords});
    scoring.ensureAttributeFallbacks();
    loadedName = 'GloVe外典の軽き写本';
    resetEphemeralState(); renderTabs(); updateStatus();
    setLoadFailedMode(false);
    setBusy(false, false);
    await cast();
  } catch(error) {
    setLoadFailedMode(true, '外典の扉が開かなかった: ' + error.message + '。外典の扉から開き直してほしい。');
  } finally { hideBusyMask(); setBusy(false, false); }
}
function fizzleText(affinity){
  if(affinity < .40) return '不発。刻印は互いの意味を知らず、頁の上でただ黒い粉になった。';
  if(affinity < .58) return '不発。相の匂いは遠く、歯車は一度だけ鳴って沈黙した。';
  if(affinity < .70) return '不発。相の扉は見えたが、まだ鍵山が浅い。近き意味を足し、余計な意味を削るべし。';
  return `不発。輪郭は立ったが、顕現境界には届かない。${(MIN_AFFINITY*100).toFixed(0)}%を越えるまで、頁は名を許さない。`;
}

function chooseManifest(scores){
  // 表の相は75%以上で顕現。禁忌の相は90%以上に届いた時だけ名を許す。
  // 禁忌が最上位でも90%未満なら封じたまま、次に近い表の相を探す。
  for(const item of scores){
    const a = item[0];
    const affinity = pctFromCos(item[1]);
    if(ATTRS[a].hidden){
      if(affinity >= HIDDEN_MIN_AFFINITY) return {target:a, score:item, affinity, forbidden:true};
      continue;
    }
    if(affinity >= MIN_AFFINITY) return {target:a, score:item, affinity, forbidden:false};
  }
  return null;
}
function judgementText(power, affinity, raw, target, direct){
  if(direct) return `禁書の余白に真名の煤が残った。${target} の名をそのまま刻んだため、共鳴率は澄んだまま、顕現魔力だけが静かに細った。`;
  if(affinity>=.92 && raw>=5) return '大顕現。頁の奥で歯車が噛み合い、相そのものが姿を持って立ち上がった。';
  if(affinity>=.82) return '顕現良好。意味の輪郭は澄み、相の紋章がはっきりと浮かんでいる。';
  if(affinity>=.68) return '顕現。ギアは回った。余計な意味をもう一枚削れば、刃はさらに鋭くなる。';
  if(affinity>=.55) return '相は揺らいでいる。魔力は宿ったが、意味の焦点がまだ霧の中にある。';
  return 'かろうじて顕現。言霊の数を積む前に、まずは相へ近づく意味の道筋を刻むべし。';
}
async function cast(){
  if(isLoading || isCasting){ $('err').innerHTML='<span class="warn">司書の手がまだ頁をめくっている。少し待て。</span>'; return; }
  setBusy(false, true);
  $('err').textContent='';
  await nextFrame();
  try{
    const spell = $('spell').value;
    const terms = scoring.parseSpellTerms(spell).used;
    if(terms.some(term => scoring.isInputWord(term.word) && !inputVectors.get(term.word))){
      showBusyMask('魔導司書が言霊の頁を探している', 'まだ控えにない言霊を、外典の書架から取り出している。', null);
    }
    await inputVectors.prepareWords(terms.map(term => term.word));
    const {vec, used, raw}=parseSpell(spell);
    const scores=attrScores(vec, used);
    if(!scores.length || !scores[0]) throw new Error('相の核が鍛えられない。関連言霊を宿した外典を開いてほしい。');
    const manifest = chooseManifest(scores);
    const bestPublic = scores.find(item => !ATTRS[item[0]].hidden) || scores[0];
    const target = manifest ? manifest.target : bestPublic[0];
    $('target').value = target;
    // 不発時は、禁忌の相との共鳴率を数値から読まれないようにする。
    // 画面に出す共鳴率は表七相の中で最も近い相だけを見る。
    const visibleAffinity = bestPublic ? pctFromCos(bestPublic[1]) : 0;
    const affinity = manifest ? manifest.affinity : visibleAffinity;
    const uniqueWords=[...new Set(used.map(u=>u.word))];
    const rawMana=uniqueWords.length;
    const direct = used.some(u=>u.word===target);
    const success = !!manifest;
    if(success && ATTRS[target].hidden) KNOWN_ATTRS.add(target);
    const forbidden = success && ATTRS[target].hidden;
    $('rawMana').textContent=rawMana;
    $('affinity').textContent=(affinity*100).toFixed(1)+'%';
    $('mainMeter').style.width=Math.min(100,affinity*100).toFixed(1)+'%';
    $('usedWords').textContent = '言霊: ' + used.map(u=>`${u.sign<0?'-':'+'}${u.word}`).join(' ');
    if(uniqueWords.length < used.length){
      const detail=document.createElement('span'); detail.className='small';
      detail.textContent=`重ね書きは書に見抜かれ、言霊の数には含まれない: ${used.length}語 → ${uniqueWords.length}語`;
      $('usedWords').append(document.createElement('br'),detail);
    }
    if(!success){
      document.body.classList.remove('forbidden-awake');
      $('sigil').classList.remove('forbidden');
      $('sigil').textContent='✧';
      $('power').textContent='0';
      $('judgement').innerHTML=`<b>不発</b>。${fizzleText(affinity)} <span class="small">顕現境界: ${(MIN_AFFINITY*100).toFixed(0)}%</span>`;
      renderAttrResults(scores, null, false, vec);
      renderNearResults(nearestWords(vec,new Set(used.map(u=>u.word)),8));
      renderInverseResults(vec, null, false);
      addLog({target:'fizzle', raw, rawMana, affinity, power:0, top:bestPublic ? bestPublic[0] : '', direct:false, failed:true});
      return;
    }
    const basePower=Math.max(1, Math.round(rawMana * 100 * Math.pow(affinity,1.7)));
    const power=direct ? Math.max(1, Math.round(basePower * .86)) : basePower;
    document.body.classList.toggle('forbidden-awake', forbidden);
    $('sigil').classList.toggle('forbidden', forbidden);
    $('sigil').textContent=ATTRS[target].icon;
    $('power').innerHTML=pretty(power) + (direct ? ' <span title="真名の煤による顕現魔力の減衰">↓</span>' : '');
    const forbiddenText = forbidden ? `<div class="forbidden-banner"><b>禁忌の相が顕現した</b>封じられていた名が、いま頁の裏から浮かび上がる。<br><span class="name">${ATTRS[target].icon} ${target}</span></div>` : '';
    const sealedText = (!forbidden && ATTRS[scores[0][0]].hidden && pctFromCos(scores[0][1]) < HIDDEN_MIN_AFFINITY)
      ? `<span class="forbidden-shadow-hint">禁忌らしき影が見えた。</span><br>`
      : '';
    $('judgement').innerHTML= forbiddenText + sealedText + `<b>${ATTRS[target].icon} ${target}</b> が目を覚ました。` + judgementText(power,affinity,rawMana,target,direct);
    renderAttrResults(scores, target, true, vec);
    updateLore(target);
    const exclude=new Set(used.map(u=>u.word)); Object.keys(ATTRS).forEach(a=>exclude.add(a));
    renderNearResults(nearestWords(vec,exclude,8));
    renderInverseResults(vec, target, true);
    addLog({target, raw, rawMana, affinity, power, basePower, top:target, direct, forbidden});
  }catch(e){ showWarning($('err'), e.message); }
  finally{ hideBusyMask(); setBusy(false, false); }
}
function addLog(x){
  logs.unshift(x); logs=logs.slice(0,20); renderLog();
}
function vocabularyPool(){
  if(vocabCache) return vocabCache;
  const banned = new Set(Object.keys(ATTRS));
  const out=[];
  const source = candidateWords || [];
  const randomRankLimit = frequencyRanks && frequencyRanks.size ? RANDOM_INK_FREQ_LIMIT : CANDIDATE_FREQ_LIMIT;
  for(const w of source){
    if(banned.has(w)) continue;
    if(!isCandidateWord(w)) continue;
    if(getFrequencyRank(w) > randomRankLimit) continue;
    if(w.length < 2 || w.length > 24) continue;
    out.push(w);
  }
  vocabCache = out;
  return out;
}
function pick(arr){return arr[Math.floor(Math.random()*arr.length)]}
function guidedScribe(){
  // 写本に導かせる:
  // いま頁に書かれている魔導式から、最も近い表七相を選ぶ。
  // その相に届くまで、欠片の選出と同じ方法で +言霊 / -言霊 を継ぎ足す。
  const vocab = vocabularyPool();
  if(!vocab.length) throw new Error('書架に拾える言霊がない。');

  let terms = parseTermsOnly($('spell').value || '');
  const used = new Set(Object.keys(ATTRS));
  for(const t of terms) used.add(t.word);

  if(!terms.length){
    let seed='';
    let guard=0;
    while(guard++ < 200){
      const w = pick(vocab);
      if(w && !used.has(w) && candidateVectors.has(w) && isCandidateWord(w)){ seed=w; break; }
    }
    if(!seed) throw new Error('最初の一滴になる言霊を拾えなかった。');
    terms.push({sign:+1, word:seed});
    used.add(seed);
  }

  let vec = vecFromTerms(terms);
  const target = closestPublicAttr(vec);
  if(!target) throw new Error('表七相の輪郭を読み取れなかった。');
  updateLore(target.attr);

  const maxTerms = 12;
  let bestTerms = terms.slice();
  let bestAffinity = target.affinity;
  let stagnation = 0;

  while(bestAffinity < MIN_AFFINITY && terms.length < maxTerms && stagnation < 3){
    const exclude = new Set(used);
    Object.keys(ATTRS).forEach(a=>exclude.add(a));
    const frag = bestFragmentForAttr(target.attr, vec, exclude);
    if(!frag || !frag.word || used.has(frag.word)) break;

    const nextTerms = terms.concat([{sign:frag.sign, word:frag.word}]);
    const nextVec = vecFromTerms(nextTerms);
    const nextAffinity = pctFromCos(cosine(nextVec, attrVec(target.attr)));

    terms = nextTerms;
    vec = nextVec;
    used.add(frag.word);
    if(nextAffinity > bestAffinity + 0.0001){
      bestAffinity = nextAffinity;
      bestTerms = terms.slice();
      stagnation = 0;
    }else{
      stagnation++;
    }
  }

  $('spell').value = spellToText(bestTerms);
}

function randomSpell(seedAttr=null){
  // 偶然の墨:
  // 書架から英字のみの言霊を無作為に拾い、+ / - を無作為に挟むだけの挙動。
  // 相へ近づける探索や90%到達の誘導は行わない。
  // seedAttr は相の書架から呼ばれた場合の互換用に受け取るが、偶然の墨では使わない。
  const vocab = vocabularyPool();
  if(!vocab.length){
    $('spell').value = '';
    return;
  }

  const count = Math.min(4, Math.max(1, 2 + Math.floor(Math.random() * 3)));
  const used = new Set(Object.keys(ATTRS));
  const terms = [];

  let guard = 0;
  while(terms.length < count && guard < 200){
    guard++;
    const word = pick(vocab);
    if(!word || used.has(word) || !candidateVectors.has(word) || !isCandidateWord(word)) continue;
    used.add(word);
    const sign = terms.length === 0 ? +1 : (Math.random() < 0.5 ? +1 : -1);
    terms.push({sign, word});
  }

  if(!terms.length){
    $('spell').value = '';
    return;
  }
  $('spell').value = spellToText(terms);
}

$('loadRemoteGlove').addEventListener('click', ()=>loadRemoteGlove({auto:false, purgeCache:true}));
$('cast').addEventListener('click', cast);
$('randomSpell').addEventListener('click', ()=>{if(isLoading || isCasting) return; randomSpell(); cast();});
async function scribeAndCast(){
  if(isLoading || isCasting) return;
  setBusy(false,true);
  try {
    const terms=parseTermsOnly($('spell').value);
    if(terms.length){
      scoring.parseSpellTerms(spellToText(terms));
      if(terms.some(term => scoring.isInputWord(term.word) && !inputVectors.get(term.word))) showBusyMask('魔導司書が言霊の頁を探している','写本の導きに、あなたの言霊も織り込んでいる。',null);
      await inputVectors.prepareWords(terms.map(term=>term.word));
    }
    guidedScribe();
  } catch(error){ showWarning($('err'),error.message); return; }
  finally { hideBusyMask(); setBusy(false,false); }
  await cast();
}
$('dailyQuest').addEventListener('click', scribeAndCast);
$('clearSpell').addEventListener('click', ()=>{ if(isLoading || isCasting) return; $('spell').value=''; $('err').textContent=''; $('spell').focus(); });
$('clearLog').addEventListener('click', ()=>{logs=[]; renderLog();});
setLoadFailedMode(true, '外典の扉が開くまで、頁は静かに閉じている。');
setTimeout(()=>loadRemoteGlove({auto:true}), 150);

import { ATTRS } from "./kotodama-attributes.js";
export function norm(v){ let s=0; for(const x of v) s += x*x; s=Math.sqrt(s)||1; return v.map(x=>x/s); }
export function add(a,b,sign=1){ const out=a.slice(); for(let i=0;i<out.length;i++) out[i]+=sign*b[i]; return out; }
export function cosine(a,b){ let s=0,na=0,nb=0; for(let i=0;i<a.length;i++){s+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i];} return s/(Math.sqrt(na)*Math.sqrt(nb)||1); }
export function pctFromCos(c){ return Math.max(0, Math.min(1, (c+1)/2)); }

export function createKotodamaScoring({ vectors, candidateWords = [], forbiddenWords = new Set() }) {
const dim = vectors.dim;
const allowed = new Set(candidateWords);
const PUBLIC_ATTRS = () => Object.keys(ATTRS).filter(a => !ATTRS[a].hidden);
const isCandidateWord = word => allowed.has(word);
const isForbiddenWord = word => forbiddenWords.has(word);
function avgVec(words){ let v=null,c=0; for(const w of words){ const vv=vectors.get(w); if(vv){ v = v ? add(v,vv,1) : vv.slice(); c++; } } return v ? v.map(x=>x/c) : null; }
function attrVec(name){ return vectors.get(name) || avgVec(ATTRS[name].words); }
function ensureAttributeFallbacks(){
  // If target words are missing, create attribute anchor from known related words.
  for(const a of Object.keys(ATTRS)){
    if(!vectors.get(a)){
      const v = avgVec(ATTRS[a].words);
      if(v) vectors.set(a, v);
    }
  }
}

function parseSpell(s){
  const raw = s.trim().toLowerCase();
  if(!raw) throw new Error('魔導式が空です。');
  if(/[^a-z0-9_+\-\s]/.test(raw)) throw new Error('この頁は英字の言霊と + と - 以外の印を読めない。');
  const used = parseTermsOnly(raw);
  if(!used.length) throw new Error('言霊の種が見つからない。');
  const sealed = [...new Set(used.map(u=>u.word).filter(isForbiddenWord))];
  if(sealed.length) throw new Error(`封じられた言霊が混じっている: ${sealed.join(', ')}`);
  return {vec: vecFromTerms(used), used, raw};
}
function wordsFromMagicFormula(s){
  return (s.toLowerCase().match(/[a-z0-9_]+/g) || []);
}

function nearestWords(vec, exclude=new Set(), n=8){
  // 統合目録がある場合は、検出許可された言霊だけを走査する。
  // 目録なしでも動くよう、最後の保険として全外典走査に戻す。
  const top=[];
  const source = candidateWords || vectors.words || [];
  for(const w of source){
    if(exclude.has(w)) continue;
    if(!isCandidateWord(w)) continue;
    const v = vectors.get(w);
    if(!v) continue;
    const c = cosine(vec,v);
    if(top.length < n){
      top.push([w,c]);
      if(top.length === n) top.sort((a,b)=>a[1]-b[1]);
    }else if(c > top[0][1]){
      top[0] = [w,c];
      top.sort((a,b)=>a[1]-b[1]);
    }
  }
  return top.sort((a,b)=>b[1]-a[1]);
}
function attrScores(vec, used=[]){
  // 共鳴率は、魔導式ベクトルと各相ベクトルの純粋な一致度だけを見る。
  // 真名を直接刻んだ場合の減衰は、顕現魔力だけに反映する。
  return Object.keys(ATTRS).map(a=>{
    const rawCos = cosine(vec, attrVec(a) || new Array(dim).fill(0));
    return [a, rawCos, rawCos];
  }).sort((x,y)=>y[1]-x[1]);
}
function spellToText(terms){
  return terms.map((t,i)=>`${i===0 && t.sign>0 ? '' : (t.sign>0 ? ' + ' : ' - ')}${t.word}`).join('').trim();
}
function parseTermsOnly(s){
  const raw = (s || '').trim().toLowerCase();
  const terms=[];
  let sign=+1;
  const re=/[+\-]|[a-z0-9_]+/g;
  let m;
  while((m=re.exec(raw))){
    const part=m[0];
    if(part==='+'){ sign=+1; continue; }
    if(part==='-'){ sign=-1; continue; }
    terms.push({word:part, sign});
    sign=+1;
  }
  return terms;
}
function vecFromTerms(terms){
  let vec = new Array(dim).fill(0);
  const missing=[];
  for(const t of terms){
    if(isForbiddenWord(t.word)) throw new Error(`封じられた言霊が混じっている: ${t.word}`);
    const v = vectors.get(t.word);
    if(!v){ missing.push(t.word); continue; }
    vec = add(vec, v, t.sign);
  }
  if(missing.length) throw new Error(`外典に名のない言霊: ${[...new Set(missing)].join(', ')}`);
  const mag = Math.sqrt(vec.reduce((sum,x)=>sum+x*x,0));
  if(mag===0) throw new Error('足した意味と削った意味が互いを喰い、虚無だけが残った。');
  return vec;
}
function closestPublicAttr(vec){
  let best=null;
  for(const a of PUBLIC_ATTRS()){
    const av = attrVec(a);
    if(!av) continue;
    const c = cosine(vec, av);
    if(!best || c > best.cos) best = {attr:a, cos:c, affinity:pctFromCos(c)};
  }
  return best;
}
function bestFragmentForAttr(attrName, currentVec, exclude=new Set()){
  const av = attrVec(attrName);
  if(!av) return null;
  const current = norm(currentVec);
  const attr = norm(av);
  function candidate(sign){
    const residual = sign > 0 ? add(attr, current, -1) : add(current, attr, -1);
    const mag = Math.sqrt(residual.reduce((sum,x)=>sum+x*x,0));
    if(mag < 1e-9) return null;
    const one = nearestWords(residual, exclude, 1)[0];
    if(!one) return null;
    const wv = vectors.get(one[0]);
    if(!wv) return null;
    const trial = add(current, norm(wv), sign);
    return {word: one[0], sign, score: cosine(trial, av)};
  }
  const yang = candidate(+1);
  const yin = candidate(-1);
  return (!yin || (yang && yang.score >= yin.score)) ? yang : yin;
}
return { avgVec, attrVec, ensureAttributeFallbacks, parseSpell, wordsFromMagicFormula, nearestWords, attrScores, spellToText, parseTermsOnly, vecFromTerms, closestPublicAttr, bestFragmentForAttr };
}

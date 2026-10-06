// These candidate gates and parsers are preserved from the original Kotodama app.
export const CANDIDATE_FREQ_LIMIT = 5000;
export function normalizeWord(w){ return String(w || '').trim().toLowerCase(); }
export function looksLikePlainEnglishWord(w){
  const word = normalizeWord(w);
  if(!/^[a-z]+$/.test(word)) return false;
  if(word.length === 1 && word !== 'a' && word !== 'i') return false;
  if(word.length > 22) return false;
  if(word.length > 1 && /^[ivxlcdm]+$/.test(word)) return false;
  return true;
}
const NAME_WORD_ALLOWLIST = new Set([
  // 人名としても使われるが、ゲーム上は普通語として残したいもの。
  // ベクトル演算の定番になる一般語は、人名目録に含まれていても候補から落とさない。
  'may','will','bill','mark','rose','grace','hope','faith','joy','sky','storm','cliff','stone','river','brook','amber','crystal','jade','ruby','pearl','sage','ash','ember','dawn','summer','autumn','winter','spring','flame','aqua','bolt','gravity','law','chaos',
  'king','queen','prince','princess','man','woman','boy','girl','father','mother','son','daughter','brother','sister','husband','wife','uncle','aunt','cousin','lord','lady','knight','hero',
  'emperor','empress','duke','duchess','count','countess','god','goddess','angel','demon','devil','witch','wizard','mage','warrior','soldier','hunter','thief','judge','human','person','child','adult','sun','moon','star','shadow','light','darkness','ice','snow',
  'empire','kingdom','republic','monarchy','dynasty','state','nation','country','realm','domain','territory','province','colony','federation','confederation','commonwealth','union','principality','duchy','emirate','caliphate','sultanate','khanate','government','regime','authority','sovereignty','crown','throne','court','council','senate','parliament','congress','cabinet','ministry','bureaucracy','administration','rule','reign','dominion','monarch','ruler','sovereign','governor','minister','chancellor','senator','consul','delegate','ambassador','mayor','citizen','subject','public','noble','aristocrat','peasant','servant','vassal','clergy','charter','decree','edict','mandate','constitution','code','statute','ordinance','covenant','pact','alliance','conquest','invasion','rebellion','revolution','border','frontier','capital','fortress','castle','palace','embassy','tribute'
]);
const PLACE_WORD_ALLOWLIST = new Set([
  // 地名としても使われるが、意味遊びに残したい普通語。
  'china','turkey','orange','reading','mobile','nice','water','fire','storm','ash','stone','river','brook','spring','autumn','winter','summer','dawn','ember','sage','jade','ruby','pearl','crystal','law','chaos',
  'king','queen','prince','princess','man','woman','boy','girl','father','mother','son','daughter','brother','sister','husband','wife','uncle','aunt','cousin','lord','lady','knight','hero',
  'emperor','empress','duke','duchess','count','countess','god','goddess','angel','demon','devil','witch','wizard','mage','warrior','soldier','hunter','thief','judge','human','person','child','adult','sun','moon','star','shadow','light','darkness','ice','snow',
  'empire','kingdom','republic','monarchy','dynasty','state','nation','country','realm','domain','territory','province','colony','federation','confederation','commonwealth','union','principality','duchy','emirate','caliphate','sultanate','khanate','government','regime','authority','sovereignty','crown','throne','court','council','senate','parliament','congress','cabinet','ministry','bureaucracy','administration','rule','reign','dominion','monarch','ruler','sovereign','governor','minister','chancellor','senator','consul','delegate','ambassador','mayor','citizen','subject','public','noble','aristocrat','peasant','servant','vassal','clergy','charter','decree','edict','mandate','constitution','code','statute','ordinance','covenant','pact','alliance','conquest','invasion','rebellion','revolution','border','frontier','capital','fortress','castle','palace','embassy','tribute'
]);
export function parseForbiddenListText(text){
  const words = new Set();
  for(const line of String(text || '').split(/\r?\n/)){
    const w = normalizeWord(line);
    // GloVe側の候補に使うため、英字だけの1語に絞る。
    // フレーズや記号つきの表現は、誤爆を避けるためここでは採らない。
    if(/^[a-z]+$/.test(w)) words.add(w);
  }
  return words;
}
export function parseCanonicalWordsText(text){
  const words = new Set();
  for(const line of String(text || '').split(/\r?\n/)){
    const w = normalizeWord(line);
    if(looksLikePlainEnglishWord(w)) words.add(w);
  }
  return words;
}
export function parseFrequencyWordsText(text){
  const ranks = new Map();
  let rank = 0;
  for(const line of String(text || '').split(/\r?\n/)){
    const trimmed = line.trim();
    if(!trimmed) continue;
    let w = '';
    if(trimmed.includes(',')){
      const cols = trimmed.split(',');
      if((cols[0] || '').toLowerCase() === 'rank') continue;
      w = normalizeWord(cols[1] || '');
    }else{
      w = normalizeWord(trimmed.split(/\s+/)[0]);
    }
    if(!looksLikePlainEnglishWord(w)) continue;
    if(ranks.has(w)) continue;
    rank++;
    if(rank > CANDIDATE_FREQ_LIMIT) break;
    ranks.set(w, rank);
  }
  return ranks;
}
export function parseNameWordsText(text){
  const words = new Set();
  for(const line of String(text || '').split(/\r?\n/)){
    const w = normalizeWord(line);
    if(/^[a-z]{2,22}$/.test(w) && !NAME_WORD_ALLOWLIST.has(w)) words.add(w);
  }
  return words;
}

export function addPlaceNameToken(words, value){
  const raw = String(value || '').toLowerCase();
  for(const part of raw.split(/[^a-z]+/)){
    const w = normalizeWord(part);
    if(/^[a-z]{2,22}$/.test(w) && looksLikePlainEnglishWord(w) && !PLACE_WORD_ALLOWLIST.has(w)) words.add(w);
  }
}
export function parsePlaceWordsText(text){
  const words = new Set();
  try{
    const json = JSON.parse(String(text || '{}'));
    for(const f of (json.features || [])){
      const p = f && f.properties ? f.properties : {};
      addPlaceNameToken(words, p.name);
      addPlaceNameToken(words, p.nameascii);
      addPlaceNameToken(words, p.name_alt);
    }
  }catch(err){
    throw new Error('Malformed Natural Earth vocabulary', {cause:err});
  }
  return words;
}
export function parseGeoNamesPlacesText(text){
  const words = new Set();
  const lines = String(text || '').split(/\r?\n/);
  for(const line of lines){
    if(!line) continue;
    const cols = line.split('\t');
    // GeoNames: 1=name, 2=asciiname。小規模地名まで拾うため cities500 を使う。alternatenames は多言語名が多く、普通語の誤除外を増やしやすいため使わない。
    addPlaceNameToken(words, cols[1]);
    addPlaceNameToken(words, cols[2]);
  }
  return words;
}

export function parseGeoNamesPlacesJson(text){
  const words = new Set();
  try{
    const arr = JSON.parse(String(text || '[]'));
    if(Array.isArray(arr)){
      for(const p of arr){
        if(!p) continue;
        // lmfmaier/cities-json は GeoNames cities500 由来。主名を採用する。
        addPlaceNameToken(words, p.name);
        addPlaceNameToken(words, p.asciiname);
      }
    }
  }catch(err){
    throw new Error('Malformed GeoNames JSON vocabulary', {cause:err});
  }
  return words;
}
export function mergeWordSets(...sets){
  const out = new Set();
  for(const set of sets){
    if(!set) continue;
    for(const w of set) out.add(w);
  }
  return out;
}
export function selectCandidates(words, { canonicalWords, frequencyRanks, nameWords, placeWords, forbiddenWords }) {
  return words.filter(word => looksLikePlainEnglishWord(word) &&
    !forbiddenWords.has(word) && canonicalWords.has(word) &&
    (frequencyRanks.get(word) || Infinity) <= CANDIDATE_FREQ_LIMIT &&
    (!nameWords.has(word) || NAME_WORD_ALLOWLIST.has(word)) &&
    (!placeWords.has(word) || PLACE_WORD_ALLOWLIST.has(word)))
    .sort((a,b) => (frequencyRanks.get(a) - frequencyRanks.get(b)) || a.localeCompare(b));
}

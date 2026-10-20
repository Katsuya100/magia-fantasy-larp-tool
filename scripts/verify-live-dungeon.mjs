import {readFile} from 'node:fs/promises';
// Require the actual GitHub Pages deployment to match this commit, not merely CI.
const origin='https://katsuya100.github.io/magia-fantasy-larp-tool/';
const expectedHtml=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const expectedAnalyzer=await readFile(new URL('../magia-circle.html',import.meta.url),'utf8');
const version=expectedHtml.match(/data-release="(\d{8}\.\d+)"/)?.[1];
if(!version)throw Error('Missing current release marker');
const assets=['assets/css/dungeon.css','assets/js/dungeon-app.mjs','assets/js/dungeon-image-urls.mjs',
 'assets/js/dungeon-cloud-integrity.mjs','assets/js/magia-circle-app.js','assets/js/dungeon-progress.mjs',
 'assets/js/dungeon-tutorial.mjs',
 'assets/js/dungeon-combat-fx.mjs','assets/js/dungeon-store.mjs',
 'assets/js/dungeon-upgrades.mjs','assets/js/dungeon-share.mjs',
 'assets/js/dungeon-card-art.mjs','assets/js/dungeon-circle-glow.mjs','assets/js/dungeon-preparation-ui.mjs',
 'assets/js/dungeon-list-view.mjs',
 'assets/js/dungeon-core.mjs','assets/js/dungeon-permadeath.mjs','assets/data/dungeon-balance.csv','assets/data/dungeon-buffs.csv',
 'assets/data/dungeon-levels.csv','assets/data/dungeon-enemies.csv','assets/data/dungeon-consumables.csv'];
const expected=new Map(await Promise.all(assets.map(async path=>[path,await readFile(new URL('../'+path,import.meta.url),'utf8')])));
const tutorialGifs=['tutorial-outer.gif','tutorial-inner.gif','tutorial-spell.gif','tutorial-sigil.gif'];
const expectedGifs=new Map(await Promise.all(tutorialGifs.map(async name=>[name,await readFile(new URL('../assets/images/'+name,import.meta.url))])));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function remote(path,attempt){
 const url=origin+path+(path.includes('?')?'&':'?')+'smoke='+attempt+'-'+Date.now();
 const response=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error(path+' HTTP '+response.status);
 return response.text();
}
let last='';
for(let attempt=1;attempt<=24;attempt++){
 try{
  const html=await remote('dungeon.html?release='+version,attempt);
  if(html!==expectedHtml)throw Error('Published HTML differs from this commit ('+version+')');
  const analyzerHtml=await remote('magia-circle.html?dungeon=1&release='+version,attempt);
  if(analyzerHtml!==expectedAnalyzer)throw Error('Published analyzer differs from this commit');
  const circlePart=html.match(/<div id="slotCards">([\s\S]*?)<\/div><\/div>/)?.[1]||'';
  const itemPart=html.match(/<div id="gearCards">([\s\S]*?)<\/div><\/div>/)?.[1]||'';
  if((circlePart.match(/data-open-slot=/g)||[]).length!==5||(itemPart.match(/data-open-item=/g)||[]).length!==0){
   throw Error('Published starting slots differ');
  }
  for(const asset of assets){
   const content=await remote(asset+'?v='+version,attempt);
   if(content!==expected.get(asset))throw Error('Published asset is stale: '+asset);
  }
  for(const name of tutorialGifs){
   const gifResponse=await fetch(origin+'assets/images/'+name+'?v='+version+'&smoke='+attempt+'-'+Date.now(),{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
   if(!gifResponse.ok)throw Error('Published '+name+' HTTP '+gifResponse.status);
   const published=Buffer.from(await gifResponse.arrayBuffer());
   if(published.subarray(0,6).toString()!=='GIF89a'||!published.equals(expectedGifs.get(name)))throw Error('Published tutorial GIF differs: '+name);
  }
  console.log('LIVE VERIFIED: Pages HTML, assets and four tutorial GIFs match '+version+' at '+origin);
  process.exit(0);
 }catch(error){
  last=String(error?.message||error);
  console.log('Waiting for published release '+version+' ('+attempt+'/24): '+last);
  if(attempt<24)await pause(12000);
 }
}
throw Error('Published Pages release not verified: '+last);

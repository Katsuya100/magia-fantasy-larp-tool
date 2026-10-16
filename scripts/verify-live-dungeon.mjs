import {readFile} from 'node:fs/promises';
const expectedCss=await readFile(new URL('../assets/css/dungeon.css',import.meta.url),'utf8');
const expectedJs=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
// This checks the real public GitHub Pages website, not repository files or a CI build.
const origin='https://katsuya100.github.io/magia-fantasy-larp-tool/';
const version='20261017.5';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function remote(path,tryNo){
 const url=origin+path+(path.includes('?')?'&':'?')+'smoke='+tryNo+'-'+Date.now();
 const response=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error(path+' HTTP '+response.status);
 return response.text();
}
let last='';
for(let attempt=1;attempt<=24;attempt++){
 try{
  const html=await remote('dungeon.html?release='+version,attempt);
  if(!html.includes('data-release="'+version+'"'))throw Error('Old HTML is still served');
  const circlePart=html.match(/<div id="slotCards">([\s\S]*?)<\/div><\/div>/)?.[1]||'';
  const itemPart=html.match(/<div id="gearCards">([\s\S]*?)<\/div><\/div>/)?.[1]||'';
  const nCircle=(circlePart.match(/data-open-slot=/g)||[]).length;
  const nItem=(itemPart.match(/data-open-item=/g)||[]).length;
  if(nCircle!==5||nItem!==5)throw Error('Published empty slots '+nCircle+'/'+nItem);
  const css=await remote('assets/css/dungeon.css?v='+version,attempt);
  if(css!==expectedCss)throw Error('Published CSS differs from the current repository revision');
  const js=await remote('assets/js/dungeon-app.mjs?v='+version,attempt);
  if(js!==expectedJs)throw Error('Published app JavaScript differs from the current repository revision');
  if(js.includes("note('魔法陣を保存した。性能は初回使用時に判明する。')"))throw Error('Old photo log remains in JS');
  console.log('LIVE VERIFIED: GitHub Pages HTML, five empty slots, SVG/CSS and continuous-camera JS at '+origin);
  process.exit(0);
 }catch(error){
  last=String(error?.message||error);
  console.log('Waiting for Pages deployment '+attempt+'/24: '+last);
  if(attempt<24)await pause(12000);
 }
}
throw Error('Published Pages release not verified: '+last);

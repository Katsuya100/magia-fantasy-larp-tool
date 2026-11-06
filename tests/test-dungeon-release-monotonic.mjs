import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const page=await readFile(new URL('../dungeon.html',import.meta.url),'utf8');
const app=await readFile(new URL('../assets/js/dungeon-app.mjs',import.meta.url),'utf8');
const release=(html)=>{
 const publicId=html.match(/class="release-id">v(\d{4})\.(\d{2})\.(\d{2})\.(\d+)</);
 const internalId=html.match(/id="dungeonApp"[^>]*data-release="(\d{8}\.\d+)"/);
 assert.ok(publicId&&internalId,'the public footer and data-release must both exist');
 const displayed=publicId.slice(1,4).join('')+'.'+publicId[4];
 assert.equal(displayed,internalId[1],'public footer and runtime version must match');
 return displayed;
};
const tuple=id=>{
 const match=/^(\d{4})(\d{2})(\d{2})\.(\d+)$/.exec(id);
 assert.ok(match,'invalid release: '+id);
 const [,year,month,day,build]=match;
 assert.ok(+month>=1&&+month<=12&&+day>=1&&+day<=31,'invalid release date: '+id);
 return [Number(year+month+day),Number(build)];
};
const compare=(a,b)=>{
 const x=tuple(a),y=tuple(b);
 return x[0]-y[0]||x[1]-y[1];
};
assert.ok(compare('20261103.9','20261103.10')<0,'build number comparison must be numeric');
assert.ok(compare('20261102.999','20261103.1')<0,'date comparison must be numeric');
const current=release(page);
// Static samples and tutorial images carry independent cache revisions.
// Only the runtime entrypoints and required art follow the public app release.
assert.match(page,new RegExp('dungeon\\.html\\?release='+current.replace('.','\\.')),
 'startup retry must use the current release');
for(const asset of ['assets/css/dungeon.css','assets/js/dungeon-app.mjs','assets/images/dungeon-parchment.jpg']){
 assert.ok(page.includes(asset+'?v='+current),'required asset version is missing: '+asset);
}
const shared=app.match(/from '\.\/dungeon-core\.mjs\?v=(\d{8}\.\d+)'/)?.[1];
assert.ok(shared,'the common dungeon core import is required');
for(const part of app.matchAll(/from ['"]\.\/([^'"]+\.mjs)(\?[^'"]*)?['"]/g)){
 const [ ,module,query]=part;
 // Pure alchemy rules can be refreshed independently of shared save/core module identity.
 const separate=['dungeon-cloud-sync.mjs','dungeon-battle-input.mjs','dungeon-combat-fx.mjs','dungeon-combat-fx-echo.mjs','dungeon-alchemy.mjs','dungeon-return-fx.mjs','dungeon-status-ui.mjs'].includes(module);
 const expected=module==='dungeon-tuning.mjs'?undefined:'?v='+(separate?current:shared);
 assert.equal(query,expected,'module identity/cache version mismatch: '+module);
}
for(const module of ['dungeon-store.mjs','dungeon-cloud-sync.mjs']){
 const content=await readFile(new URL('../assets/js/'+module,import.meta.url),'utf8');
 assert.ok(content.includes("from './dungeon-store.mjs?v="+shared+"'")||
  content.includes("from './dungeon-core.mjs?v="+shared+"'"),
  'module must retain the shared save/core identity: '+module);
}
if(process.env.DUNGEON_BASE_REF){
 const ref=process.env.DUNGEON_BASE_REF;
 assert.match(ref,/^[a-zA-Z0-9_\/.-]+$/,'invalid comparison ref');
 const base=execFileSync('git',['show',ref+':dungeon.html'],{encoding:'utf8'});
 const old=release(base);
 assert.ok(compare(current,old)>=0,
  'RELEASE ROLLBACK: PR '+current+' is older than '+ref+' '+old);
 console.log('PASS release '+current+' >= '+ref+' '+old);
}else{
 console.log('PASS internally consistent release '+current+' (no remote comparison ref)');
}

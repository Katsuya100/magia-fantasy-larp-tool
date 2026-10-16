import * as G from './dungeon-core.mjs';
import {openStore,allCircles,putCircle,deleteCircle,saveProfile,getProfile} from './dungeon-store.mjs';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,profile,circles=[],masters={},slots=[],carry=[],stream=null,activeAnalysis=null,urls=[];
function note(message){$('notice').textContent=message;}
async function persist(){await saveProfile(db,profile);}
async function load(){db=await openStore();profile=await getProfile(db);circles=await allCircles();const files={enemies:'dungeon-enemies.csv',items:'dungeon-consumables.csv',collections:'dungeon-collections.csv',buffs:'dungeon-buffs.csv'};for(const [key,file] of Object.entries(files)){const res=await fetch('assets/data/'+file);if(!res.ok)throw Error(file+' の取得に失敗');masters[key]=G.parseCsv(await res.text());}G.validateMasters(masters.enemies,masters.items,masters.collections,masters.buffs);slots=profile.slots||[];carry=[];wire();render();show(profile.run?(profile.run.stage==='checkpoint'?'checkpoint':'battle'):'home');}
function show(name){for(const id of ['home','library','prepare','battle','checkpoint','analyzing','result'])$(id).hidden=id!==name;if(name==='home'||name==='library'||name==='prepare')render();}
function imageUrl(blob){const url=URL.createObjectURL(blob);urls.push(url);return url;}
function freeUrls(){for(const url of urls)URL.revokeObjectURL(url);urls=[];}
function rowUnit(unit){const hp=Math.max(0,100*unit.hp/unit.stats.hp),mp=Math.max(0,100*unit.mp/unit.maxMp);return '<p>HP '+unit.hp+'/'+unit.stats.hp+'</p><div class="meter"><div class="fill" style="width:'+hp+'%"></div></div><p>MP '+unit.mp+'/'+unit.maxMp+'</p><div class="meter"><div class="fill mp" style="width:'+mp+'%"></div></div><small>MAG '+unit.stats.mag+' / DEF '+G.armor(unit)+' / RES '+unit.stats.res+'</small>';}

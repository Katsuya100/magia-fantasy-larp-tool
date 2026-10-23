// Inventory of actual game defaults, not knobs applied only inside a test.
// Every CSV cell is an individual inspectable parameter (including 500 authored foes).
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as G from '../assets/js/dungeon-core.mjs';
import {BOSS_INK_DROP_CHANCE} from '../assets/js/dungeon-ink.mjs';
import {DESIGNED_LAYERS,BASE_RARITY_WEIGHTS} from '../assets/js/dungeon-design.mjs';

const sources={
 balance:['key','value'],levels:['level'],enemies:['id'],floors:['floor'],
 'player-base':['stat'],consumables:['id'],collections:['id'],buffs:['id'],
 'layer-concepts':['layer'], 'element-plan':['layer']
};
const read=name=>{
 const file=new URL('../assets/data/dungeon-'+name+'.csv',import.meta.url);
 return G.parseCsv(readFileSync(file,'utf8'));
};
const hardcoded=[
 ['xp.scale',G.XP_SCALE,'assets/js/dungeon-core.mjs:XP_SCALE','1 / original EXP','A,B,C,D'],
 ['progress.encountersPerLayer',5,'assets/js/dungeon-progress.mjs:FIGHTS_PER_LAYER','fights','A,B,C,D'],
 ['progress.authoredLayers',DESIGNED_LAYERS,'assets/js/dungeon-design.mjs:DESIGNED_LAYERS','layers','A,B,C,D'],
 ['ink.bossDropChance',BOSS_INK_DROP_CHANCE,'assets/js/dungeon-ink.mjs:BOSS_INK_DROP_CHANCE','probability','C,D'],
 ['ink.maxPerDraw',5,'assets/js/dungeon-ink.mjs:inkEnhancedAnalysis','ink','C'],
 ['ink.powerPerUnit',0.1,'assets/js/dungeon-ink.mjs:inkEnhancedAnalysis','fraction of initial power','C'],
 ['upgrade.initialCost',5,'assets/js/dungeon-upgrades.mjs:upgradeStoneCost','stones','A,B,C,D'],
 ['upgrade.initialCostSteps',20,'assets/js/dungeon-upgrades.mjs:upgradeStoneCost','upgrades','A,B,C,D'],
 ['upgrade.extraCostStep',40,'assets/js/dungeon-upgrades.mjs:upgradeStoneCost','upgrades','A,B,C,D'],
 ['upgrade.powerPerStep',0.1,'assets/js/dungeon-upgrades.mjs:strengthenedPower','fraction of original power','A,B,C,D'],
 ['alchemy.requiredConsumables',5,'assets/js/dungeon-alchemy.mjs:alchemyRecipe','items','C'],
 ['alchemy.requiredDuplicateCollection',2,'assets/js/dungeon-alchemy.mjs:craftAlchemy','copies','C'],
 ['alchemy.guaranteedStoneEvery',5,'assets/js/dungeon-alchemy.mjs:craftAlchemy','crafts','C'],
 ['alchemy.guaranteedInkEvery',20,'assets/js/dungeon-alchemy.mjs:craftAlchemy','crafts','C'],
 ['alchemy.byproductStone.common',.10,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','A,B,C,D'],
 ['alchemy.byproductStone.uncommon',.20,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','A,B,C,D'],
 ['alchemy.byproductStone.rare',.35,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','A,B,C,D'],
 ['alchemy.byproductStone.epic',.50,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','A,B,C,D'],
 ['alchemy.byproductStone.legendary',1,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','A,B,C,D'],
 ['alchemy.byproductInk.uncommon',.02,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','C,D'],
 ['alchemy.byproductInk.rare',.05,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','C,D'],
 ['alchemy.byproductInk.epic',.10,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','C,D'],
 ['alchemy.byproductInk.legendary',.20,'assets/js/dungeon-alchemy.mjs:BYPRODUCT_BASE','probability','C,D'],
 ['player.referenceHp',100,'tests/test-dungeon-progression-simulation.mjs:simulate','HP','A,B,C,D'],
 ['player.referenceMag',10,'tests/test-dungeon-progression-simulation.mjs:simulate','MAG','A,B,C,D'],
 ['player.referenceDef',7,'tests/test-dungeon-progression-simulation.mjs:simulate','DEF','A,B,C,D'],
 ['player.referenceRes',7,'tests/test-dungeon-progression-simulation.mjs:simulate','RES','A,B,C,D'],
 ['test.startingSpells',[[360,420,540,320,270],[220,260,300,200,160]],'tests/test-dungeon-default-balance.mjs:NORMAL/INTRO','power','A,B,C,D'],
 ['test.stoneSpendRamps',[[10,.25],[20,.75]],'tests/test-dungeon-default-balance.mjs:targetStoneRate','ratio','A,B,C,D'],
 ['test.samples',256,'tests/test-dungeon-default-balance.mjs:SAMPLES','trials','A,B,C,D'],
 ['test.introEnemyAttackChance',.01,'assets/js/dungeon-core.mjs:chooseEnemySpell','probability','A,B,C,D'],
 ['design.rarityWeights',BASE_RARITY_WEIGHTS,'assets/js/dungeon-design.mjs:BASE_RARITY_WEIGHTS','weights','A,B,C,D']
];
const numeric=v=>typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):v;
const testFor=name=>name==='enemies'||name==='floors'?'combat,journey':
 name==='balance'||name==='levels'?'combat,xp,economy,journey':
 name==='consumables'||name==='collections'?'economy,journey':'manifest,journey';

export function buildManifest(){
 const entries=[];
 for(const [source,identity] of Object.entries(sources)){
  const rows=read(source),path='assets/data/dungeon-'+source+'.csv';
  for(let i=0;i<rows.length;i++){
   const row=rows[i],key=identity.map(col=>row[col]??String(i+1)).join('/');
   for(const [field,value] of Object.entries(row)){
    if(identity.includes(field))continue;
    // The full authored dataset is inventoried, not only the balance CSV.
    const id='csv.'+source+'.'+key+'.'+field;
    entries.push({id,description:source+' '+key+' '+field,
     defaultValue:numeric(value),unit:field==='value'&&source==='balance'?'game units':'source units',
     implementationRef:path+':'+(i+2)+':'+field,allowedRange:null,
     journeys:['A','B','C','D'],relatedTests:testFor(source).split(','),
     obligation:'diagnostic',source:'csv',row:i+2,field});
   }
  }
 }
 for(const [id,value,implementationRef,unit,journeys] of hardcoded)entries.push({
  id,description:id,defaultValue:value,unit,implementationRef,allowedRange:null,
  journeys:journeys.split(','),relatedTests:['manifest','combat','journey'],
  obligation:id.startsWith('test.')?'hard-contract':'diagnostic',source:'code'
 });
 entries.sort((a,b)=>a.id.localeCompare(b.id));
 const ids=new Set(entries.map(e=>e.id));
 if(ids.size!==entries.length)throw Error('Duplicated manifest IDs');
 return {schemaVersion:'dungeon-levers-v1',sourceRef:'feat/scale-xp-45-save-migration',
  rangePolicy:'null means not approved; the manifest never invents permitted changes',
  entries};
}
const self=process.argv[1]&&fileURLToPath(process.argv[1]).href===import.meta.url;
if(self){
 const output=process.argv[2]||'reports/dungeon-balance-manifest.json';
 mkdirSync(new URL('../'+output,import.meta.url).pathname.replace(/\/[^/]+$/,''),{recursive:true});
 const manifest=buildManifest();
 writeFileSync(new URL('../'+output,import.meta.url),JSON.stringify(manifest,null,2)+'\n');
 console.log('DUNGEON_MANIFEST '+JSON.stringify({version:manifest.schemaVersion,entries:manifest.entries.length,output}));
}

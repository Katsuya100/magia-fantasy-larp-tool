// Adventurer badges are progression achievements, never collection entries.
import {clearedLayer,layerOfFight,encounterOfFight} from './dungeon-progress.mjs';
export const ADVENTURER_RANKS=Object.freeze([
 {layer:10,name:'鉛'}, {layer:20,name:'鉄'}, {layer:30,name:'鋼'},
 {layer:40,name:'銅'}, {layer:50,name:'銀'}, {layer:60,name:'金'},
 {layer:70,name:'白金'}, {layer:80,name:'ミスリル'},
 {layer:90,name:'アダマンタイト'}, {layer:100,name:'オリハルコン'}
].map(row=>Object.freeze(row)));
export function rankAt(layer){return ADVENTURER_RANKS.find(rank=>rank.layer===Number(layer))||null;}
export function highestRankLayer(profile){const layer=Number(profile?.adventurerRank)||0;return rankAt(layer)?layer:0;}
export function rankTitle(layer){const rank=rankAt(layer);return rank?rank.name+'級':'未取得';}
export function rankBadgeName(layer){const rank=rankAt(layer);return rank?rank.name+'級冒険者章':null;}
// Canonical metallic rank colors: the profile's CSS variables use these same tones.
// Canvas uses the same palette, so a badge retains its metal across screens.
export const RANK_METAL_PALETTES=Object.freeze({
 0:Object.freeze({light:'#d1c6d1',mid:'#8c7f94',deep:'#342b3b',glow:'#8c7f9430'}),
 10:Object.freeze({light:'#ddd7de',mid:'#918995',deep:'#38343f',glow:'#a59ba650'}),
 20:Object.freeze({light:'#f0edea',mid:'#929fab',deep:'#2d3744',glow:'#9cacb35c'}),
 30:Object.freeze({light:'#e7f5ff',mid:'#83abc0',deep:'#243b50',glow:'#8cbed773'}),
 40:Object.freeze({light:'#ffe0ae',mid:'#c47848',deep:'#663826',glow:'#dd854d7a'}),
 50:Object.freeze({light:'#f8ffff',mid:'#a4c4d5',deep:'#385267',glow:'#b4d9ec83'}),
 60:Object.freeze({light:'#fff1b1',mid:'#e8b64d',deep:'#5b3715',glow:'#f6c65a91'}),
 70:Object.freeze({light:'#ffffff',mid:'#d3e6f1',deep:'#53647e',glow:'#dceefca6'}),
 80:Object.freeze({light:'#d3ffff',mid:'#62dce8',deep:'#194a62',glow:'#67e8fac1'}),
 90:Object.freeze({light:'#f4e3ff',mid:'#aa8bff',deep:'#34245d',glow:'#a182f5b0'}),
 100:Object.freeze({light:'#fff2bc',mid:'#f0bf75',deep:'#6c355a',glow:'#ffbc88c7'})
});
export function rankMetalPalette(layer){return RANK_METAL_PALETTES[Number(layer)]||RANK_METAL_PALETTES[0];}
export function unlockedStartLayers(profile){
 const highest=highestRankLayer(profile);
 return [1,...ADVENTURER_RANKS.filter(rank=>rank.layer<=highest).map(rank=>rank.layer+1)];
}
export function allowedStartLayer(profile,requested){
 const selected=Number(requested);
 return unlockedStartLayers(profile).includes(selected)?selected:1;
}
// A chapter is earned while the final boss still needs a few exchanges.
// Only the first five layers' normal enemies are expected to be near one-shot.
export const RANK_EARLY_NORMAL_FIGHTS=20;
export const RANK_EARLY_FAST_WINS_REQUIRED=18;
export const RANK_FINAL_BOSS_MAX_ROUNDS=3;
export function recordRankCombat(run,fight,rounds){
 const layer=layerOfFight(fight);
 if(layer<1||layer>100||!Number.isSafeInteger(rounds)||rounds<1)return null;
 const end=Math.ceil(layer/10)*10,start=end-9,firstFight=(start-1)*5+1;
 if(fight===firstFight)run.rankCombat={end,nextFight:fight,earlyMobs:0,earlyFastWins:0,bossRounds:null};
 const record=run.rankCombat;
 if(!record||record.end!==end||record.nextFight!==fight){
  run.rankCombat=null;
  return null;
 }
 const boss=encounterOfFight(fight)===5;
 if(!boss&&layer<start+5){
  record.earlyMobs++;
  if(rounds===1)record.earlyFastWins++;
 }
 if(fight===end*5)record.bossRounds=rounds;
 record.nextFight++;
 return record;
}
// Keep the original 80% HP AND MP route, so the new turn-based route
// adds an opportunity rather than replacing an already earned opportunity.
export const RANK_LEGACY_RESERVE_PERCENT=80;
// Superior-boss rewards stay unbanked until a successful return.
export const RANK_SUPERIOR_BOSS_OFFSET_LAYERS=10;
export function rankBadgeEligible(fight,hero,record){
 const layer=clearedLayer(fight);
 if(!rankAt(layer)||!(Number(hero?.hp)>0))return false;
 const hpMax=Number(hero?.stats?.hp),mpMax=Number(hero?.maxMp);
 const legacy=hpMax>0&&mpMax>0&&
  Number(hero.hp)>=hpMax*RANK_LEGACY_RESERVE_PERCENT/100&&
  Number(hero.mp)>=mpMax*RANK_LEGACY_RESERVE_PERCENT/100;
 const mastery=record?.end===layer&&record?.nextFight===fight+1
  &&record.earlyMobs===RANK_EARLY_NORMAL_FIGHTS
  &&record.earlyFastWins>=RANK_EARLY_FAST_WINS_REQUIRED
  &&Number.isSafeInteger(record.bossRounds)&&record.bossRounds>=1
  &&record.bossRounds<=RANK_FINAL_BOSS_MAX_ROUNDS;
 return Boolean(legacy||mastery);
}
export function rankBadgeDrop(fight,hero,profile,pendingLoot=[],record){
 const layer=clearedLayer(fight);
 if(!rankAt(layer)||!(Number(hero?.hp)>0))return null;
 // Direct reserve/mastery qualifies for this rank; a stronger boss instead
 // provisionally proves the immediately preceding rank.
 const awardLayer=rankBadgeEligible(fight,hero,record)
  ?layer:layer-RANK_SUPERIOR_BOSS_OFFSET_LAYERS;
 if(!rankAt(awardLayer)||highestRankLayer(profile)>=awardLayer
  ||pendingLoot.some(item=>item.type==='rank'&&Number(item.layer)>=awardLayer))return null;
 return {type:'rank',layer:awardLayer};
}
export function pendingRankBadgeNames(loot=[],awardLayer=undefined){
 return (Array.isArray(loot)?loot:[])
  .filter(item=>item?.type==='rank'&&rankAt(item.layer)&&
   (awardLayer===undefined||Number(item.layer)===Number(awardLayer)))
  .map(item=>rankBadgeName(item.layer));
}
export function acquireAdventurerRank(profile,layer){
 const rank=rankAt(layer);
 if(!rank||highestRankLayer(profile)>=rank.layer)return false;
 profile.adventurerRank=rank.layer;
 return true;
}

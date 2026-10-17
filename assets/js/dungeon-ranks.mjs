// Adventurer badges are progression achievements, never collection entries.
import {clearedLayer} from './dungeon-progress.mjs';
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
export function unlockedStartLayers(profile){
 const highest=highestRankLayer(profile);
 return [1,...ADVENTURER_RANKS.filter(rank=>rank.layer<=highest).map(rank=>rank.layer+1)];
}
export function allowedStartLayer(profile,requested){
 const selected=Number(requested);
 return unlockedStartLayers(profile).includes(selected)?selected:1;
}
// Evaluate immediately after the lethal combat exchange, before victory MP restoration
// and before any checkpoint heal. Both HP and MP must remain at 80% or higher.
export function rankBadgeDrop(fight,hero,profile,pendingLoot=[]){
 const layer=clearedLayer(fight);
 if(!rankAt(layer)||highestRankLayer(profile)>=layer
  ||pendingLoot.some(item=>item.type==='rank'&&Number(item.layer)>=layer))return null;
 const hpMax=Number(hero?.stats?.hp),mpMax=Number(hero?.maxMp);
 if(!(hpMax>0&&mpMax>0&&Number(hero?.hp)>=hpMax*.8&&Number(hero?.mp)>=mpMax*.8))return null;
 return {type:'rank',layer};
}
export function acquireAdventurerRank(profile,layer){
 const rank=rankAt(layer);
 if(!rank||highestRankLayer(profile)>=rank.layer)return false;
 profile.adventurerRank=rank.layer;
 return true;
}

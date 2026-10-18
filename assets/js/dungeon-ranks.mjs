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

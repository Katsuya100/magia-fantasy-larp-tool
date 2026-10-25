// Reproduce the authored HP/MAG master adjustments without altering combat rules.
// This is a TEST REFERENCE for the reviewed CSV; the game reads the CSV itself.
// The input is the existing element-distribution output, including curated MAG.
const bandFactors=Object.freeze({
  11:[1.15,.35],21:[1.35,.45],31:[1.45,.35],41:[.95,.55],
  51:[1.55,.35],61:[1.30,.35],71:[1.50,.20],81:[1.10,.55],91:[1.25,.25]
});
export function depthRetunedEnemies(original){
 if(original.length!==500)throw Error('Expected full authored 500-enemy roster');
 return original.map((row,i)=>{
  const layer=Math.floor(i/5)+1;
  const band=Math.floor((layer-1)/10)*10+1;
  const factor=bandFactors[band];
  if(!factor)return {...row};
  // Preserve the exact integer-boundary outcome of the final two depth
  // refinements. These are authored CSV values, never runtime multipliers.
  const initialHp=Math.max(20,Math.round(Number(row.hp)*factor[0]));
  const finalFactor=band===31?.91:band===51?.83:1;
  return {...row,
   hp:String(Math.max(20,Math.round(initialHp*finalFactor))),
   mag:String(Math.max(1,Math.round(Number(row.mag)*factor[1])))};
 });
}

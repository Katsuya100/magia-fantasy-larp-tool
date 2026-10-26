// Reproduce the authored HP/MAG master adjustments without altering combat rules.
// This is a TEST REFERENCE for the reviewed CSV; the game reads the CSV itself.
// The input is the existing element-distribution output, including curated MAG.
const bandFactors=Object.freeze({
  11:[1.15,.35],21:[1.35,.65],31:[1.45,.50],41:[.95,.92],
  51:[1.55,.57],61:[1.30,.50],71:[1.50,.42],81:[1.20,1.40],91:[1.40,1.10]
});
const authoredMagIncreases=Object.freeze({
  "foe_l029_4": 1,
  "boss_l029": 1,
  "boss_l030": 1,
  "foe_l049_4": 1,
  "foe_l050_4": 1,
  "boss_l050": 1,
  "foe_l079_4": 2,
  "boss_l079": 2,
  "foe_l080_4": 2,
  "boss_l080": 2
});
export function depthRetunedEnemies(original){
 if(original.length!==500)throw Error('Expected full authored 500-enemy roster');
 return original.map((row,i)=>{
  const layer=Math.floor(i/5)+1;
  const band=Math.floor((layer-1)/10)*10+1;
  const factor=bandFactors[band];
  // Early F7-F10 normals move from the one-hit tutorial into a gradually
  // more threatening combat band. Only authored MAG changes; shared stats,
  // spell powers, original HP and endless-layer growth are untouched.
  const tutorialMag={7:16,8:20,9:26,10:30}[layer];
  if(!factor){
   if(tutorialMag!==undefined&&i%5!==4)
    return {...row,mag:String(tutorialMag+Number(row.mag)-7)};
   return {...row};
  }
  // Preserve the exact integer-boundary outcome of the final two depth
  // refinements. These are authored CSV values, never runtime multipliers.
  const initialHp=Math.max(20,Math.round(Number(row.hp)*factor[0]));
  const finalFactor=band===31?.91:band===51?.83:1;
  return {...row,
   hp:String(Math.max(20,Math.round(initialHp*finalFactor))),
   mag:String(Math.max(1,Math.round(Number(row.mag)*factor[1]))+(authoredMagIncreases[row.id]||0))};
 });
}

import {readFile,writeFile} from 'node:fs/promises';
import {tuneEnemyRows} from './dungeon-enemy-flavor-rules.mjs';
import {applyElementDistribution} from './dungeon-element-distribution.mjs';
const source=new URL('../tests/fixtures/dungeon-enemies-before-flavor.csv',import.meta.url);
const target=new URL('../assets/data/dungeon-enemies.csv',import.meta.url);
const raw=await readFile(source,'utf8');
const [header,...lines]=raw.trim().split(/\r?\n/);
const columns=header.split(',');
const before=lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[columns[i],v])));
const after=tuneEnemyRows(before);
const existing=await readFile(target,'utf8');
const [existingHeader,...existingLines]=existing.trim().split(/\r?\n/);
if(existingHeader!==header)throw Error('Enemy master schema mismatch');
const existingRows=new Map(existingLines.map(line=>{
 const cols=line.split(',');const row=Object.fromEntries(cols.map((value,i)=>[columns[i],value]));
 return [row.id,row];
}));
for(const row of after){
 const live=existingRows.get(row.id);if(!live)throw Error('Missing base stat '+row.id);
 for(const stat of ['hp','mag'])row[stat]=live[stat];
}
const readCsv=async(path)=>{const raw=await readFile(path,'utf8');const [heading,...lines]=raw.trim().split(/\r?\n/);const keys=heading.split(',');return lines.map(l=>Object.fromEntries(l.split(',').map((v,i)=>[keys[i],v])));};
const assignments=await readCsv(new URL('../assets/data/dungeon-element-plan.csv',import.meta.url));
const concepts=await readCsv(new URL('../assets/data/dungeon-layer-concepts.csv',import.meta.url));
const distributed=applyElementDistribution(after,assignments,concepts);
await writeFile(target,[header,...distributed.map(row=>columns.map(key=>row[key]).join(','))].join('\n')+'\n');
console.log('Updated dungeon-enemies.csv: '+after.filter((row,i)=>columns.some(k=>row[k]!==before[i][k])).length+' enemies changed');

// The fixed deck shared by paid-build diagnostics and the journey strength
// calculator. This derives only from the approved goals, shipped enemy data,
// and the existing seed-specific earned-stone ledger.
import {readFileSync} from 'node:fs';
import * as G from '../assets/js/dungeon-core.mjs';
import {simulateProgression} from './simulate-dungeon-stones.mjs';
import {upgradeSpells} from '../tests/test-dungeon-progression-simulation.mjs';
import {withNeutralAttackAttributes} from '../tests/helpers/dungeon-neutral-loadout.mjs';

const goals=JSON.parse(readFileSync(new URL('../config/dungeon-approved-goals.v1.json',import.meta.url),'utf8'));
const enemyMaster=G.parseCsv(readFileSync(new URL('../assets/data/dungeon-enemies.csv',import.meta.url),'utf8'));
const INTRO=[['attack','flame',220],['attack','bolt',260],['attack','gravity',300],
 ['support','aqua',200],['defense','law',160]];
const NORMAL=[['attack','flame',360],['attack','bolt',420],['attack','gravity',540],
 ['support','aqua',320],['defense','law',270]];
const sources=goals.bands.map(b=>withNeutralAttackAttributes(
 (b.from===1?INTRO:NORMAL).map(([role,attribute,power])=>({role,attribute,power})),
 enemyMaster,b.from,b.to).spells);
const milestoneLedger=Array.from({length:goals.strictSamples},(_,i)=>
 simulateProgression(17011+i*13+81).milestones);

export const referenceSpells=goals.bands.map((band,k)=>
 Array.from({length:goals.strictSamples},(_,i)=>{
  const prior=band.from-1;
  const stones=prior===0?0:milestoneLedger[i].find(row=>row.layer===prior)?.stones;
  if(!Number.isFinite(stones))throw Error('fixed deck must use measured original stone ledger');
  const rate=band.from<=10?.25:band.from<=20?.25+(band.from-10)*.05:.75;
  return upgradeSpells(sources[k],Math.floor(stones*rate+1e-8)).spells;
 }));

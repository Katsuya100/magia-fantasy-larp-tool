import assert from 'node:assert/strict';
import {RETURN_XP_DURATION_MS,returnXpFrame} from '../assets/js/dungeon-return-fx.mjs';
const nextXp=level=>level===1?100:200;
const before={level:1,xp:25};
assert.equal(RETURN_XP_DURATION_MS,1000);
assert.deepEqual(returnXpFrame(before,200,0,nextXp,9),{level:1,xp:25,percent:25});
assert.deepEqual(returnXpFrame(before,200,375,nextXp,9),{level:2,xp:0,percent:0});
assert.deepEqual(returnXpFrame(before,200,500,nextXp,9),{level:2,xp:25,percent:12.5});
assert.deepEqual(returnXpFrame(before,200,1000,nextXp,9),{level:2,xp:125,percent:62.5});
assert.deepEqual(returnXpFrame(before,200,1500,nextXp,9),{level:2,xp:125,percent:62.5});
assert.deepEqual(returnXpFrame(before,0,1000,nextXp,9),{level:1,xp:25,percent:25});
assert.equal(Number.isInteger(returnXpFrame(before,7,333,nextXp,9).xp),true,'animated EXP remains a whole number');
assert.throws(()=>returnXpFrame({...before,xp:0.2},7,333,nextXp,9),/整数/,
 'the FX must never hide a fractional saved gauge');
assert.throws(()=>returnXpFrame(before,7.5,333,nextXp,9),/整数/,
 'the FX must never hide a fractional pending reward');
const big=returnXpFrame(before,550,1000,nextXp,4);
assert.equal(big.level,4);
assert.equal(big.xp,75);
console.log('PASS fixed-duration return EXP and level thresholds');

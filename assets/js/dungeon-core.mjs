export const ATTRS=['flame','bolt','aqua','storm','gravity','law','chaos'];
export const ROLES=['attack','defense','support','debuff'];
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const roll=(a,b,r=Math.random)=>a+Math.floor(r()*(b-a+1));
export const capacity=level=>Math.min(15,3+Math.floor((level-1)/4));
export const nextXp=level=>Math.round(100*Math.pow(level,1.35));
export const basePower=p=>Math.round(20*Math.sqrt(Math.max(0,p)/100));
export const mpCost=p=>2+Math.ceil(basePower(p)/12);
const growth={hp:[.055,.0009],mag:[.045,.0005],def:[.035,.0004],res:[.035,.0004]};
export const startingBase=(r=Math.random)=>({hp:roll(90,110,r),mag:roll(8,12,r),def:roll(5,10,r),res:roll(5,10,r)});
export function stats(base,level){const n=level-1;return Object.fromEntries(Object.entries(growth).map(([k,[a,b]])=>[k,Math.round(base[k]*(1+a*n+b*n*n))]));}
export function makeUnit(base,level,resists={},spells=[],id='unit'){
 const s=stats(base,level);return {id,level,base,stats:s,hp:s.hp,maxMp:40+6*s.mag,mp:40+6*s.mag,spells:spells.map(x=>({...x})),cooldowns:spells.map(()=>0),statuses:[],resists:Object.fromEntries(ATTRS.map(a=>[a,Number(resists[a]??1)]))};
}
export function parseCsv(t){
 let lines=t.trim().split(/\r?\n/);let header=lines.shift().split(',');
 return lines.map(line=>{let cells=line.split(',');if(cells.length!==header.length)throw Error('CSV columns');return Object.fromEntries(header.map((k,i)=>[k,cells[i]]));});
}
export function weighted(rows,r=Math.random){let sum=rows.reduce((n,x)=>n+Number(x.weight||0),0),v=r()*sum;if(!sum)throw Error('Empty drops');for(const row of rows){v-=Number(row.weight||0);if(v<0)return row;}return rows.at(-1);}
export function dropCount(l,r=Math.random){const p=clamp(.18+.012*(l-1),.18,.82);let n=1;for(let i=0;i<6;i++)if(r()<p)n++;return n;}
export function drops(items,collections,l,r=Math.random){return Array.from({length:dropCount(l,r)},()=>{if(r()<.62){const x=weighted(items,r);return {type:'use',id:x.id,value:roll(Number(x.min_value),Number(x.max_value),r),bonus:x.bonus_buff_id&&r()<Number(x.bonus_chance)?x.bonus_buff_id:null};}return {type:'collection',id:weighted(collections,r).id};});}
export function experience(p,xp){p.xp+=xp;while(p.level<99&&p.xp>=nextXp(p.level)){p.xp-=nextXp(p.level);p.level++;}return p.level;}
export const effectivePower=(actor,spell)=>basePower(spell.power)*actor.stats.mag/10;
export const strength=(actor,spell)=>clamp(effectivePower(actor,spell)/35,.5,1.5);
export const status=(actor,id)=>actor.statuses.find(s=>s.id===id);
export function addStatus(actor,s){const old=status(actor,s.id);if(old){old.turns=Math.max(old.turns,s.turns);if(Math.abs(s.value)>Math.abs(old.value))old.value=s.value;return;}actor.statuses.push(s);}
export function resist(actor,attr){let r=actor.resists[attr]??1;const b=status(actor,'resist_'+attr);if(b)r*=1-b.value;return clamp(r,.05,2);}
export function factor(actor,effect){return clamp(actor.statuses.filter(x=>x.effect===effect).reduce((n,x)=>n*(1+x.value),1),.1,3);}
export const armor=actor=>Math.max(0,actor.stats.def+actor.statuses.filter(x=>x.effect==='def').reduce((n,x)=>n+x.value,0));
export function damage(src,tgt,spell,r=Math.random){const dizzy=status(src,'debuff_storm');if(dizzy&&r()<clamp(dizzy.value,0,.65))return 0;return Math.max(0,Math.round(effectivePower(src,spell)*resist(tgt,spell.attribute)*factor(src,'attack')*factor(src,'output')*factor(tgt,'incoming')*100/(100+armor(tgt))));}

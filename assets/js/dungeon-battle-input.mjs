// Admit one buffered command during combat FX; execute it only after the final nonfatal phase reaches 70%.
// No timer starts until the final phase.
export const LAST_PHASE_OVERLAP_RATIO=0.7;
export function canReplayBufferedBattleCommand(command,current){
 return Boolean(command&&current===command.run&&current?.stage==='battle'&&current.floor===command.floor&&current.hero.hp>0&&current.enemy.hp>0);
}
export function createBattleInputBuffer({
 setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)
}={}){
 let open=false,ready=false,pending=null,wake=null,timer=null;
 return {
  // Accept one follow-up as soon as combat FX starts, but never execute it
  // until the final nonfatal phase reaches its existing overlap window.
  start(){
   if(timer!==null){clearTimer(timer);timer=null;}
   open=true;ready=false;pending=null;wake=null;
  },
  begin(duration){
   if(timer!==null)clearTimer(timer);
   open=true;ready=duration<=0;
   const signal=new Promise(resolve=>{wake=resolve;});
   if(!ready)timer=setTimer(()=>{
    timer=null;ready=true;
    if(pending!==null)wake?.();
   },Math.ceil(duration*LAST_PHASE_OVERLAP_RATIO));
   return signal;
  },
  offer(command){
   if(!open||pending!==null)return false;
   pending=command;
   if(ready)wake?.();
   return true;
  },
  close(){
   open=false;ready=false;wake=null;
   if(timer!==null){clearTimer(timer);timer=null;}
  },
  take(){const command=pending;pending=null;return command;}
 };
}

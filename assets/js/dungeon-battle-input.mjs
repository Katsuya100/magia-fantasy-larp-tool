// Only the final combat phase admits one buffered follow-up command.
// No fixed delay runs from the start of the turn.
export const LAST_PHASE_OVERLAP_RATIO=0.7;
export function createBattleInputBuffer({
 setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)
}={}){
 let open=false,ready=false,pending=null,wake=null,timer=null;
 return {
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

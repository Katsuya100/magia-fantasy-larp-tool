// Accept one follow-up battle command after 250ms without shortening playback.
// The command runs only after the current serialized battle operation finishes.
export const BATTLE_INPUT_LEAD_MS=250;
export function createBattleInputBuffer(now=()=>Date.now()){
 let acceptAt=null,pending=null;
 return {
  start(){acceptAt=now()+BATTLE_INPUT_LEAD_MS;},
  stop(){acceptAt=null;},
  offer(command){
   if(acceptAt===null||now()<acceptAt||pending!==null)return false;
   pending=command;
   return true;
  },
  take(){const command=pending;pending=null;return command;}
 };
}

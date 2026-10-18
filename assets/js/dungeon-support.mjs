// Show optional support only after a newly confirmed ten-layer milestone or rank.
export function supportPromptForReturn(previousDepth,returnedDepth,newRankLayer=0){
 const rank=Number(newRankLayer);
 if(Number.isInteger(rank)&&rank>0){
  return {title:'新しい冒険者章を獲得！',message:(rank+1)+'層から探索できるようになりました。'};
 }
 const previous=Math.floor(Math.max(0,Number(previousDepth)||0)/10);
 const current=Math.floor(Math.max(0,Number(returnedDepth)||0)/10);
 if(current>previous){
  return {title:(current*10)+'層の踏破記録を更新！',message:'新しい探索の節目に到達しました。'};
 }
 return null;
}

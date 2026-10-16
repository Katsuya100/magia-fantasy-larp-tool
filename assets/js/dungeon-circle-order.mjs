// Keep saved circle IDs stable: only the display order is affected.
// Older records predate registration timestamps, so preserve their relative order.
export function newestCirclesFirst(circles){
 return [...circles].sort((a,b)=>(Number(b.registeredAt)||0)-(Number(a.registeredAt)||0));
}
export function nextCircleRegistration(circles,now=Date.now()){
 const latest=circles.reduce((max,c)=>Math.max(max,Number(c.registeredAt)||0),0);
 return Math.max(now,latest+1);
}

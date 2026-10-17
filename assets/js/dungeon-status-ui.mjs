// Compact combat status icons; accessible labels retain details and duration.
import {ATTRIBUTES} from './dungeon-magic-knowledge.mjs';
const ATTRIBUTE_NAMES={flame:'炎',bolt:'雷',aqua:'水',storm:'風',gravity:'重力',law:'秩序',chaos:'混沌'};
export function statusBadges(statuses,buffs=[],escapeText=x=>String(x)){
 return (statuses||[]).map(status=>{
  const attr=String(status.attribute||status.id?.split('_').at(-1)||'');
  const glyph=ATTRIBUTES[attr]?.icon||'✦';
  const resist=String(status.id||'').startsWith('resist_');
  const debuff=status.kind==='debuff'||String(status.id||'').startsWith('debuff_');
  const kind=debuff?'弱体':'強化';
  const row=buffs.find(x=>x.id===status.id);
  const name=resist?(ATTRIBUTE_NAMES[attr]||attr)+'耐性上昇':row?.name||status.id||kind;
  const remaining=Number(status.turns);
  const turns=Number.isFinite(remaining)?Math.max(0,Math.floor(remaining)):0;
  const detail=String(name)+'・'+kind+'・残り'+turns+'ターン';
  return '<span class="status-badge status-'+(debuff?'debuff':'buff')+(resist?' status-resist':'')+'" role="img" title="'+escapeText(detail)+'" aria-label="'+escapeText(detail)+'">'
   +'<span class="status-glyph" aria-hidden="true">'+(resist?'🛡️':'')+glyph+'</span>'
   +'<span class="status-arrow" aria-hidden="true">'+(debuff?'↓':'↑')+'</span>'
   +'<small class="status-turns" aria-hidden="true">'+turns+'</small></span>';
 }).join('');
}

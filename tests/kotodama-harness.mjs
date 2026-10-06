import { readFile } from 'node:fs/promises';

const plain=html=>String(html).replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export function createKotodamaDom(){
  const elements=new Map();
  function node(tag='div'){
    let text='',html='';
    const classes=new Set();
    return {
      tagName:tag.toUpperCase(),style:{},value:'',disabled:false,children:[],handlers:{},
      classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),
        contains:value=>classes.has(value),toggle(value,force){
          if(force ?? !classes.has(value)) classes.add(value); else classes.delete(value);
        }},
      get textContent(){return text+this.children.map(child=>child.textContent).join('');},
      set textContent(value){text=String(value);html='';this.children=[];},
      get innerHTML(){return html;},
      set innerHTML(value){html=String(value);text=plain(html);this.children=[];},
      insertAdjacentHTML(position,value){html+=String(value);text=plain(html);},
      append(...children){this.children.push(...children);},
      replaceChildren(...children){text='';html='';this.children=children;},
      querySelectorAll(){return [];},addEventListener(type,handler){this.handlers[type]=handler;},focus(){},
    };
  }
  const get=id=>{if(!elements.has(id)) elements.set(id,node());return elements.get(id);};
  get('spell').value='fire + heat - reporting';
  get('target').value='flame';
  return {get,document:{body:node('body'),getElementById:get,querySelectorAll:()=>[],createElement:node}};
}

export async function repositoryFetch(url){
  return new Response(await readFile(new URL(url)));
}

export const renderedSnapshot=dom=>Object.fromEntries(
  ['sigil','rawMana','affinity','power','err'].map(id=>[id,dom.get(id).textContent])
);

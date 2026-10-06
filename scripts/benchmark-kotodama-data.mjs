import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadKotodamaData, loadKotodamaCandidates } from '../assets/js/kotodama-data.js';

// Compare in separate Node processes. Local file fetch and cache payload accounting
// are references, never claims about a phone, HTTP latency or browser overhead.
const mode=process.argv[2];
if(!mode){
  const report={method:'Separate Node processes; local files; streaming cache payload counter; GC snapshots',results:[]};
  for(const selection of ['candidate','input']){
    const child=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),selection],{encoding:'utf8',maxBuffer:2*1024*1024});
    if(child.error) throw child.error;
    if(child.status!==0) throw new Error(child.stderr || child.stdout);
    report.results.push(JSON.parse(child.stdout));
  }
  await mkdir(new URL('../test-results/input-restoration/',import.meta.url),{recursive:true});
  await writeFile(new URL('../test-results/input-restoration/kotodama-comparison.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}else{
  if(!['candidate','input'].includes(mode)) throw new Error('Use candidate or input');
  let networkBytes=0;
  const sizes=new Map(); const manifests=new Map();
  const cache={
    async match(url){
      if(!sizes.has(url)) return undefined;
      return new Response(manifests.has(url)?manifests.get(url):await readFile(new URL(url)));
    },
    async put(url,response){
      let length=0;
      if(new URL(url).pathname.endsWith('.meta.json')){
        const value=await response.text(); length=new TextEncoder().encode(value).byteLength; manifests.set(url,value);
      }else{for await(const chunk of response.body) length+=chunk.byteLength;}
      sizes.set(url,length);
    },
    async delete(url){return sizes.delete(url);},
  };
  const storage={async open(){return cache;}};
  const fetchFn=async url=>{const bytes=await readFile(new URL(url));networkBytes+=bytes.length;return new Response(bytes);};
  const loader=mode==='candidate'?loadKotodamaCandidates:loadKotodamaData;
  const rounds=[];
  for(const temperature of ['cold','warm']){
    globalThis.gc?.(); const before=process.memoryUsage(); const peak={...before};
    const sample=()=>{for(const [key,value] of Object.entries(process.memoryUsage()))peak[key]=Math.max(peak[key],value);};
    const timer=setInterval(sample,10); networkBytes=0; const start=performance.now();
    let data=await loader({storage,fetchFn}); sample();
    const initializationMs=performance.now()-start;
    globalThis.gc?.(); const after=process.memoryUsage();
    const cacheBytes=[...sizes.values()].reduce((sum,value)=>sum+value,0);
    const initialPayloadBytes=networkBytes;
    let rareSpell=null;
    if(mode==='input'){
      networkBytes=0; const prepareStart=performance.now();
      await data.inputVectors.prepareWords(['quasar','anemometer']); sample();globalThis.gc?.();
      rareSpell={words:['quasar','anemometer'],extraPayloadBytes:networkBytes,cacheBytes:[...sizes.values()].reduce((sum,value)=>sum+value,0),
        preparationMs:Math.round((performance.now()-prepareStart)*100)/100,preparedVectorBytes:[...data.inputVectors.prepared.values()].reduce((sum,value)=>sum+value.byteLength,0),memoryAfter:process.memoryUsage()};
    }
    clearInterval(timer);
    rounds.push({temperature,initialPayloadBytes,cacheBytes,initializationMs:Math.round(initializationMs*100)/100,
      inputWordCount:data.inputVectors?.size??data.candidateVectors.size,candidateWordCount:data.candidateWords.length,
      candidateVectorBytes:data.candidateVectors.data.byteLength,before,observedPeak:peak,after,rareSpell});
    data=null;
  }
  console.log(JSON.stringify({mode,node:process.version,platform:process.platform,measuredOn:new Date().toISOString(),
    limitations:'Cache body payload only, no browser metadata overhead; streamed accounting, local file reads; Node heap/RSS and 10ms samples are not mobile measurements.',rounds}));
}

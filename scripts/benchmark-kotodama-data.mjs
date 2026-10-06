import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { loadKotodamaData } from '../assets/js/kotodama-data.js';

// Measure the shared loader using local files. No downloads, invented mobile timing,
// or peak-memory claims beyond the observed Node process samples.
globalThis.gc?.();
const before=process.memoryUsage();
const peak={...before};
const sample=()=>{
  for(const [key,value] of Object.entries(process.memoryUsage())) peak[key]=Math.max(peak[key],value);
};
const timer=setInterval(sample,10);
let payloadBytes=0;
const start=performance.now();
let data;
try {
  data=await loadKotodamaData({storage:null,fetchFn:async url=>{
    const bytes=await readFile(new URL(url));
    payloadBytes+=bytes.byteLength; sample();
    return new Response(bytes);
  }});
} finally { sample(); clearInterval(timer); }
const elapsedMs=performance.now()-start;
const report={
  measuredOn:new Date().toISOString(),node:process.version,platform:process.platform,
  method:'Local-file fetch adapter; shared loader with SHA-256 validation; no browser CacheStorage; 10ms Node memory samples',
  wordCount:data.vectors.size,candidateCount:data.candidateWords.length,dimension:data.vectors.dim,
  dictionaryPayloadBytes:payloadBytes,vectorAllocationBytes:data.vectors.data.byteLength,
  initializationMs:Math.round(elapsedMs*100)/100,
  memory:{before,observedPeak:peak,after:process.memoryUsage()},
  limitations:'Not a mobile/browser measurement; RSS includes Node, temporary fetch buffers and GC; samples may miss instantaneous peaks.',
};
await mkdir(new URL('../test-results/review/',import.meta.url),{recursive:true});
await writeFile(new URL('../test-results/review/kotodama-loader.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

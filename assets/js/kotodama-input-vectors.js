export function inputBucket(word,bucketCount=64) {
  let hash=2166136261;
  for(let i=0;i<word.length;i++) hash=Math.imul(hash^word.charCodeAt(i),16777619);
  return (hash>>>0)%bucketCount;
}

export class InputVectorStore {
  constructor({candidateVectors,index,metadata,loadChunk}) {
    if(metadata?.formatVersion!==1 || metadata.encoding!=='float32-le' || metadata.dimension!==50 ||
      !Number.isSafeInteger(metadata.bucketCount) || metadata.bucketCount<1 ||
      !Array.isArray(index) || index.length!==metadata.bucketCount ||
      !Array.isArray(metadata.buckets) || metadata.buckets.length!==index.length ||
      candidateVectors.dim!==metadata.dimension || typeof loadChunk!=='function') throw new Error('入力用外典の目録が乱れている。');
    this.candidateVectors=candidateVectors; this.metadata=metadata; this.loadChunk=loadChunk;
    this.dim=metadata.dimension; this.index=new Map(); this.prepared=new Map();
    index.forEach((words,bucket)=>{
      if(!Array.isArray(words) || words.length!==metadata.buckets[bucket].wordCount ||
        metadata.buckets[bucket].bytes!==words.length*this.dim*4) throw new Error('入力用外典の頁と語数が噛み合わない。');
      words.forEach((word,row)=>{
        if(typeof word!=='string' || !word || word!==word.toLowerCase() || /\s/.test(word) ||
          inputBucket(word,index.length)!==bucket || this.index.has(word) || candidateVectors.has(word)) throw new Error('入力用外典に重複や読めない言霊がある。');
        // One integer per word avoids hundreds of thousands of [bucket,row] allocations.
        this.index.set(word,row*metadata.bucketCount+bucket);
      });
    });
    if(this.index.size!==metadata.supplementalWordCount || this.index.size+candidateVectors.size!==metadata.totalWordCount) throw new Error('入力用外典の総語数が異なる。');
  }
  get size(){return this.metadata.totalWordCount;}
  has(word){return this.candidateVectors.has(word)||this.index.has(word);}
  get(word){return this.candidateVectors.get(word)||this.prepared.get(word);}
  async prepareWords(words) {
    const unique=[...new Set(words)];
    const missing=unique.filter(word=>!this.has(word));
    if(missing.length) throw new Error(`外典に名のない言霊: ${missing.join(', ')}`);
    const next=new Map(); const needed=new Map();
    for(const word of unique) {
      if(this.candidateVectors.has(word)) continue;
      if(this.prepared.has(word)){next.set(word,this.prepared.get(word));continue;}
      const offset=this.index.get(word);
      const bucket=offset%this.metadata.bucketCount;
      const row=Math.floor(offset/this.metadata.bucketCount);
      if(!needed.has(bucket)) needed.set(bucket,[]);
      needed.get(bucket).push([word,row]);
    }
    // Load one small bucket at a time and copy only spell rows; retain no chunk buffer.
    for(const [bucket,requests] of needed) {
      const entry=this.metadata.buckets[bucket];
      const buffer=await this.loadChunk(entry);
      if(!(buffer instanceof ArrayBuffer) || buffer.byteLength!==entry.bytes) throw new Error('入力用外典の頁が途中でほどけた。');
      const view=new DataView(buffer);
      for(const [word,row] of requests) {
        const vector=new Float32Array(this.dim);
        for(let column=0;column<this.dim;column++) {
          const value=view.getFloat32((row*this.dim+column)*4,true);
          if(!Number.isFinite(value)) throw new Error('入力用外典に読めない数がある。');
          vector[column]=value;
        }
        next.set(word,vector);
      }
    }
    this.prepared=next;
  }
}

export class VectorStore {
  // Adopt the packed dictionary buffer; avoid a second vector allocation on mobile.
  static fromPacked(words, buffer, dimension){
    if(!Number.isInteger(dimension) || dimension < 1 || !Array.isArray(words) ||
      buffer.byteLength !== words.length * dimension * Float32Array.BYTES_PER_ELEMENT){
      throw new Error('外典の頁と次元が噛み合わない。');
    }
    const store = new VectorStore();
    store.dim = dimension;
    store.capacity = words.length;
    store.words = words;
    store.index = new Map(words.map((word,index) => [word,index]));
    if(store.index.size !== words.length || words.some(word => typeof word !== 'string' || !/^[a-z]+$/.test(word))){
      throw new Error('外典の言霊目録が乱れている。');
    }
    const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
    store.data = new Float32Array(buffer);
    if(!littleEndian){
      const view = new DataView(buffer);
      store.data = Float32Array.from({length:words.length * dimension}, (_,i) => view.getFloat32(i * 4, true));
    }
    if(store.data.some(value => !Number.isFinite(value))) throw new Error('外典に読めない数が刻まれている。');
    return store;
  }
  constructor(initialDim=0, initialCapacity=4096){
    this.dim = initialDim || 0;
    this.words = [];
    this.index = new Map();
    this.capacity = Math.max(1024, initialCapacity);
    this.data = this.dim ? new Float32Array(this.capacity * this.dim) : null;
  }
  get size(){ return this.words.length; }
  _ensureDim(d){
    if(!this.dim){
      this.dim = d;
      this.data = new Float32Array(this.capacity * this.dim);
    }
  }
  _grow(){
    const nextCap = Math.ceil(this.capacity * 1.65);
    const next = new Float32Array(nextCap * this.dim);
    if(this.data) next.set(this.data.subarray(0, this.words.length * this.dim));
    this.capacity = nextCap;
    this.data = next;
  }
  set(word, vec){
    if(!word || !vec || !vec.length) return this;
    this._ensureDim(vec.length);
    if(vec.length !== this.dim) return this;
    let i = this.index.get(word);
    if(i == null){
      if(this.words.length >= this.capacity) this._grow();
      i = this.words.length;
      this.words.push(word);
      this.index.set(word, i);
    }
    this.data.set(vec, i * this.dim);
    return this;
  }
  get(word){
    const i = this.index.get(word);
    if(i == null || !this.data) return undefined;
    return this.data.subarray(i * this.dim, (i + 1) * this.dim);
  }
  has(word){ return this.index.has(word); }
  keys(){ return this.words.values(); }
  clear(){
    this.words = [];
    this.index = new Map();
    this.data = this.dim ? new Float32Array(this.capacity * this.dim) : null;
  }
  *[Symbol.iterator](){
    for(let i=0;i<this.words.length;i++){
      yield [this.words[i], this.data.subarray(i * this.dim, (i + 1) * this.dim)];
    }
  }
}

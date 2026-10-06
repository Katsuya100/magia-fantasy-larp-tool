/* Incremental SHA-256: retain only one 64-byte block, never a model-sized hash copy. */
(function exposeStreamingSha256(global) {
  'use strict';
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
  function create() {
    const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const block = new Uint8Array(64);
    const schedule = new Uint32Array(64);
    let filled = 0, bytes = 0, finished = false;
    function compress(data, offset) {
      for (let i = 0; i < 16; i += 1) {
        const p = offset + i * 4;
        schedule[i] = (data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3];
      }
      for (let i = 16; i < 64; i += 1) {
        const x = schedule[i - 15], y = schedule[i - 2];
        schedule[i] = schedule[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + schedule[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
      }
      let a=state[0], b=state[1], c=state[2], d=state[3], e=state[4], f=state[5], g=state[6], h=state[7];
      for (let i = 0; i < 64; i += 1) {
        const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + schedule[i]) >>> 0;
        const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      state[0]+=a; state[1]+=b; state[2]+=c; state[3]+=d; state[4]+=e; state[5]+=f; state[6]+=g; state[7]+=h;
    }
    return {
      update(data) {
        if (finished) throw new Error('SHA-256 digest is already finalized.');
        bytes += data.byteLength;
        let offset = 0;
        if (filled) {
          const count = Math.min(64 - filled, data.byteLength);
          block.set(data.subarray(0, count), filled); filled += count; offset += count;
          if (filled === 64) { compress(block, 0); filled = 0; }
        }
        while (offset + 64 <= data.byteLength) { compress(data, offset); offset += 64; }
        if (offset < data.byteLength) { block.set(data.subarray(offset), 0); filled = data.byteLength - offset; }
      },
      digestHex() {
        if (finished) throw new Error('SHA-256 digest is already finalized.');
        finished = true;
        block[filled++] = 0x80;
        if (filled > 56) { block.fill(0, filled); compress(block, 0); filled = 0; }
        block.fill(0, filled, 56);
        const view = new DataView(block.buffer);
        view.setUint32(56, Math.floor(bytes / 0x20000000), false);
        view.setUint32(60, (bytes * 8) >>> 0, false);
        compress(block, 0);
        return Array.from(state, value => value.toString(16).padStart(8, '0')).join('');
      },
    };
  }
  global.StreamingSha256 = Object.freeze({ create });
}(globalThis));

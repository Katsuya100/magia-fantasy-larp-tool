import { cp, mkdir, rm, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root,'dist');
// Verify the exact workspace target before recursively replacing generated files.
if(relative(root,output) !== 'dist' || !output.startsWith(resolve(root) + sep)) throw new Error('Unsafe build directory');
const current = await lstat(output).catch(error => { if(error.code !== 'ENOENT') throw error; });
if(current?.isSymbolicLink()) throw new Error('dist must not be a symbolic link');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const name of ['index.html','kotodama.html','magia-circle.html','assets','LICENSE','THIRD_PARTY_NOTICES.md']){
  await cp(resolve(root,name),resolve(output,name),{recursive:true});
}
console.log(`Static site built: ${output}`);

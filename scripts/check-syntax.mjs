import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function checkDirectory(directory){
  for(const entry of await readdir(directory, {withFileTypes:true})){
    const path = resolve(directory, entry.name);
    if(entry.isDirectory()) await checkDirectory(path);
    else if(/\.(m?js)$/.test(entry.name)){
      const result = spawnSync(process.execPath, ['--check',path], {stdio:'inherit'});
      if(result.error) throw result.error;
      if(result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for(const directory of ['assets/js','scripts','tests']) await checkDirectory(resolve(root,directory));
for(const name of ['index.html','kotodama.html','magia-circle.html']){
  const html = await readFile(resolve(root,name),'utf8');
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
    const type = /type\s*=\s*["']module["']/.test(match[1]) ? 'module' : 'commonjs';
    const result = spawnSync(process.execPath, ['--check',`--input-type=${type}`], {input:match[2],stdio:['pipe','inherit','inherit']});
    if(result.error) throw result.error;
    if(result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('PASS JavaScript syntax (app, Workers, scripts, tests, inline HTML scripts)');

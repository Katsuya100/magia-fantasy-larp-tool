import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const read=async path=>readFile(new URL(path,root),'utf8');
const home=await read('index.html');
const privacy=await read('privacy.html');
const terms=await read('terms.html');
const styles=await read('assets/css/legal.css');
const build=await read('scripts/build-static.mjs');
const syntax=await read('scripts/check-syntax.mjs');

assert.ok(home.indexOf('class="site-links"')>0,'Top legal navigation must exist');
assert.ok(home.indexOf('class="site-links"')<home.indexOf('class="hero"'),'Legal navigation must be above the hero');
assert.ok(home.indexOf('class="site-links"')<home.indexOf('class="choices"'),'Legal navigation must not be inside the course cards');
assert.match(home,/<nav class="site-links"[^>]*>[\s\S]*?<a href="privacy\.html">プライバシーポリシー<\/a>[\s\S]*?<a href="terms\.html">利用規約<\/a>[\s\S]*?<\/nav>/);
assert.match(home,/\.site-links\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,'Legal links must stay side by side');
assert.match(home,/\.site-links a\{[^}]*min-height:56px/,'Legal links must be comfortably tappable');
assert.match(home,/\.site-links a\{[^}]*font:650 16px/,'Legal text must be legible');
assert.match(home,/@media\(max-width:480px\)\{\.site-links\{[^}]*\}\.site-links a\{[^}]*min-height:58px/,'Mobile links must remain comfortably tappable');
assert.equal([...home.matchAll(/class="choice(?: circle)?"/g)].length,3,'Keep the original three course cards');

for(const [file,html] of [['privacy.html',privacy],['terms.html',terms]]){
 assert.match(html,/<html lang="ja">/,file+' must declare Japanese');
 assert.match(html,/<meta name="viewport"/,file+' must be mobile friendly');
 assert.match(html,/href="assets\/css\/legal\.css"/,file+' must use legal stylesheet');
 assert.match(html,/href="index\.html"/,file+' must provide a route home');
 assert.match(html,/2026年10月19日/,file+' must show the publication date');
 assert.ok(build.includes("'"+file+"'"),file+' must be copied to the published build');
 assert.ok(syntax.includes("'"+file+"'"),file+' must be part of HTML syntax checks');
}
assert.match(styles,/\.legal-nav a\{[^}]*min-height:48px/);
assert.match(privacy,/https:\/\/www\.googleapis\.com\/auth\/drive\.appdata/);
assert.match(privacy,/appDataFolder/);
assert.match(privacy,/Cookie/);
assert.match(privacy,/Google Driveに作成したバックアップは、端末内のデータを削除しても自動では削除されません/);
assert.match(privacy,/GitHubのIssue/);
assert.match(terms,/href="privacy\.html"/);
assert.match(terms,/複数の端末・ブラウザで同時に遊ぶと/);
console.log('PASS public legal pages, accessible site navigation, and static distribution');

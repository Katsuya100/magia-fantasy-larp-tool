import '@gutenye/ocr-node';
import { Detection } from '../node_modules/@gutenye/ocr-common/build/models/Detection.js';
import { Recognition } from '../node_modules/@gutenye/ocr-common/build/models/Recognition.js';
import { ImageRaw } from '../node_modules/@gutenye/ocr-node/build/ImageRaw.js';
import sharp from 'sharp';

const input = process.argv[2];
const detection = await Detection.create({});
const recognition = await Recognition.create({});
const detected = await detection.run(input);
const rawCandidates = [];
for (const [index, line] of detected.lineImages.entries()) {
  const center = line.box.reduce((sum, point) => ({ x: sum.x + point[0] / line.box.length, y: sum.y + point[1] / line.box.length }), { x: 0, y: 0 });
  const sourceAngle = (Math.atan2(center.y - detected.resizedImageHeight / 2, center.x - detected.resizedImageWidth / 2) + Math.PI * 2) % (Math.PI * 2);
  const options = [];
  for (const angle of [0, 90, 180, 270]) {
    const raw = await sharp(Buffer.from(line.image.data), { raw: { width: line.image.width, height: line.image.height, channels: 4 } }).rotate(angle).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const image = new ImageRaw({ data: raw.data, width: raw.info.width, height: raw.info.height });
    for (const row of await recognition.run([{ box: line.box, image }])) {
      const text = String(row.text || '').replace(/[^A-Za-z]/g, '').toLowerCase();
      if (!text || row.mean < .5 || (text.length === 1 && !/^[ab]$/.test(text))) continue;
      options.push({ text, confidence: row.mean, angle });
    }
  }
  options.sort((a, b) => b.text.length - a.text.length || b.confidence - a.confidence);
  if (options[0]) rawCandidates.push({ line: index + 1, sourceAngle, ...options[0] });
}

function distance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) { let diagonal = previous[0]; previous[0] = i; for (let j = 1; j <= b.length; j += 1) { const saved = previous[j]; previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)); diagonal = saved; } }
  return previous[b.length];
}
const roleWords = {
  action: ['awaken','bind','blaze','break','burn','call','command','create','crush','cut','defend','destroy','draw','drive','enforce','establish','fall','flow','freeze','guard','heal','ignite','judge','keep','open','protect','pull','push','raise','release','restore','seal','send','shield','shatter','silence','strike','summon','surround','tear','turn','twist','unleash','wash'],
  determiner: ['a','an','the'],
  subject: ['ally','enemy','foe','target','spirit','shadow','beast','creature','heart','king','queen','world','stone','gate','flame','fire'],
  preposition: ['against','around','before','beneath','beyond','between','by','from','into','over','through','under','upon','within'],
  adjective: ['ancient','arcane','black','blue','boundless','bright','cold','crimson','dark','endless','eternal','fierce','golden','hidden','hollow','iron','pale','red','silent','silver','stormy','swift','wild'],
  noun: ['ash','beast','blood','crown','darkness','dawn','dust','ember','enemy','fire','flame','frost','heart','light','moon','night','rain','river','shadow','sky','spirit','star','storm','stone','sun','thunder','void','wind','world']
};
function bestFor(raw, role) { const choices = roleWords[role]; return choices.map(word => ({ word, score: 1 - distance(raw, word) / Math.max(raw.length, word.length) })).sort((a, b) => b.score - a.score)[0]; }
function restore(words) {
  const roles = ['action','determiner','subject','preposition','determiner','adjective','adjective','noun'];
  if (words.length !== roles.length) return null;
  const corrected = words.map((word, index) => bestFor(word, roles[index]));
  if (corrected.some(item => item.score < .35)) return null;
  return { text: `${corrected.map(item => item.word).join(' ')}.`, corrected };
}
const ordered = rawCandidates.sort((a, b) => a.sourceAngle - b.sourceAngle);
let largestGap = -1, cut = 0;
for (let i = 0; i < ordered.length; i += 1) { const gap = (i === ordered.length - 1 ? ordered[0].sourceAngle + Math.PI * 2 : ordered[i + 1].sourceAngle) - ordered[i].sourceAngle; if (gap > largestGap) { largestGap = gap; cut = (i + 1) % ordered.length; } }
const clockwise = ordered.slice(cut).concat(ordered.slice(0, cut));
let angleOffset = 0;
const unwrapped = clockwise.map((candidate, index) => {
  if (index && candidate.sourceAngle < clockwise[index - 1].sourceAngle) angleOffset += Math.PI * 2;
  return { ...candidate, theta: candidate.sourceAngle + angleOffset };
});
const words = [];
for (const candidate of unwrapped) { const previous = words.at(-1); if (previous && candidate.theta - previous.lastAngle < .30) { previous.raw += candidate.text; previous.lastAngle = candidate.theta; } else words.push({ raw: candidate.text, lastAngle: candidate.theta }); }
const restored = restore(words.map(word => word.raw));
console.log(JSON.stringify({ rawCandidates, sequence: words.map(word => word.raw), restored, assertion: restored?.text === 'burn the enemy beneath an endless crimson flame.' ? 'PASS' : 'FAIL' }, null, 2));

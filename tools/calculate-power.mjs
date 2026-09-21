import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, '../power-calculation.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'power-calculation.js' });
const { calculatePower } = context.PowerCalculationCore;

function parseArguments(argumentsList) {
  if (argumentsList.length === 1 && argumentsList[0].trim().startsWith('{')) return JSON.parse(argumentsList[0]);
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (index + 1 >= argumentsList.length) throw new Error(`Missing value for ${argument}`);
    options[key] = argumentsList[++index];
  }
  return options;
}

try {
  const input = parseArguments(process.argv.slice(2));
  const result = calculatePower(input);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`威力計算に失敗しました: ${error.message}`);
  console.error('Usage: npm run calculate-power -- --circle-accuracy 0.9 --line-straightness 0.8 --attribute-certainty 0.7 --sigil-certainty 0.85 --word-count 5');
  console.error('   or: npm run calculate-power -- "{\"circleAccuracy\":0.9,\"lineStraightness\":0.8,\"attributeCertainty\":0.7,\"sigilCertainty\":0.85,\"wordCount\":5}"');
  process.exitCode = 1;
}

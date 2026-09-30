import { runSeason, runCareer } from '../tests/regression/season';
const read = (name: string, fallback: string) => process.argv.find(arg => arg.startsWith('--' + name + '='))?.split('=')[1] ?? fallback;
const count = (name: string, fallback: number, maximum: number) => {
  const value = Number(read(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new RangeError(name + ' must be between 1 and ' + maximum);
  return value;
};
const seasons = count('seasons', 1, 10), seed = count('seed', 12091, 2147483647);
const mode = read('mode', 'career');
if (!['career', 'world'].includes(mode)) throw new Error('mode must be career or world');
const main = async () => {
  const results = mode === 'world'
    ? Array.from({ length: seasons }, (_, index) => runSeason(seed + index))
    : await runCareer(seasons, seed, read('teamId', 'T1'));
  console.log(JSON.stringify(results, null, 2));
};
main().catch(error => { console.error(error); process.exitCode = 1; });

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
const slow = args.includes('--slow');
const result = spawnSync(process.execPath, [
  '--require', './scripts/mock-env.js', '--import', 'tsx', '--test', '--test-concurrency=1',
  ...args.filter(arg => arg !== '--slow'),
  slow ? 'tests/slow.test.ts' : 'tests/fast.test.ts',
], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

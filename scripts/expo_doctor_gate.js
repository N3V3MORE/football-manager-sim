const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = process.cwd();
const doctorBin = path.join(projectRoot, 'node_modules', 'expo-doctor', 'bin', 'expo-doctor.js');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const knownBrokenChecks = new Set([
  'Check for legacy global CLI installed locally',
  'Check that native modules do not use incompatible support packages',
]);

const legacyPackages = new Set([
  '@unimodules/core',
  '@unimodules/react-native-adapter',
  'eas-cli',
  'expo-cli',
  'react-native-unimodules',
]);

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: projectRoot,
  encoding: 'utf8',
  env: process.env,
  shell: options.shell || false,
});

const doctor = run(process.execPath, [doctorBin]);
if (doctor.error) {
  console.error(`Failed to run Expo Doctor: ${doctor.error.message}`);
  process.exit(1);
}
const output = `${doctor.stdout || ''}${doctor.stderr || ''}`;
process.stdout.write(output);

const plainOutput = output.replace(/\u001b\[[0-9;]*m/g, '');
if (doctor.status === 0) {
  const completion = plainOutput.match(/(\d+)\/(\d+) checks passed\. No issues detected!/);
  if (completion && Number(completion[1]) > 0 && completion[1] === completion[2]) process.exit(0);
  console.error('Expo Doctor did not complete all release checks successfully.');
  process.exit(1);
}

const checkNames = [...plainOutput.matchAll(/Unexpected error while running '([^']+)' check:/g)]
  .map(match => match[1]);
const explainPackages = [...plainOutput.matchAll(/Failed to find dependency tree for ([^:]+): npm explain/g)]
  .map(match => match[1]);

const failedChecks = plainOutput.match(/(\d+) checks? failed, indicating possible issues with the project\./);
const onlyKnownDoctorBug = (
  failedChecks && Number(failedChecks[1]) === checkNames.length &&
  checkNames.length > 0 &&
  checkNames.every(checkName => knownBrokenChecks.has(checkName)) &&
  explainPackages.length > 0 &&
  explainPackages.every(packageName => legacyPackages.has(packageName)) &&
  !plainOutput.includes('\n\u2716 ')
);

const packageIsAbsent = (packageName) => {
  const result = run(npmBin, ['explain', packageName, '--json'], { shell: process.platform === 'win32' });
  const explainOutput = `${result.stdout || ''}${result.stderr || ''}`;
  return result.status !== 0 && explainOutput.includes(`No dependencies found matching ${packageName}`);
};

if (onlyKnownDoctorBug && explainPackages.every(packageIsAbsent)) {
  console.warn(
    `Expo Doctor hit a known npm-explain failure for absent legacy packages: ${explainPackages.join(', ')}.`
  );
  console.warn('The packages are not installed, so the release gate is continuing.');
  process.exit(0);
}

process.exit(doctor.status || 1);

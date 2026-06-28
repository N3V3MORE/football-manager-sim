import { existsSync } from 'fs';
import { join } from 'path';

import { assert, readSource } from './shared';

export const checkInboxHelpersUseConcreteModules = () => {
  const checkedFiles = [
    'scripts/ci_regression.ts',
    'src/store/careerActions.ts',
    'src/store/fixtureResolution.ts',
    'src/store/gameStore.ts',
    'src/store/inboxActions.ts',
    'src/store/persistence.ts',
    'src/store/seasonRollover.ts',
    'src/store/weekLifecycle.ts',
    'src/store/weeklyAccounting.ts',
  ];

  const inboxCoreSource = readSource('src/store/inboxCore.ts');
  assert(inboxCoreSource.includes('export const buildLegacyInboxMessages'), 'inboxCore should own legacy system messages');
  assert(inboxCoreSource.includes('export const generateSystemInboxMessages'), 'inboxCore should own generated system messages');
  assert(inboxCoreSource.includes('export const generateTeamSwitchMessage'), 'inboxCore should own team-switch system messages');

  checkedFiles.forEach(filePath => {
    const source = readSource(filePath);
    assert(!source.includes('inboxHelpers'), `${filePath} should import inbox helpers from concrete modules`);
    assert(!source.includes('inboxSystem'), `${filePath} should not import from deleted inboxSystem`);
  });

  assert(!existsSync(join(process.cwd(), 'src/store/inboxHelpers.ts')), 'inboxHelpers barrel should be deleted');
  assert(!existsSync(join(process.cwd(), 'src/store/inboxSystem.ts')), 'inboxSystem should be merged into inboxCore');
};

export const checkManagedTeamObjectivesAreInlined = () => {
  const checkedFiles = [
    'src/store/careerActions.ts',
    'src/store/gameStore.ts',
    'src/store/inboxActions.ts',
    'src/store/persistence.ts',
  ];

  checkedFiles.forEach(filePath => {
    const source = readSource(filePath);
    assert(!source.includes('managedTeamObjectives'), `${filePath} should inline managed-team objective setup`);
  });

  assert(!existsSync(join(process.cwd(), 'src/store/managedTeamObjectives.ts')), 'managedTeamObjectives wrapper should be deleted');
};

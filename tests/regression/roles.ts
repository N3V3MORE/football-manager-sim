import { getCompatiblePlayerRoles, getPlayerRoleForSlot, getRoleEnergyDrainMultiplier } from '../../src/core/playerRoleEngine';
import { buildTeamShapeProfile } from '../../src/core/shapeEngine';
import type { PlayerRole } from '../../src/models/types';
import { assert, buildTestPlayer, buildTestTeam, initGameData } from './shared';

export const checkPlayerRoleCompatibilityMatrix = () => {
  const data = initGameData('Arsenal');
  const template = Object.values(data.players)[0];
  assert(template, 'Expected player template for role compatibility regression');

  const striker = buildTestPlayer(template!, 'role-st', 'role-team', 'FWD', 75, { subPosition: 'ST', altPositions: ['ST'] });
  const fullBack = buildTestPlayer(template!, 'role-rb', 'role-team', 'DEF', 75, { subPosition: 'RB', altPositions: ['RB'] });
  const keeper = buildTestPlayer(template!, 'role-gk', 'role-team', 'GK', 75, { subPosition: 'GK', altPositions: ['GK'] });

  assert(getCompatiblePlayerRoles(striker).includes('falseNine'), 'Strikers should support false nine');
  assert(getCompatiblePlayerRoles(fullBack).includes('stayBack'), 'Full-backs should support stay back');
  assert(getCompatiblePlayerRoles(keeper).length === 1 && getCompatiblePlayerRoles(keeper)[0] === 'default', 'Goalkeepers should only support default role');
};

export const checkSlotKeyedPlayerRoleLookup = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for role lookup regression');

  const player = buildTestPlayer(templatePlayer!, 'slot-role-player', 'role-team', 'FWD', 76, { subPosition: 'ST', altPositions: ['ST'] });
  const team = buildTestTeam(templateTeam!, 'role-team', 'Role Team', {
    formationMap: { '0-1': player.id },
    playerRoles: { '0-1': 'falseNine' },
  });

  assert(getPlayerRoleForSlot(team, player.id) === 'falseNine', 'Player role should be looked up from the occupied formation slot');
};

export const checkPlayerRolesAdjustShapeProfile = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for role shape regression');

  const forward = buildTestPlayer(templatePlayer!, 'shape-forward', 'shape-team', 'FWD', 78, { subPosition: 'ST', altPositions: ['ST'] });
  const midfielder = buildTestPlayer(templatePlayer!, 'shape-mid', 'shape-team', 'MID', 74, { subPosition: 'CDM', altPositions: ['CDM', 'CM'] });
  const baseTeam = buildTestTeam(templateTeam!, 'shape-team', 'Shape Team', {
    activeFormation: '4-2-3-1',
    formationMap: { '0-0': forward.id, '2-0': midfielder.id },
  });
  const roleTeam = {
    ...baseTeam,
    playerRoles: { '0-0': 'falseNine', '2-0': 'stayBack' } satisfies Record<string, PlayerRole>,
  };

  const baseShape = buildTeamShapeProfile(baseTeam, [forward, midfielder]);
  const roleShape = buildTeamShapeProfile(roleTeam, [forward, midfielder]);

  assert(roleShape.buildOutSupport > baseShape.buildOutSupport, 'False nine should increase build-out support');
  assert(roleShape.centralShield > baseShape.centralShield, 'Stay back should increase central shield');
};

export const checkPlayerRoleEnergyDrainModifiers = () => {
  assert(getRoleEnergyDrainMultiplier('boxToBox') > getRoleEnergyDrainMultiplier('default'), 'Box-to-box role should increase energy drain');
  assert(getRoleEnergyDrainMultiplier('getForward') > getRoleEnergyDrainMultiplier('default'), 'Get-forward role should increase energy drain');
  assert(getRoleEnergyDrainMultiplier('pressingForward') > getRoleEnergyDrainMultiplier('default'), 'Pressing forward role should increase energy drain');
};

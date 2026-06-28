import { Player, PlayerRole, Team } from '../models/types';
import { getSlotsForFormation } from '../constants/formations';

export type MatchPhase = 'buildUp' | 'creation' | 'finishing' | 'defending';
export type RoleStatBonus = Partial<Record<'passing' | 'dribbling' | 'physical' | 'shooting' | 'defending' | 'throughBall', number>>;
export type RoleShapeAdjustment = Partial<Record<'widePresence' | 'centralShield' | 'finalThirdPresence' | 'boxTargetPresence' | 'buildOutSupport', number>>;

export const PLAYER_ROLE_LABELS: Record<PlayerRole, string> = {
  default: 'Default',
  targetMan: 'Target Man',
  falseNine: 'False Nine',
  playmaker: 'Playmaker',
  boxToBox: 'Box to Box',
  defensiveMid: 'Defensive Mid',
  mezzala: 'Mezzala',
  invertedWinger: 'Inverted Winger',
  wideMidfielder: 'Wide Midfielder',
  wingBack: 'Wing Back',
  stayBack: 'Stay Back',
  getForward: 'Get Forward',
  pressingForward: 'Pressing Forward',
};

export const PLAYER_ROLE_DESCRIPTIONS: Record<PlayerRole, string> = {
  default: 'No special instruction.',
  targetMan: 'More box presence and physical advantage in attacking duels.',
  falseNine: 'Drops into build-up, adds passing support, and reduces box presence.',
  playmaker: 'Boosts chance creation and through-ball influence.',
  boxToBox: 'Joins more phases and spends extra energy covering ground.',
  defensiveMid: 'Shields central areas and avoids late finishing positions.',
  mezzala: 'Adds dribbling influence in chance creation.',
  invertedWinger: 'Moves inside more often and carries extra shooting threat.',
  wideMidfielder: 'Keeps width and focuses on creation over finishing.',
  wingBack: 'Pushes into wide creation areas with a lighter defensive profile.',
  stayBack: 'Holds position, strengthens defensive shape, and avoids attacks.',
  getForward: 'Arrives in finishing positions at reduced weight with extra energy cost.',
  pressingForward: 'Adds front-line pressure and defensive disruption with extra energy cost.',
};

export const PLAYER_ROLES = Object.keys(PLAYER_ROLE_LABELS) as PlayerRole[];
const DEFAULT_ONLY: PlayerRole[] = ['default'];

const roleMatrix: Record<string, PlayerRole[]> = {
  ST: ['default', 'targetMan', 'falseNine', 'pressingForward'],
  CF: ['default', 'targetMan', 'falseNine', 'pressingForward'],
  CAM: ['default', 'playmaker'],
  AM: ['default', 'playmaker'],
  CM: ['default', 'playmaker', 'boxToBox', 'mezzala', 'defensiveMid', 'getForward'],
  CDM: ['default', 'defensiveMid', 'boxToBox', 'stayBack'],
  DM: ['default', 'defensiveMid', 'boxToBox', 'stayBack'],
  LW: ['default', 'invertedWinger', 'wideMidfielder', 'pressingForward'],
  RW: ['default', 'invertedWinger', 'wideMidfielder', 'pressingForward'],
  LM: ['default', 'wideMidfielder'],
  RM: ['default', 'wideMidfielder'],
  LB: ['default', 'wingBack', 'stayBack'],
  RB: ['default', 'wingBack', 'stayBack'],
  LWB: ['default', 'wingBack', 'stayBack', 'getForward'],
  RWB: ['default', 'wingBack', 'stayBack', 'getForward'],
  CB: ['default', 'stayBack'],
  GK: ['default'],
};

const normalizeSlotLabel = (slotLabel: string) => slotLabel.trim().toUpperCase();

const getSlotLabelForPlayer = (team: Team, playerId: string) => {
  const entry = Object.entries(team.formationMap || {}).find(([, mappedPlayerId]) => mappedPlayerId === playerId);
  if (!entry) return undefined;
  const [slotKey] = entry;
  const [row, col] = slotKey.split('-').map(Number);
  return getSlotsForFormation(team.activeFormation)[row]?.[col]?.label;
};

export const getSlotLabelForRoleKey = (team: Team, slotKey: string) => {
  const [row, col] = slotKey.split('-').map(Number);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return undefined;
  return getSlotsForFormation(team.activeFormation)[row]?.[col]?.label;
};

const getRoleMatrixKeysForPlayer = (player: Player, slotLabel?: string) => {
  const labels = [slotLabel, player.subPosition, ...(player.altPositions || [])].filter(Boolean) as string[];
  if (player.position === 'GK') labels.push('GK');
  if (player.position === 'FWD') labels.push('ST');
  if (player.position === 'MID') labels.push('CM');
  if (player.position === 'DEF') labels.push('CB');
  return Array.from(new Set(labels));
};

export const getCompatiblePlayerRolesForSlot = (slotLabel: string): PlayerRole[] => (
  roleMatrix[normalizeSlotLabel(slotLabel)] || DEFAULT_ONLY
);

export const getCompatiblePlayerRoles = (player: Player, slotLabel?: string): PlayerRole[] => {
  if (slotLabel) return getCompatiblePlayerRolesForSlot(slotLabel);
  const roles = getRoleMatrixKeysForPlayer(player).flatMap(label => roleMatrix[normalizeSlotLabel(label)] || []);
  return roles.length > 0 ? Array.from(new Set(roles)) : DEFAULT_ONLY;
};

export const isPlayerRoleCompatible = (player: Player, role: PlayerRole, slotLabel?: string) => (
  getCompatiblePlayerRoles(player, slotLabel).includes(role)
);

export const isPlayerRoleCompatibleForSlot = (role: PlayerRole, slotLabel?: string) => (
  role === 'default' || Boolean(slotLabel && getCompatiblePlayerRolesForSlot(slotLabel).includes(role))
);

export const isPlayerRole = (value: unknown): value is PlayerRole => (
  typeof value === 'string' && PLAYER_ROLES.includes(value as PlayerRole)
);

export const getPlayerRoleForSlot = (team: Team, playerId: string): PlayerRole => {
  const slot = Object.entries(team.formationMap || {}).find(([, mappedPlayerId]) => mappedPlayerId === playerId);
  if (!slot) return 'default';
  const [slotKey] = slot;
  const role = team.playerRoles?.[slotKey] || 'default';
  return isPlayerRoleCompatibleForSlot(role, getSlotLabelForRoleKey(team, slotKey)) ? role : 'default';
};

export const getCompatiblePlayerRoleForTeamSlot = (team: Team, player: Player): PlayerRole => {
  const role = getPlayerRoleForSlot(team, player.id);
  const slotLabel = getSlotLabelForPlayer(team, player.id);
  return isPlayerRoleCompatible(player, role, slotLabel) ? role : 'default';
};

export const getRoleWeightMultiplier = (
  role: PlayerRole,
  phase: MatchPhase
) => {
  if (role === 'targetMan' && phase === 'finishing') return 1.6;
  if (role === 'falseNine' && phase === 'finishing') return 0.75;
  if (role === 'falseNine' && phase === 'buildUp') return 1.35;
  if (role === 'playmaker' && phase === 'creation') return 1.35;
  if (role === 'boxToBox') return 1.15;
  if (role === 'defensiveMid' && phase === 'finishing') return 0;
  if (role === 'invertedWinger' && phase === 'finishing') return 1.25;
  if (role === 'wideMidfielder' && phase === 'finishing') return 0.75;
  if (role === 'wingBack' && phase === 'creation') return 1.2;
  if (role === 'stayBack' && (phase === 'creation' || phase === 'finishing')) return 0;
  if (role === 'getForward' && phase === 'finishing') return 0.6;
  if (role === 'pressingForward' && phase === 'defending') return 1.25;
  return 1;
};

export const getRoleStatBonus = (
  role: PlayerRole,
  phase: MatchPhase
): RoleStatBonus => {
  if (role === 'targetMan' && phase === 'creation') return { physical: 0.15 };
  if (role === 'falseNine' && phase === 'buildUp') return { passing: 0.12 };
  if (role === 'playmaker' && phase === 'creation') return { passing: 0.15, throughBall: 0.15 };
  if (role === 'defensiveMid' && phase === 'defending') return { defending: 0.1 };
  if (role === 'mezzala' && phase === 'creation') return { dribbling: 0.14 };
  if (role === 'invertedWinger' && phase === 'finishing') return { shooting: 0.12 };
  if (role === 'stayBack' && phase === 'defending') return { defending: 0.12 };
  if (role === 'pressingForward' && phase === 'defending') return { defending: 0.06 };
  return {};
};

export const getRoleEnergyDrainMultiplier = (role: PlayerRole) => {
  if (role === 'boxToBox') return 1.2;
  if (role === 'getForward') return 1.1;
  if (role === 'pressingForward') return 1.15;
  return 1;
};

export const getRoleShapeAdjustment = (role: PlayerRole): RoleShapeAdjustment => {
  switch (role) {
    case 'targetMan':
      return { boxTargetPresence: 0.8 };
    case 'falseNine':
      return { buildOutSupport: 0.9, boxTargetPresence: -0.5 };
    case 'playmaker':
      return { buildOutSupport: 0.4, finalThirdPresence: 0.3 };
    case 'defensiveMid':
    case 'stayBack':
      return { centralShield: 0.8, finalThirdPresence: -0.3 };
    case 'wingBack':
      return { widePresence: 0.8, finalThirdPresence: 0.3, centralShield: -0.2 };
    case 'wideMidfielder':
      return { widePresence: 0.5 };
    case 'invertedWinger':
      return { finalThirdPresence: 0.4, widePresence: -0.2 };
    case 'getForward':
    case 'boxToBox':
      return { finalThirdPresence: 0.4 };
    case 'pressingForward':
      return { finalThirdPresence: 0.3 };
    case 'mezzala':
      return { finalThirdPresence: 0.3, buildOutSupport: 0.2 };
    default:
      return {};
  }
};

export const sanitizePlayerRolesForTeam = (
  team: Team,
  roles: Record<string, unknown> | undefined = team.playerRoles
): Record<string, PlayerRole> | undefined => {
  if (!roles || typeof roles !== 'object') return undefined;
  const next: Record<string, PlayerRole> = {};
  Object.entries(roles).forEach(([slotKey, role]) => {
    if (!isPlayerRole(role) || role === 'default') return;
    if (!isPlayerRoleCompatibleForSlot(role, getSlotLabelForRoleKey(team, slotKey))) return;
    next[slotKey] = role;
  });
  return Object.keys(next).length > 0 ? next : undefined;
};

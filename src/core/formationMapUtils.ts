import { Player, Team } from '../models/types';
import { Slot } from '../constants/formations';

const FIT_SCORES = {
  EXACT_SUBPOS: 100,
  SAME_LANE_SUBPOS: 80,
  SAME_POSITION: 60,
  ADJACENT_POSITION: 45,
  WILDCARD: 25,
} as const;

const SLOT_SUBPOS: Record<string, string[]> = {
  GK: ['GK'],
  LB: ['LB', 'LWB'],
  RB: ['RB', 'RWB'],
  LWB: ['LWB', 'LB', 'WB'],
  RWB: ['RWB', 'RB', 'WB'],
  WB: ['WB', 'LWB', 'RWB', 'LB', 'RB'],
  CB: ['CB'],
  CDM: ['CDM', 'CM', 'DM'],
  DM: ['DM', 'CDM', 'CM'],
  CM: ['CM', 'CDM', 'CAM', 'DM'],
  CAM: ['CAM', 'CM', 'AM'],
  AM: ['AM', 'CAM', 'CM'],
  LM: ['LM', 'LW', 'CM'],
  RM: ['RM', 'RW', 'CM'],
  LW: ['LW', 'LM', 'LF'],
  RW: ['RW', 'RM', 'RF'],
  LF: ['LF', 'LW', 'ST'],
  RF: ['RF', 'RW', 'ST'],
  ST: ['ST', 'CF'],
  CF: ['CF', 'ST'],
};

export const getSlotFitScore = (player: Player, slot: Slot) => {
  if (slot.pos === 'GK') return player.position === 'GK' ? FIT_SCORES.EXACT_SUBPOS : -Infinity;
  if (player.position === 'GK') return -Infinity;

  let score = 0;
  const allowedSubPositions = SLOT_SUBPOS[slot.label] || [slot.label];

  if (player.subPosition === slot.label) score += FIT_SCORES.EXACT_SUBPOS;
  if (player.altPositions?.includes(slot.label)) score += FIT_SCORES.SAME_LANE_SUBPOS;
  if (allowedSubPositions.includes(player.subPosition)) score += FIT_SCORES.SAME_POSITION;
  if (player.altPositions?.some(alt => allowedSubPositions.includes(alt))) score += FIT_SCORES.ADJACENT_POSITION;
  if (player.position === slot.pos) score += FIT_SCORES.WILDCARD;

  return score > 0 ? score : -Infinity;
};

export const isPlayerSlotFit = (player: Player, slot: Slot) => (
  getSlotFitScore(player, slot) > -Infinity
);

export const rebuildFormationSlotPlayers = (
  slots: Slot[][],
  starters: Player[],
  formationMap: Record<string, string>
) => {
  const slotPlayers: (Player | null)[][] = slots.map(row => row.map(() => null));
  const assignedStarterIds = new Set<string>();

  slots.forEach((row, rowIdx) => {
    row.forEach((slot, colIdx) => {
      const playerId = formationMap[`${rowIdx}-${colIdx}`];
      const mappedStarter = playerId ? starters.find(player => player.id === playerId) || null : null;
      if (mappedStarter && isPlayerSlotFit(mappedStarter, slot)) {
        slotPlayers[rowIdx]![colIdx] = mappedStarter;
        assignedStarterIds.add(mappedStarter.id);
      }
    });
  });

  const missingStarters = starters.filter(player => !assignedStarterIds.has(player.id));
  slots.forEach((row, rowIdx) => {
    row.forEach((slot, colIdx) => {
      if (slotPlayers[rowIdx]![colIdx]) return;
      const bestIndex = missingStarters
        .map((player, index) => ({
          index,
          score: getSlotFitScore(player, slot),
          rating: player.overallRating,
        }))
        .filter(candidate => candidate.score > -Infinity)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.rating - a.rating;
        })[0]?.index;

      if (bestIndex === undefined) return;
      slotPlayers[rowIdx]![colIdx] = missingStarters.splice(bestIndex, 1)[0]!;
    });
  });

  slots.forEach((row, rowIdx) => {
    row.forEach((_, colIdx) => {
      if (slotPlayers[rowIdx]![colIdx] || missingStarters.length === 0) return;
      slotPlayers[rowIdx]![colIdx] = missingStarters.shift() || null;
    });
  });

  return slotPlayers;
};

export const rebuildFormationMap = (
  slots: Slot[][],
  starters: Player[],
  formationMap: Record<string, string>
) => {
  const slotPlayers = rebuildFormationSlotPlayers(slots, starters, formationMap);
  const rebuiltMap: Record<string, string> = {};

  slotPlayers.forEach((row, rowIdx) => {
    row.forEach((player, colIdx) => {
      if (player) rebuiltMap[`${rowIdx}-${colIdx}`] = player.id;
    });
  });

  return rebuiltMap;
};

export const removePlayerFromTeamSelections = (team: Team, playerId: string): Team => {
  const nextFormationMap = team.formationMap
    ? Object.fromEntries(Object.entries(team.formationMap).filter(([, mappedId]) => mappedId !== playerId))
    : team.formationMap;
  const nextLastStartingXI = team.lastStartingXI?.filter(mappedId => mappedId !== playerId);

  return {
    ...team,
    ...(team.formationMap ? { formationMap: nextFormationMap } : {}),
    ...(team.lastStartingXI ? { lastStartingXI: nextLastStartingXI } : {}),
  };
};

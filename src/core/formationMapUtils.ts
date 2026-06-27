import { Player, Team } from '../models/types';
import { Slot } from '../constants/formations';

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
  if (slot.pos === 'GK') return player.position === 'GK' ? 100 : -Infinity;
  if (player.position === 'GK') return -Infinity;

  let score = 0;
  const allowedSubPositions = SLOT_SUBPOS[slot.label] || [slot.label];

  if (player.subPosition === slot.label) score += 100;
  if (player.altPositions?.includes(slot.label)) score += 80;
  if (allowedSubPositions.includes(player.subPosition)) score += 60;
  if (player.altPositions?.some(alt => allowedSubPositions.includes(alt))) score += 45;
  if (player.position === slot.pos) score += 25;

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
      if (mappedStarter && !assignedStarterIds.has(mappedStarter.id) && isPlayerSlotFit(mappedStarter, slot)) {
        slotPlayers[rowIdx][colIdx] = mappedStarter;
        assignedStarterIds.add(mappedStarter.id);
      }
    });
  });

  const missingStarters = starters.filter(player => !assignedStarterIds.has(player.id));
  slots.forEach((row, rowIdx) => {
    row.forEach((slot, colIdx) => {
      if (slotPlayers[rowIdx][colIdx]) return;
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
      slotPlayers[rowIdx][colIdx] = missingStarters.splice(bestIndex, 1)[0];
    });
  });

  // Fallback: fill remaining empty slots with acceptable players.
  // Never place an outfield player in a GK slot; never place a GK in an outfield slot.
  // If no acceptable player is available, prefer leaving the slot empty.
  slots.forEach((row, rowIdx) => {
    row.forEach((_, colIdx) => {
      if (slotPlayers[rowIdx][colIdx] || missingStarters.length === 0) return;
      const slot = slots[rowIdx][colIdx];

      if (slot.pos === 'GK') {
        // GK slot: only a goalkeeper is acceptable. Never fill with an outfield player.
        const gkIndex = missingStarters.findIndex(p => p.position === 'GK');
        if (gkIndex !== -1) {
          slotPlayers[rowIdx][colIdx] = missingStarters.splice(gkIndex, 1)[0] || null;
        }
        return;
      }

      // Outfield slot: prefer players with some slot fit; never use a GK.
      const compatIndex = missingStarters
        .map((p, i) => ({ i, score: getSlotFitScore(p, slot) }))
        .filter(c => c.score > -Infinity)
        .sort((a, b) => b.score - a.score)[0]?.i;

      if (compatIndex !== undefined) {
        slotPlayers[rowIdx][colIdx] = missingStarters.splice(compatIndex, 1)[0] || null;
        return;
      }

      // No slot-compatible player remains; fill with any outfield player.
      const outfieldIndex = missingStarters.findIndex(p => p.position !== 'GK');
      if (outfieldIndex !== -1) {
        slotPlayers[rowIdx][colIdx] = missingStarters.splice(outfieldIndex, 1)[0] || null;
      }
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

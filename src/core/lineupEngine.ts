import { getSlotsForFormation } from '../constants/formations';
import { Player } from '../models/types';

export const autoAssignLineup = (teamId: string, players: Record<string, Player>, formation: string) => {
  const teamPlayers = Object.values(players)
    .filter(p => p.teamId === teamId)
    .sort((a, b) => b.overallRating - a.overallRating);

  const slots = getSlotsForFormation(formation);
  const assignedIds = new Set<string>();
  const updates: Record<string, Partial<Player>> = {};

  teamPlayers.forEach(p => {
    updates[p.id] = { isStarting: false, isSub: false };
  });

  slots.forEach((row) => {
    row.forEach((slot) => {
      let candidate = teamPlayers.find(p => p.subPosition === slot.label && !assignedIds.has(p.id) && (p.matchesSuspended || 0) === 0);
      if (!candidate) candidate = teamPlayers.find(p => p.position === slot.pos && !assignedIds.has(p.id) && (p.matchesSuspended || 0) === 0);
      if (!candidate) candidate = teamPlayers.find(p => !assignedIds.has(p.id) && (p.matchesSuspended || 0) === 0);

      if (candidate) {
        updates[candidate.id] = { isStarting: true, isSub: false };
        assignedIds.add(candidate.id);
      }
    });
  });

  return updates;
};

const getLineupScore = (
  player: Player,
  slotPos: Player['position'],
  slotLabel: string,
  teamMaxMinutes: number,
  keepStarterBias = false
) => {
  let score = player.overallRating * 1.35;
  score += player.energy * 0.35;
  score += player.morale * 0.15;

  const usageRatio = teamMaxMinutes > 0 ? player.minutesPlayed / teamMaxMinutes : 0;
  score += Math.max(0, 1 - usageRatio) * 10;

  if (player.position === slotPos) score += 9;
  if (player.subPosition === slotLabel) score += 12;
  if (player.altPositions?.includes(slotLabel)) score += 7;
  if (keepStarterBias && player.isStarting) score += 3;

  return score;
};

export const buildQuickSimLineup = (
  teamId: string,
  players: Record<string, Player>,
  formation: string
) => {
  const teamPlayers = Object.values(players)
    .filter(p => p.teamId === teamId && p.matchesSuspended === 0)
    .sort((a, b) => b.overallRating - a.overallRating);

  const updates: Record<string, Partial<Player>> = {};
  teamPlayers.forEach(player => {
    updates[player.id] = { isStarting: false, isSub: false };
  });

  const slots = getSlotsForFormation(formation);
  const flatSlots = slots.flat();
  const assigned = new Set<string>();
  const teamMaxMinutes = teamPlayers.reduce((max, player) => Math.max(max, player.minutesPlayed || 0), 0);

  flatSlots.forEach(slot => {
    const candidates = teamPlayers.filter(player => !assigned.has(player.id));
    if (candidates.length === 0) return;
    const exact = candidates.filter(player => player.subPosition === slot.label || player.altPositions?.includes(slot.label));
    const positional = candidates.filter(player => player.position === slot.pos);
    const pool = exact.length > 0 ? exact : (positional.length > 0 ? positional : candidates);
    const chosen = pool
      .map(player => ({
        player,
        score: getLineupScore(player, slot.pos as Player['position'], slot.label, teamMaxMinutes, true),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.player.overallRating - a.player.overallRating;
      })[0].player;
    updates[chosen.id] = { isStarting: true, isSub: false };
    assigned.add(chosen.id);
  });

  if (assigned.size < 11) {
    teamPlayers
      .filter(player => !assigned.has(player.id))
      .slice(0, 11 - assigned.size)
      .forEach(player => {
        updates[player.id] = { isStarting: true, isSub: false };
        assigned.add(player.id);
      });
  }

  const benchCandidates = teamPlayers
    .filter(player => !assigned.has(player.id))
    .sort((a, b) => {
      const aScore = a.overallRating + a.energy * 0.25 + a.morale * 0.1;
      const bScore = b.overallRating + b.energy * 0.25 + b.morale * 0.1;
      return bScore - aScore;
    });

  benchCandidates.slice(0, 7).forEach(player => {
    updates[player.id] = { isStarting: false, isSub: true };
  });

  return updates;
};

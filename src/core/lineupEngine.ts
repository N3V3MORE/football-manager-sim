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

type ScoredChoice = {
  player: Player;
  score: number;
};

export const buildQuickSimLineup = (
  teamId: string,
  players: Record<string, Player>,
  formation: string,
  eligiblePlayers?: Player[]
) => {
  const teamPlayers = (eligiblePlayers || Object.values(players)
    .filter(p => p.teamId === teamId && p.matchesSuspended === 0))
    .sort((a, b) => b.overallRating - a.overallRating);

  const updates: Record<string, Partial<Player>> = {};
  teamPlayers.forEach(player => {
    updates[player.id] = { isStarting: false, isSub: false };
  });

  const slots = getSlotsForFormation(formation);
  const flatSlots = slots.flat();
  const assigned = new Set<string>();
  const teamMaxMinutes = teamPlayers.reduce((max, player) => Math.max(max, player.minutesPlayed || 0), 0);
  const isBetterChoice = (current: ScoredChoice | null, candidate: ScoredChoice) => {
    if (!current) return true;
    if (candidate.score !== current.score) return candidate.score > current.score;
    return candidate.player.overallRating > current.player.overallRating;
  };

  flatSlots.forEach(slot => {
    let bestExact: ScoredChoice | null = null;
    let bestPositional: ScoredChoice | null = null;
    let bestAny: ScoredChoice | null = null;

    teamPlayers.forEach(player => {
      if (assigned.has(player.id)) return;

      const scoredCandidate = {
        player,
        score: getLineupScore(player, slot.pos as Player['position'], slot.label, teamMaxMinutes, true),
      };

      if (isBetterChoice(bestAny, scoredCandidate)) {
        bestAny = scoredCandidate;
      }

      if (player.position === slot.pos && isBetterChoice(bestPositional, scoredCandidate)) {
        bestPositional = scoredCandidate;
      }

      if ((player.subPosition === slot.label || player.altPositions?.includes(slot.label)) && isBetterChoice(bestExact, scoredCandidate)) {
        bestExact = scoredCandidate;
      }
    });

    const selectedChoice: ScoredChoice | null = bestExact || bestPositional || bestAny;
    if (!selectedChoice) return;
    const selectedPlayer = (selectedChoice as ScoredChoice).player;
    updates[selectedPlayer.id] = { isStarting: true, isSub: false };
    assigned.add(selectedPlayer.id);
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

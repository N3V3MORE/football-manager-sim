import { getSlotsForFormation, Slot } from '../constants/formations';
import { Formation, Player, Team } from '../models/types';
import { isPlayerUnavailable } from './playerStatusUtils';

export const autoAssignLineup = (teamId: string, players: Record<string, Player>, formation: Formation) => {
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
      let candidate = teamPlayers.find(p => p.subPosition === slot.label && !assignedIds.has(p.id) && !isPlayerUnavailable(p));
      if (!candidate) candidate = teamPlayers.find(p => p.position === slot.pos && !assignedIds.has(p.id) && !isPlayerUnavailable(p));
      if (!candidate) candidate = teamPlayers.find(p => !assignedIds.has(p.id) && !isPlayerUnavailable(p));

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
  formation: Formation
) => {
  const allTeamPlayers = Object.values(players)
    .filter(p => p.teamId === teamId);
  const teamPlayers = allTeamPlayers
    .filter(p => !isPlayerUnavailable(p))
    .sort((a, b) => b.overallRating - a.overallRating);

  const updates: Record<string, Partial<Player>> = {};
  allTeamPlayers.forEach(player => {
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
      })[0]!.player;
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

export const getTeamMatchStarters = (
  teamId: string,
  userTeamId: string | null | undefined,
  updatedPlayers: Record<string, Player>,
  updatedTeams: Record<string, Team>,
  isPlayerUnavailable: (p: Player) => boolean,
  rebuildFormationMap: (slots: Slot[][], starters: Player[], map: Record<string, string>) => Record<string, string>
) => {
  const team = updatedTeams[teamId]!;
  const shouldPreserveManual = Boolean(userTeamId && teamId === userTeamId);
  if (shouldPreserveManual) {
    const teamPlayers = Object.values(updatedPlayers).filter(p => p.teamId === teamId);
    const eligibleTeamPlayers = teamPlayers.filter(player => !isPlayerUnavailable(player));
    const savedStarters = teamPlayers.filter(player => player.isStarting && !isPlayerUnavailable(player));
    const cleanFormationMap = rebuildFormationMap(
      getSlotsForFormation(team.activeFormation),
      savedStarters,
      team.formationMap || {}
    );
    updatedTeams[teamId] = { ...team, formationMap: cleanFormationMap } as Team;
    const mappedStarterIds = Array.from(new Set(Object.values(cleanFormationMap)));
    if (mappedStarterIds.length > 0) {
      const mappedSet = new Set(mappedStarterIds.slice(0, 11));
      const enforceMapXi = mappedStarterIds.length >= 11;
      eligibleTeamPlayers.forEach(player => {
        if (mappedSet.has(player.id)) {
          updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: true, isSub: false } as Player;
        } else if (enforceMapXi && player.isStarting) {
          updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: false, isSub: true } as Player;
        }
      });
    }
    let starters = eligibleTeamPlayers.filter(p => p.isStarting);
    if (starters.length > 11) {
      const keepIds = new Set(starters
        .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1))
        .slice(0, 11)
        .map(p => p.id));
      starters.forEach(player => {
        if (!keepIds.has(player.id)) {
          updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: false, isSub: true } as Player;
        }
      });
    }
    starters = Object.values(updatedPlayers).filter(player => player.teamId === teamId && player.isStarting && !isPlayerUnavailable(player));
    if (starters.length < 11) {
      const fillCandidates = eligibleTeamPlayers
        .filter(player => !player.isStarting)
        .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1))
        .slice(0, 11 - starters.length);
      fillCandidates.forEach(player => {
        updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: true, isSub: false } as Player;
      });
      starters = [...starters, ...fillCandidates];
    }
    return starters.slice(0, 11);
  } else {
    const lineupUpdates = buildQuickSimLineup(teamId, updatedPlayers, team.activeFormation);
    Object.keys(lineupUpdates).forEach(id => {
      updatedPlayers[id] = { ...updatedPlayers[id], ...lineupUpdates[id] } as Player;
    });
  }
  return Object.values(updatedPlayers).filter(player => player.teamId === teamId && player.isStarting && !isPlayerUnavailable(player));
};

export const getTeamMatchBench = (
  teamId: string,
  matchStarters: Player[],
  updatedPlayers: Record<string, Player>,
  isPlayerUnavailable: (p: Player) => boolean
) => {
  const starterIds = new Set(matchStarters.map(player => player.id));
  let bench = Object.values(updatedPlayers).filter(p => (
    p.teamId === teamId &&
    p.isSub &&
    !isPlayerUnavailable(p) &&
    !starterIds.has(p.id)
  ));
  if (bench.length < 7) {
    const extra = Object.values(updatedPlayers)
      .filter(p => p.teamId === teamId && !p.isStarting && !p.isSub && !isPlayerUnavailable(p) && !starterIds.has(p.id))
      .sort((a, b) => b.overallRating - a.overallRating)
      .slice(0, 7 - bench.length);
    extra.forEach(player => {
      updatedPlayers[player.id] = { ...updatedPlayers[player.id], isSub: true } as Player;
    });
    bench = Object.values(updatedPlayers).filter(p => (
      p.teamId === teamId &&
      p.isSub &&
      !isPlayerUnavailable(p) &&
      !starterIds.has(p.id)
    ));
  }
  if (bench.length > 7) {
    const keptBench = [...bench]
      .sort((a, b) => b.overallRating - a.overallRating)
      .slice(0, 7);
    const keptIds = new Set(keptBench.map(player => player.id));
    bench.forEach(player => {
      if (!keptIds.has(player.id)) {
        updatedPlayers[player.id] = { ...updatedPlayers[player.id], isSub: false } as Player;
      }
    });
    bench = keptBench;
  }
  return bench.slice(0, 7);
};

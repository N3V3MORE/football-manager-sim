import { getSlotsForFormation, Slot } from '../constants/formations';
import { Player, Team } from '../models/types';
import { isPlayerUnavailable } from './playerStatusUtils';
import { getSlotFitScore } from './formationMapUtils';
import { validateMatchdayXI } from './matchdayValidation';

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
      let candidate: Player | undefined;
      if (slot.pos === 'GK') {
        // Guarantee a GK in the GK slot — never fall back to an outfield player.
        candidate = teamPlayers.find(p => p.position === 'GK' && p.subPosition === slot.label && !assignedIds.has(p.id) && !isPlayerUnavailable(p));
        if (!candidate) candidate = teamPlayers.find(p => p.position === 'GK' && !assignedIds.has(p.id) && !isPlayerUnavailable(p));
      } else {
        candidate = teamPlayers.find(p => p.subPosition === slot.label && !assignedIds.has(p.id) && !isPlayerUnavailable(p));
        if (!candidate) candidate = teamPlayers.find(p => p.position === slot.pos && !assignedIds.has(p.id) && !isPlayerUnavailable(p));
        if (!candidate) candidate = teamPlayers.find(p => p.position !== 'GK' && !assignedIds.has(p.id) && !isPlayerUnavailable(p));
      }

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
    let candidates = teamPlayers.filter(player => !assigned.has(player.id));
    if (candidates.length === 0) return;
    // For GK slots, restrict to goalkeepers only — never fill with an outfield player.
    if (slot.pos === 'GK') {
      candidates = candidates.filter(player => player.position === 'GK');
      if (candidates.length === 0) return;
    }
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

  if (assigned.size < 11 && !teamPlayers.some(player => assigned.has(player.id) && player.position === 'GK')) {
    const goalkeeper = teamPlayers.find(player => player.position === 'GK' && !assigned.has(player.id));
    if (goalkeeper) {
      updates[goalkeeper.id] = { isStarting: true, isSub: false };
      assigned.add(goalkeeper.id);
    }
  }

  if (assigned.size < 11) {
    teamPlayers
      .filter(player => !assigned.has(player.id) && player.position !== 'GK')
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
  const team = updatedTeams[teamId];
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
    updatedTeams[teamId] = { ...team, formationMap: cleanFormationMap };
    const mappedStarterIds = Array.from(new Set(Object.values(cleanFormationMap)));
    if (mappedStarterIds.length > 0) {
      const mappedSet = new Set(mappedStarterIds.slice(0, 11));
      const enforceMapXi = mappedStarterIds.length >= 11;
      eligibleTeamPlayers.forEach(player => {
        if (mappedSet.has(player.id)) {
          updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: true, isSub: false };
        } else if (enforceMapXi && player.isStarting) {
          updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: false, isSub: true };
        }
      });
    }
    let starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && !isPlayerUnavailable(p));
    if (starters.length > 11) {
      // GK-preserving max-11 trim:
      // If any starting GK exists, keep the best GK + best 10 non-GK starters.
      // If no starting GK exists, keep the best 11 overall.
      // Never demote the only mapped/starting GK solely because of a lower rating.
      const gks = starters.filter(p => p.position === 'GK');
      const outfield = starters.filter(p => p.position !== 'GK');
      let keepIds: Set<string>;
      if (gks.length > 0) {
        const bestGk = gks.reduce((a, b) => a.overallRating > b.overallRating ? a : b);
        const bestOutfield = outfield
          .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1))
          .slice(0, 10);
        keepIds = new Set([bestGk.id, ...bestOutfield.map(p => p.id)]);
      } else {
        keepIds = new Set(starters
          .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1))
          .slice(0, 11)
          .map(p => p.id));
      }
      starters.forEach(player => {
        if (!keepIds.has(player.id)) {
          updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: false, isSub: true };
        }
      });
    }
    starters = Object.values(updatedPlayers).filter(player => player.teamId === teamId && player.isStarting && !isPlayerUnavailable(player));
    if (starters.length < 11) {
      const slots = getSlotsForFormation(team.activeFormation);
      const currentMap = updatedTeams[teamId].formationMap || {};
      const starterIds = new Set(starters.map(p => p.id));

      // Identify empty slots: no mapped player or mapped player isn't actually a starter.
      const emptySlots: { rowIdx: number; colIdx: number; slot: Slot }[] = [];
      slots.forEach((row, rowIdx) => {
        row.forEach((slot, colIdx) => {
          const key = `${rowIdx}-${colIdx}`;
          const mappedId = currentMap[key];
          if (!mappedId || !starterIds.has(mappedId)) {
            emptySlots.push({ rowIdx, colIdx, slot });
          }
        });
      });

      // Fill pool: eligible players not already starting (excluding unavailable).
      // Derive from current updatedPlayers state so demoted starters become available.
      const fillPool = Object.values(updatedPlayers).filter(
        p => p.teamId === teamId && !isPlayerUnavailable(p) && !p.isStarting
      );

      // Fill each empty slot with the best position-appropriate player.
      emptySlots.forEach(({ rowIdx, colIdx, slot }) => {
        if (fillPool.length === 0) return;

        let candidate: Player | undefined;

        if (slot.pos === 'GK') {
          // GK slot: only a goalkeeper is acceptable — never fabricate one.
          candidate = fillPool.find(p => p.position === 'GK');
        } else {
          // Outfield slot: prefer slot-compatible players (using subPosition / altPositions).
          const scored = fillPool
            .map(p => ({ player: p, score: getSlotFitScore(p, slot) }))
            .filter(c => c.score > -Infinity)
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              return (b.player.overallRating + b.player.energy * 0.1) - (a.player.overallRating + a.player.energy * 0.1);
            });
          candidate = scored[0]?.player;

          // Fallback: any outfield player (but never put a GK in an outfield slot).
          if (!candidate) {
            candidate = fillPool.find(p => p.position !== 'GK');
          }
        }

        if (candidate) {
          const idx = fillPool.indexOf(candidate);
          fillPool.splice(idx, 1);
          updatedPlayers[candidate.id] = { ...updatedPlayers[candidate.id], isStarting: true, isSub: false };
          // Reflect in the formation map so the slot is recorded as filled.
          const updatedTeam = updatedTeams[teamId];
          if (updatedTeam) {
            updatedTeam.formationMap = {
              ...updatedTeam.formationMap,
              [`${rowIdx}-${colIdx}`]: candidate.id,
            };
          }
        }
      });

      // Recompute starters after slot-based filling.
      starters = Object.values(updatedPlayers).filter(player => player.teamId === teamId && player.isStarting && !isPlayerUnavailable(player));

      // If still short (e.g. tiny squad), fill remaining with any eligible players.
      if (starters.length < 11) {
        const remainingFill = fillPool
          .filter(player => !updatedPlayers[player.id]?.isStarting && player.position !== 'GK')
          .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1))
          .slice(0, 11 - starters.length);
        remainingFill.forEach(player => {
          updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: true, isSub: false };
        });
      }
      starters = Object.values(updatedPlayers).filter(player => player.teamId === teamId && player.isStarting && !isPlayerUnavailable(player));
    }
    const validation = validateMatchdayXI(starters, { teamId });
    if (!validation.ok || !validation.goalkeeperId) {
      const eligibleGoalkeeper = eligibleTeamPlayers
        .filter(player => player.position === 'GK' && !starters.some(starter => starter.id === player.id))
        .sort((a, b) => b.overallRating - a.overallRating)[0];
      if (eligibleGoalkeeper) {
        const outfieldStarters = starters
          .filter(player => player.position !== 'GK')
          .sort((a, b) => a.overallRating - b.overallRating);
        const demote = starters.length >= 11 ? outfieldStarters[0] : undefined;
        if (demote) updatedPlayers[demote.id] = { ...updatedPlayers[demote.id], isStarting: false, isSub: false };
        updatedPlayers[eligibleGoalkeeper.id] = { ...updatedPlayers[eligibleGoalkeeper.id], isStarting: true, isSub: false };
        starters = Object.values(updatedPlayers).filter(player => player.teamId === teamId && player.isStarting && !isPlayerUnavailable(player));
      }
    }
    const returnedStarterIds = new Set<string>();
    return starters.filter(player => {
      if (returnedStarterIds.has(player.id)) return false;
      returnedStarterIds.add(player.id);
      return true;
    }).slice(0, 11);
  } else {
    const lineupUpdates = buildQuickSimLineup(teamId, updatedPlayers, team.activeFormation);
    Object.keys(lineupUpdates).forEach(id => {
      updatedPlayers[id] = { ...updatedPlayers[id], ...lineupUpdates[id] };
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
      updatedPlayers[player.id] = { ...updatedPlayers[player.id], isSub: true };
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
        updatedPlayers[player.id] = { ...updatedPlayers[player.id], isSub: false };
      }
    });
    bench = keptBench;
  }
  return bench.slice(0, 7);
};

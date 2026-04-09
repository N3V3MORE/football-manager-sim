import { Player, Team } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { autoAssignLineup } from '../core/lineupEngine';
import { applyMatchResult } from '../core/teamUtils';

export type LiveMatchState = {
  initialized: boolean;
  yellowCardPlayerIds: string[];
  sentOffPlayerIds: string[];
  firstAttackIsHome?: boolean;
  sentOffMinutes?: Record<string, number>;
  homeGoalMinutes?: number[];
  awayGoalMinutes?: number[];
  homeStarterIds: string[];
  awayStarterIds: string[];
};

const LIVE_MATCH_MINUTES = 90;

export const getPossessionIndexForMinute = (minute: number) => {
  const current = Math.floor((minute * ENGINE_CONFIG.TOTAL_POSSESSIONS) / LIVE_MATCH_MINUTES);
  const previous = Math.floor(((minute - 1) * ENGINE_CONFIG.TOTAL_POSSESSIONS) / LIVE_MATCH_MINUTES);
  return current > previous ? current - 1 : null;
};

export const getPlayersByIds = (players: Record<string, Player>, ids: string[]) => (
  ids.map(id => players[id]).filter((player): player is Player => Boolean(player))
);

export const getEligibleStarters = (
  players: Record<string, Player>,
  teamId: string,
  sentOffPlayers: Set<string>
) => Object.values(players)
  .filter(player => (
    player.teamId === teamId &&
    player.isStarting &&
    player.matchesSuspended === 0 &&
    !sentOffPlayers.has(player.id)
  ));

export const ensureLiveTeamStarters = (
  teamId: string,
  teams: Record<string, Team>,
  players: Record<string, Player>,
  sentOffPlayers: Set<string>,
  allowAutoAssign: boolean
) => {
  let starters = getEligibleStarters(players, teamId, sentOffPlayers);
  if (!allowAutoAssign || starters.length >= 11) return starters;

  const team = teams[teamId];
  const lineupUpdates = autoAssignLineup(teamId, players, team.activeFormation);
  Object.entries(lineupUpdates).forEach(([playerId, updates]) => {
    players[playerId] = { ...players[playerId], ...updates };
  });
  starters = getEligibleStarters(players, teamId, sentOffPlayers);
  return starters;
};

export const drainLiveMatchEnergy = (players: Record<string, Player>, starters: Player[]) => {
  starters.forEach(player => {
    players[player.id] = {
      ...players[player.id],
      energy: Math.max(0, players[player.id].energy - ENGINE_CONFIG.ENERGY_DRAIN_PER_MINUTE),
    };
  });
};

export const removeLiveMatchFixture = (
  liveMatches: Record<string, LiveMatchState>,
  fixtureId: string
) => {
  const nextLiveMatches = { ...liveMatches };
  delete nextLiveMatches[fixtureId];
  return nextLiveMatches;
};

export const updateTeamStats = (team: Team, goalsFor: number, goalsAgainst: number) => {
  return applyMatchResult(team, goalsFor, goalsAgainst);
};

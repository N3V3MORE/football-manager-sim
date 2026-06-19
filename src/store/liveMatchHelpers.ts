import { Fixture, Player, Team, TeamTactics } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { autoAssignLineup } from '../core/lineupEngine';
import { applyMatchResult } from '../core/teamUtils';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { PlayerMatchContribution } from '../core/postMatchAccounting';

export type LiveMatchState = {
  initialized: boolean;
  yellowCardPlayerIds: string[];
  sentOffPlayerIds: string[];
  firstAttackIsHome?: boolean;
  sentOffMinutes?: Record<string, number>;
  homeGoalMinutes?: number[];
  awayGoalMinutes?: number[];
  matchContributions?: Record<string, PlayerMatchContribution>;
  homeStarterIds: string[];
  awayStarterIds: string[];
  currentHomePlayerIds?: string[];
  currentAwayPlayerIds?: string[];
  homeBenchIds?: string[];
  awayBenchIds?: string[];
  homeMinuteMap?: Record<string, number>;
  awayMinuteMap?: Record<string, number>;
  homeSubEntryMinutes?: Record<string, number>;
  awaySubEntryMinutes?: Record<string, number>;
  appliedSubstitutionCheckpoints?: number[];
  processedMinutes?: number[];
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
    !isPlayerUnavailable(player) &&
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

const getLiveEnergyDrainPerMinute = (teamTactics: TeamTactics) => {
  const drainMultiplier =
    (teamTactics.tempo === 'Fast' ? ENGINE_CONFIG.TEMPO_FAST_DRAIN_MULTIPLIER : 1.0) *
    (teamTactics.pressing === 'High' ? ENGINE_CONFIG.PRESSING_HIGH_DRAIN_MULTIPLIER : 1.0);
  return (ENGINE_CONFIG.BASE_POST_MATCH_ENERGY_DRAIN / 90) * drainMultiplier;
};

export const drainLiveMatchEnergy = (
  players: Record<string, Player>,
  starters: Player[],
  teamTactics: TeamTactics
) => {
  const drain = getLiveEnergyDrainPerMinute(teamTactics);
  starters.forEach(player => {
    players[player.id] = {
      ...players[player.id],
      energy: Math.max(0, players[player.id].energy - drain),
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

type LiveMatchRecoveryContext = {
  currentWeek: number;
  fixtures: Record<string, Fixture>;
  teams: Record<string, Team>;
  players: Record<string, Player>;
};

const liveMatchIdsBelongToTeam = (
  ids: unknown,
  teamId: string,
  players: Record<string, Player>
) => (
  Array.isArray(ids) &&
  ids.length > 0 &&
  ids.every(id => typeof id === 'string' && players[id]?.teamId === teamId)
);

export const isRecoverableLiveMatch = (
  fixtureId: string,
  liveState: Partial<LiveMatchState> | undefined,
  context: LiveMatchRecoveryContext
) => {
  const fixture = context.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed || fixture.week !== context.currentWeek) return false;
  if (!context.teams[fixture.homeTeamId] || !context.teams[fixture.awayTeamId]) return false;

  return Boolean(liveState) &&
    typeof liveState === 'object' &&
    liveMatchIdsBelongToTeam(liveState.homeStarterIds, fixture.homeTeamId, context.players) &&
    liveMatchIdsBelongToTeam(liveState.awayStarterIds, fixture.awayTeamId, context.players);
};

export const pruneInvalidLiveMatches = (
  liveMatches: Record<string, LiveMatchState>,
  context: LiveMatchRecoveryContext
) => Object.fromEntries(
  Object.entries(liveMatches).filter(([fixtureId, liveState]) => (
    isRecoverableLiveMatch(fixtureId, liveState, context)
  ))
) as Record<string, LiveMatchState>;

export const updateTeamStats = (
  team: Team,
  goalsFor: number,
  goalsAgainst: number,
  includeTableStats = true
) => {
  return applyMatchResult(team, goalsFor, goalsAgainst, includeTableStats);
};

import { Fixture, Player, PlayerCompetitionStats } from '../models/types';
import { PlayerCounterStat } from './matchTypes';
import { getFixtureCompetitionId, getFixtureLeagueId, isLeagueCompetitionId } from './domainRegistry';

export type PlayerStatsDataset = 'current' | 'previous';

export const createEmptyPlayerCompetitionStats = (): PlayerCompetitionStats => ({
  minutesPlayed: 0,
  goals: 0,
  assists: 0,
  cleanSheets: 0,
  yellowCards: 0,
  redCards: 0,
});

const cloneCompetitionStatsMap = (statsByScope?: Record<string, PlayerCompetitionStats>) => (
  Object.fromEntries(
    Object.entries(statsByScope || {}).map(([scopeId, stats]) => [scopeId, { ...createEmptyPlayerCompetitionStats(), ...stats }])
  )
);

const getDatasetMap = (player: Player, dataset: PlayerStatsDataset) => (
  dataset === 'previous' ? player.previousSeasonStatsByScope : player.seasonStatsByScope
);

export const getPlayerCompetitionStats = (
  player: Player,
  scopeId: string,
  dataset: PlayerStatsDataset = 'current'
) => ({
  ...createEmptyPlayerCompetitionStats(),
  ...(getDatasetMap(player, dataset)?.[scopeId] || {}),
});

export const hasRecordedCompetitionStats = (stats?: PlayerCompetitionStats | null) => {
  if (!stats) return false;
  return Object.values(stats).some((value: number) => value > 0);
};

export const getFixtureStatScopeId = (fixture: Fixture) => {
  const competitionId = getFixtureCompetitionId(fixture);
  if (!isLeagueCompetitionId(competitionId)) return competitionId;
  return getFixtureLeagueId(fixture) || competitionId;
};

export const ensurePlayerCompetitionStatsShape = (player: Player): Player => ({
  ...player,
  seasonStatsByScope: cloneCompetitionStatsMap(player.seasonStatsByScope),
  previousSeasonStatsByScope: cloneCompetitionStatsMap(player.previousSeasonStatsByScope),
});

const updateCurrentSeasonScope = (
  player: Player,
  scopeId: string,
  updater: (current: PlayerCompetitionStats) => PlayerCompetitionStats
) => {
  const currentScopeStats = getPlayerCompetitionStats(player, scopeId);
  return {
    ...player,
    seasonStatsByScope: {
      ...(player.seasonStatsByScope || {}),
      [scopeId]: updater(currentScopeStats),
    },
  };
};

export const recordPlayerScopedStat = (
  players: Record<string, Player>,
  playerId: string,
  scopeId: string,
  stat: PlayerCounterStat,
  amount = 1
) => {
  const player = players[playerId];
  if (!player) return;
  players[playerId] = updateCurrentSeasonScope(
    {
      ...player,
      [stat]: player[stat] + amount,
    },
    scopeId,
    current => ({
      ...current,
      [stat]: current[stat] + amount,
    })
  );
};

export const recordPlayerScopedMinutes = (
  players: Record<string, Player>,
  playerId: string,
  scopeId: string,
  minutes: number
) => {
  const player = players[playerId];
  if (!player || minutes <= 0) return;
  players[playerId] = updateCurrentSeasonScope(
    {
      ...player,
      minutesPlayed: (player.minutesPlayed || 0) + minutes,
    },
    scopeId,
    current => ({
      ...current,
      minutesPlayed: current.minutesPlayed + minutes,
    })
  );
};

export const resetPlayerSeasonStats = (player: Player): Player => ({
  ...player,
  matchesSuspended: 0,
  minutesPlayed: 0,
  goals: 0,
  assists: 0,
  cleanSheets: 0,
  yellowCards: 0,
  redCards: 0,
  previousSeasonStatsByScope: cloneCompetitionStatsMap(player.seasonStatsByScope),
  seasonStatsByScope: {},
});

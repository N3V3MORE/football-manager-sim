import { Player, PlayerCompetitionStats } from '@/src/models/types';
import { PlayerCounterStat } from '@/src/core/matchTypes';
import { getCompetitionDisplayName, getCompetitionSortRank, getLeagueDisplayName, getLeagueSortIndex, LEAGUE_DEFINITIONS } from '@/src/core/domainRegistry';
import { getPlayerCompetitionStats, hasRecordedCompetitionStats, PlayerStatsDataset } from '@/src/core/playerStats';

export type StatScopeOption = {
  id: string;
  label: string;
  type: 'league' | 'competition';
};

const isLeagueScopeId = (scopeId: string) => Boolean(LEAGUE_DEFINITIONS[scopeId]);

const buildScopeOption = (scopeId: string): StatScopeOption => ({
  id: scopeId,
  label: isLeagueScopeId(scopeId) ? getLeagueDisplayName(scopeId) : getCompetitionDisplayName(scopeId),
  type: isLeagueScopeId(scopeId) ? 'league' : 'competition',
});

export const getScopeOptionsForDataset = (
  players: Record<string, Player>,
  dataset: PlayerStatsDataset
) => {
  const scopeIds = new Set<string>();

  Object.values(players).forEach(player => {
    const statsMap = dataset === 'previous' ? player.previousSeasonStatsByScope : player.seasonStatsByScope;
    Object.entries(statsMap || {}).forEach(([scopeId, stats]) => {
      if (hasRecordedCompetitionStats(stats)) scopeIds.add(scopeId);
    });
  });

  return [...scopeIds]
    .map(buildScopeOption)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'league' ? -1 : 1;
      if (left.type === 'league' && right.type === 'league') {
        return getLeagueSortIndex(left.id) - getLeagueSortIndex(right.id);
      }
      return getCompetitionSortRank(left.id) - getCompetitionSortRank(right.id);
    });
};

export const resolveStatsView = ({
  players,
  currentLeagueId,
  previousLeagueId,
}: {
  players: Record<string, Player>;
  currentLeagueId?: string | null;
  previousLeagueId?: string | null;
}) => {
  const currentScopeOptions = getScopeOptionsForDataset(players, 'current');
  if (currentScopeOptions.length > 0) {
    const defaultScopeId = currentScopeOptions.find(option => option.id === currentLeagueId)?.id || currentScopeOptions[0].id;
    return { dataset: 'current' as const, scopeOptions: currentScopeOptions, defaultScopeId };
  }

  const previousScopeOptions = getScopeOptionsForDataset(players, 'previous');
  const defaultScopeId = previousScopeOptions.find(option => option.id === previousLeagueId)?.id
    || previousScopeOptions.find(option => option.id === currentLeagueId)?.id
    || previousScopeOptions[0]?.id
    || null;

  return { dataset: 'previous' as const, scopeOptions: previousScopeOptions, defaultScopeId };
};

export const getPlayerStatValueForScope = (
  player: Player,
  scopeId: string,
  stat: keyof PlayerCompetitionStats,
  dataset: PlayerStatsDataset
) => getPlayerCompetitionStats(player, scopeId, dataset)[stat];

export const getRankedPlayersForScope = (
  players: Player[],
  scopeId: string,
  stat: PlayerCounterStat,
  dataset: PlayerStatsDataset,
  options?: {
    limit?: number;
    filter?: (player: Player) => boolean;
  }
) => {
  const filteredPlayers = (options?.filter ? players.filter(options.filter) : players).filter(player => (
    getPlayerStatValueForScope(player, scopeId, stat, dataset) > 0
  ));

  return filteredPlayers
    .sort((left, right) => (
      getPlayerStatValueForScope(right, scopeId, stat, dataset) - getPlayerStatValueForScope(left, scopeId, stat, dataset)
      || right.overallRating - left.overallRating
      || left.name.localeCompare(right.name)
    ))
    .slice(0, options?.limit || 10);
};

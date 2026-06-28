import { Player, Team, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { applyTacticalAdaptation } from './tacticalAdaptationEngine';
import { getSeasonWeekLimit } from './leagueUtils';
import { RandomGenerator, resolveRandom } from './random';
import { computeMarketValue } from '../utils/calendar';
import { isPlayerUnavailable } from './playerStatusUtils';
import { FREE_AGENT_TEAM_ID, isPlayableClub } from './freeAgentPool';
import { computeWeeklyTraining } from './trainingEngine';
import { getWeeklyRevenueBreakdown } from './financeEngine';
import { calculateImpactCoefficient, clampRating } from './playerRatingUtils';

export { computeWeeklyTransfers } from './transferEngine';

const MAX_ACTIVE_SUBS = 7;

const applyRatingDeltaToMatchStats = (player: Player, ratingDelta: number, rng: () => number): Player['stats'] => {
  if (ratingDelta === 0) return player.stats;

  const keys = player.position === 'GK'
    ? ['gk_diving', 'gk_handling', 'gk_kicking', 'gk_reflexes', 'gk_speed', 'gk_positioning'] as const
    : ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'] as const;
  const nextStats = { ...player.stats };
  const steps = Math.abs(ratingDelta);
  const direction = ratingDelta > 0 ? 1 : -1;
  const weightedKeys = keys.flatMap(key => {
    if (player.position === 'GK') {
      return key === 'gk_reflexes' || key === 'gk_positioning' ? [key, key] : [key];
    }
    if (player.position === 'DEF') return key === 'defending' || key === 'physical' ? [key, key] : [key];
    if (player.position === 'MID') return key === 'passing' || key === 'dribbling' ? [key, key] : [key];
    return key === 'shooting' || key === 'pace' ? [key, key] : [key];
  });

  for (let step = 0; step < steps; step += 1) {
    const key = weightedKeys[Math.floor(rng() * weightedKeys.length)] || keys[0];
    const value = nextStats[key];
    if (typeof value === 'number') nextStats[key] = clampRating(value + direction);
  }

  return nextStats;
};

const getAverageRecentRating = (player: Player) => {
  const ratings = player.matchRatingHistory || [];
  if (ratings.length === 0) return 6.5;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
};

const getSeasonProgressionDelta = (
  player: Player,
  team: Team | undefined,
  totalClubMatches: number | undefined,
  rng: () => number
) => {
  const teamMinutes = Math.max(1, (totalClubMatches ?? team?.played ?? 0) * 90);
  const minutesShare = Math.min(1, (player.minutesPlayed || 0) / teamMinutes);
  const recentRating = getAverageRecentRating(player);
  const performanceBoost = Math.max(-0.16, Math.min(0.18, (recentRating - 6.6) * 0.08));
  const minutesBoost = Math.max(-0.12, Math.min(0.16, (minutesShare - 0.35) * 0.28));
  const eliteDrag = player.overallRating >= 86 ? 0.26 : player.overallRating >= 80 ? 0.14 : 0;

  if (player.age <= 24) {
    const baseChance = player.age <= 20 ? 0.62 : 0.42;
    const chance = Math.max(0.08, Math.min(0.78, baseChance + performanceBoost + minutesBoost - eliteDrag));
    if (rng() > chance) return 0;
    const secondPointChance = Math.max(0.02, Math.min(0.22, 0.12 + performanceBoost + minutesBoost - eliteDrag));
    return 1 + (rng() < secondPointChance ? 1 : 0);
  }

  if (player.age <= 31) {
    const improveChance = Math.max(0.02, Math.min(0.22, 0.06 + performanceBoost + minutesBoost * 0.5 - eliteDrag));
    const declineChance = Math.max(0.02, Math.min(0.18, 0.05 - performanceBoost - minutesBoost * 0.3));
    const roll = rng();
    if (roll < improveChance) return 1;
    if (roll > 1 - declineChance) return -1;
    return 0;
  }

  const ageDecline = player.age >= 35 ? 0.42 : player.age >= 33 ? 0.28 : 0.16;
  const declineChance = Math.max(0.04, Math.min(0.72, ageDecline - performanceBoost - minutesBoost * 0.2));
  if (rng() > declineChance) return 0;
  return rng() < Math.max(0.04, (player.age - 34) * 0.04) ? -2 : -1;
};

const trimActiveSubstitutes = (
  players: Record<string, Player>,
  teams: Record<string, Team>
) => {
  Object.values(teams).filter(isPlayableClub).forEach(team => {
    const teamId = team.id;
    Object.values(players)
      .filter(player => player.teamId === teamId && player.isStarting && player.isSub)
      .forEach(player => {
        players[player.id] = { ...players[player.id], isSub: false };
      });

    // Enforce max 11 starters: if a team somehow has more, demote the lowest-rated extras.
    // Preserve one starting GK when present so trimming cannot leave a side without a keeper.
    const activeStarters = Object.values(players)
      .filter(player => player.teamId === teamId && player.isStarting)
      .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1));
    if (activeStarters.length > 11) {
      const startingGoalkeeper = activeStarters.find(player => player.position === 'GK');
      const keepIds = new Set((startingGoalkeeper
        ? [startingGoalkeeper, ...activeStarters.filter(player => player.position !== 'GK').slice(0, 10)]
        : activeStarters.slice(0, 11)
      ).map(player => player.id));

      activeStarters.forEach(player => {
        if (!keepIds.has(player.id)) {
          players[player.id] = { ...players[player.id], isStarting: false };
        }
      });
    }

    const activeSubs = Object.values(players)
      .filter(player => player.teamId === teamId && player.isSub && !isPlayerUnavailable(player))
      .sort((a, b) => {
        const scoreDelta = (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1);
        if (scoreDelta !== 0) return scoreDelta;
        return a.name.localeCompare(b.name);
      });

    activeSubs.slice(MAX_ACTIVE_SUBS).forEach(player => {
      players[player.id] = { ...players[player.id], isSub: false };
    });
  });
};

export const computeWeeklyProgression = (
  currentWeek: number,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  oldNews: string[],
  userTeamId: string | null = null,
  rng?: RandomGenerator,
  seasonWeekLimitOverride?: number
): {
  players: Record<string, Player>;
  teams: Record<string, Team>;
  currentWeek: number;
  news: string[];
  generatedNews: string[];
} => {
  const random = resolveRandom(rng);
  const playedFixtures = Object.values(fixtures).filter(f => f.week === currentWeek && f.isPlayed && f.resolution !== 'void');
  const seasonWeekLimit = seasonWeekLimitOverride ?? getSeasonWeekLimit(fixtures);
  const newNews: string[] = [];
  
  const userTeam = userTeamId ? teams[userTeamId] : null;
  const userDivision = userTeam ? userTeam.division : undefined;

  const bigWins = playedFixtures.filter(f => {
    const homeTeam = teams[f.homeTeamId];
    if (!f.isPlayed || f.homeScore === null || f.awayScore === null) return false;
    if (userDivision && homeTeam && homeTeam.division !== userDivision) return false;
    return Math.abs(f.homeScore - f.awayScore) >= 3;
  });
  if (bigWins.length > 0) {
    const fixture = bigWins[Math.floor(random() * bigWins.length)];
    const winner = (fixture.homeScore! > fixture.awayScore!) ? teams[fixture.homeTeamId] : teams[fixture.awayTeamId];
    const loser = (fixture.homeScore! > fixture.awayScore!) ? teams[fixture.awayTeamId] : teams[fixture.homeTeamId];
    const winningScore = Math.max(fixture.homeScore!, fixture.awayScore!);
    const losingScore = Math.min(fixture.homeScore!, fixture.awayScore!);
    newNews.push(`${winner.name} thrashes ${loser.name} ${winningScore}-${losingScore}!`);
  }

  const allPlayers = Object.values(players);
  const updatedPlayers = { ...players };
  allPlayers.forEach(player => {
    const newEnergy = Math.min(100, player.energy + ENGINE_CONFIG.WEEKLY_ENERGY_RECOVERY);
    const shouldDecrementInjury = !player.injuryAppliedWeek || player.injuryAppliedWeek < currentWeek;
    const newInjuryWeeks = shouldDecrementInjury ? Math.max(0, (player.injuryWeeks || 0) - 1) : (player.injuryWeeks || 0);
    if (
      newEnergy !== player.energy ||
      newInjuryWeeks !== (player.injuryWeeks || 0)
    ) {
      updatedPlayers[player.id] = {
        ...player,
        energy: newEnergy,
        injuryWeeks: newInjuryWeeks,
        injuryType: newInjuryWeeks > 0 ? player.injuryType : undefined,
      };
    }
  });

  Object.values(updatedPlayers).forEach(player => {
    const team = teams[player.teamId];
    if (!team || !isPlayableClub(team)) return;
    const currentPlayer = updatedPlayers[player.id];
    const trainingPatch = computeWeeklyTraining(
      currentPlayer,
      team,
      currentWeek,
      random,
      team.id === userTeamId ? undefined : { xpMultiplier: 0.65, focusOverride: null }
    );
    if (Object.keys(trainingPatch).length > 0) {
      updatedPlayers[player.id] = {
        ...currentPlayer,
        ...trainingPatch,
      };
    }
  });
  trimActiveSubstitutes(updatedPlayers, teams);

  const updatedTeams = { ...teams };
  Object.values(updatedTeams).filter(isPlayableClub).forEach(team => {
    const teamPlayers = Object.values(updatedPlayers).filter(player => player.teamId === team.id);
    const weeklyWageTotalThousand = teamPlayers.reduce((sum, player) => sum + (player.wage || 0), 0);
    const wageCostM = weeklyWageTotalThousand / 1000;

    // Use operatingBudget if present; fall back to budget for backward-compatible saves.
    const operatingBudget = team.operatingBudget !== undefined ? team.operatingBudget : team.budget;
    let newOperatingBudget = operatingBudget - wageCostM;

    const weeklyRevenue = getWeeklyRevenueBreakdown(team, playedFixtures);
    newOperatingBudget += weeklyRevenue.total;

    // Transfer budget (team.budget) stays stable; only operating cash fluctuates weekly.
    updatedTeams[team.id] = {
      ...team,
      operatingBudget: Math.max(0, newOperatingBudget),
    };
  });

  applyTacticalAdaptation(
    updatedPlayers,
    updatedTeams,
    new Set([...(userTeamId ? [userTeamId] : []), FREE_AGENT_TEAM_ID]),
    rng
  );

  const divisionPlayers = userDivision 
    ? allPlayers.filter(p => teams[p.teamId]?.division === userDivision)
    : allPlayers;
  const sortedByGoals = [...divisionPlayers].sort((a, b) => b.goals - a.goals);
  if (sortedByGoals.length > 0 && sortedByGoals[0].goals > 0) {
    const top = sortedByGoals[0];
    newNews.push(`${top.name} (${teams[top.teamId]?.name}) leads the golden boot with ${top.goals} goals.`);
    if (random() > 0.5 && sortedByGoals.length > 1) {
      const contenderCount = Math.min(3, sortedByGoals.length - 1);
      const other = sortedByGoals[1 + Math.floor(random() * contenderCount)];
      if (other && other.goals > 0) {
        newNews.push(`${other.name} continues his excellent form for ${teams[other.teamId]?.name}!`);
      }
    }
  } else if (playedFixtures.length > 0) {
    newNews.push(`Week ${currentWeek} concludes with intense scenes across the league.`);
  }

  if (currentWeek === seasonWeekLimit) {
    const playedMatchesByTeam = Object.values(fixtures).reduce<Record<string, number>>((counts, fixture) => {
      if (!fixture.isPlayed || fixture.resolution === 'void') return counts;
      counts[fixture.homeTeamId] = (counts[fixture.homeTeamId] || 0) + 1;
      counts[fixture.awayTeamId] = (counts[fixture.awayTeamId] || 0) + 1;
      return counts;
    }, {});
    Object.values(updatedPlayers).forEach(player => {
      const team = updatedTeams[player.teamId];
      const delta = getSeasonProgressionDelta(player, team, playedMatchesByTeam[player.teamId], random);
      const potential = typeof player.potential === 'number' && Number.isFinite(player.potential)
        ? Math.max(1, Math.min(99, player.potential))
        : undefined;
      let overallRating = player.overallRating + delta;
      if (delta > 0 && potential !== undefined) {
        overallRating = Math.min(overallRating, potential);
      }
      overallRating = Math.max(1, Math.min(99, overallRating));

      const nextAge = player.age + 1;
      const ratingDelta = overallRating - player.overallRating;

      updatedPlayers[player.id] = {
        ...player,
        overallRating,
        age: nextAge,
        contractLeft: Math.max(0, player.contractLeft - 1),
        stats: applyRatingDeltaToMatchStats(player, ratingDelta, random),
        marketValue: computeMarketValue(overallRating, nextAge),
        impactCoefficient: calculateImpactCoefficient(overallRating),
      };
    });
    newNews.push('The season has concluded! Check your squad for player growth and updates.');
  }

  return {
    currentWeek: currentWeek + 1,
    news: [...newNews, ...oldNews].slice(0, 20),
    generatedNews: newNews,
    players: updatedPlayers,
    teams: updatedTeams,
  };
};

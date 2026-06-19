import { Player, Team, Fixture, Position } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { applyTacticalAdaptation } from './tacticalAdaptationEngine';
import { getSeasonWeekLimit } from './leagueUtils';
import { RandomGenerator, resolveRandom } from './random';
import { computeMarketValue } from '../utils/calendar';
import { isPlayerUnavailable } from './playerStatusUtils';

export { computeWeeklyTransfers } from './transferEngine';

const clampRating = (value: number) => Math.max(1, Math.min(99, Math.round(value)));
const MAX_ACTIVE_SUBS = 7;

const calculateImpactCoefficient = (overallRating: number) => {
  if (overallRating >= 88) return 1.5 + ((overallRating - 88) * 0.15);
  if (overallRating >= 84) return 1.1 + ((overallRating - 84) * 0.08);
  return 0.9 + ((overallRating - 70) * 0.01);
};

const applyRatingDeltaToMatchStats = (player: Player, ratingDelta: number): Player['stats'] => {
  if (ratingDelta === 0) return player.stats;

  const keys = player.position === 'GK'
    ? ['gk_diving', 'gk_handling', 'gk_kicking', 'gk_reflexes', 'gk_speed', 'gk_positioning'] as const
    : ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'] as const;
  const nextStats = { ...player.stats };

  keys.forEach(key => {
    const value = nextStats[key];
    if (typeof value === 'number') nextStats[key] = clampRating(value + ratingDelta);
  });

  return nextStats;
};

const trimActiveSubstitutes = (
  players: Record<string, Player>,
  teams: Record<string, Team>
) => {
  Object.keys(teams).forEach(teamId => {
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

/** Minimal squad-size threshold below which a team receives youth intake. */
const MIN_SQUAD_THRESHOLD = 16;
/** Number of youth players generated per underfilled team at season end. */
const YOUTH_INTAKE_COUNT = 2;

const YOUTH_FIRST_NAMES = ['Alex', 'Ben', 'Callum', 'Dan', 'Ethan', 'Finn', 'George', 'Harry', 'Isaac', 'Jack'];
const YOUTH_LAST_NAMES = ['Adams', 'Brown', 'Clark', 'Davies', 'Evans', 'Fisher', 'Green', 'Harris', 'Irvine', 'Jones'];

const getNextPlayerId = (players: Record<string, Player>): string => {
  let maxId = 0;
  for (const id of Object.keys(players)) {
    const num = parseInt(id, 10);
    if (!isNaN(num) && num > maxId) maxId = num;
  }
  return (maxId + 1).toString();
};

const generateYouthPlayer = (
  playerId: string,
  teamId: string,
  position: Position,
  rng: () => number
): Player => {
  const firstName = YOUTH_FIRST_NAMES[Math.floor(rng() * YOUTH_FIRST_NAMES.length)];
  const lastName = YOUTH_LAST_NAMES[Math.floor(rng() * YOUTH_LAST_NAMES.length)];
  const age = 16 + Math.floor(rng() * 3); // 16–18
  const rating = 40 + Math.floor(rng() * 16); // 40–55
  const marketValue = computeMarketValue(rating, age);

  const baseStats = {
    pace: 40 + Math.floor(rng() * 30),
    shooting: 35 + Math.floor(rng() * 25),
    passing: 35 + Math.floor(rng() * 30),
    dribbling: 35 + Math.floor(rng() * 30),
    defending: 35 + Math.floor(rng() * 25),
    physical: 40 + Math.floor(rng() * 30),
  };

  let stats: Player['stats'];
  let subPosition: string;
  let altPositions: string[];
  switch (position) {
    case 'GK':
      stats = {
        ...baseStats,
        shooting: 10 + Math.floor(rng() * 15),
        gk_diving: 40 + Math.floor(rng() * 40),
        gk_handling: 40 + Math.floor(rng() * 40),
        gk_kicking: 35 + Math.floor(rng() * 35),
        gk_reflexes: 40 + Math.floor(rng() * 40),
        gk_speed: 35 + Math.floor(rng() * 35),
        gk_positioning: 40 + Math.floor(rng() * 40),
      };
      subPosition = 'GK';
      altPositions = ['GK'];
      break;
    case 'DEF':
      stats = { ...baseStats, defending: baseStats.defending + 15, physical: baseStats.physical + 10 };
      subPosition = 'CB';
      altPositions = ['CB', 'RB', 'LB'];
      break;
    case 'MID':
      stats = { ...baseStats, passing: baseStats.passing + 15, dribbling: baseStats.dribbling + 10 };
      subPosition = 'CM';
      altPositions = ['CM', 'CDM', 'CAM'];
      break;
    case 'FWD':
    default:
      stats = { ...baseStats, shooting: baseStats.shooting + 15, pace: baseStats.pace + 10 };
      subPosition = 'ST';
      altPositions = ['ST', 'LW', 'RW'];
      break;
  }

  return {
    id: playerId,
    name: `${firstName} ${lastName}`,
    position,
    subPosition,
    altPositions,
    overallRating: rating,
    marketValue,
    age,
    morale: 70 + Math.floor(rng() * 21),
    energy: 95 + Math.floor(rng() * 6),
    teamId,
    isStarting: false,
    isSub: false,
    isTransferListed: false,
    askingPrice: 0,
    matchesSuspended: 0,
    injuryWeeks: 0,
    wage: Math.max(1, Math.floor(marketValue * 0.8) + 1),
    contractLeft: 1 + Math.floor(rng() * 3),
    impactCoefficient: calculateImpactCoefficient(rating),
    matchRatingHistory: [],
    minutesPlayed: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
    nationality: 'English',
    stats,
  };
};

/**
 * Replenish squads that have fallen below the minimum threshold.
 * Returns new players that should be added to the player pool.
 */
const replenishUnderfilledSquads = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  rng: () => number
): Record<string, Player> => {
  const nextPlayers = { ...players };
  let nextId = parseInt(getNextPlayerId(players), 10);
  const positions: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

  Object.values(teams).forEach(team => {
    const squadSize = Object.values(nextPlayers).filter(p => p.teamId === team.id).length;
    if (squadSize >= MIN_SQUAD_THRESHOLD) return;

    const intake = Math.min(YOUTH_INTAKE_COUNT, MIN_SQUAD_THRESHOLD - squadSize);
    for (let i = 0; i < intake; i++) {
      const position = positions[Math.floor(rng() * positions.length)];
      const playerId = (nextId++).toString();
      nextPlayers[playerId] = generateYouthPlayer(playerId, team.id, position, rng);
    }
  });

  return nextPlayers;
};

export const computeWeeklyProgression = (
  currentWeek: number,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  oldNews: string[],
  userTeamId: string | null = null,
  rng?: RandomGenerator
): {
  players: Record<string, Player>;
  teams: Record<string, Team>;
  currentWeek: number;
  news: string[];
  generatedNews: string[];
} => {
  const random = resolveRandom(rng);
  const playedFixtures = Object.values(fixtures).filter(f => f.week === currentWeek);
  const seasonWeekLimit = getSeasonWeekLimit(fixtures);
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
  // Only decrement suspensions for teams that actually played a fixture this week.
  const teamsWithFixtureThisWeek = new Set(playedFixtures
    .filter(f => f.isPlayed)
    .flatMap(f => [f.homeTeamId, f.awayTeamId]));
  allPlayers.forEach(player => {
    const newEnergy = Math.min(100, player.energy + ENGINE_CONFIG.WEEKLY_ENERGY_RECOVERY);
    const playerTeamPlayed = teamsWithFixtureThisWeek.has(player.teamId);
    const shouldDecrementSuspension = playerTeamPlayed && (!player.suspensionAppliedWeek || player.suspensionAppliedWeek < currentWeek);
    const shouldDecrementInjury = !player.injuryAppliedWeek || player.injuryAppliedWeek < currentWeek;
    const newSuspension = shouldDecrementSuspension ? Math.max(0, player.matchesSuspended - 1) : player.matchesSuspended;
    const newInjuryWeeks = shouldDecrementInjury ? Math.max(0, (player.injuryWeeks || 0) - 1) : (player.injuryWeeks || 0);
    if (
      newEnergy !== player.energy ||
      newSuspension !== player.matchesSuspended ||
      newInjuryWeeks !== (player.injuryWeeks || 0)
    ) {
      updatedPlayers[player.id] = {
        ...player,
        energy: newEnergy,
        matchesSuspended: newSuspension,
        injuryWeeks: newInjuryWeeks,
        injuryType: newInjuryWeeks > 0 ? player.injuryType : undefined,
      };
    }
  });
  trimActiveSubstitutes(updatedPlayers, teams);

  const updatedTeams = { ...teams };
  Object.values(updatedTeams).forEach(team => {
    const teamPlayers = Object.values(updatedPlayers).filter(player => player.teamId === team.id);
    const weeklyWageTotalThousand = teamPlayers.reduce((sum, player) => sum + (player.wage || 0), 0);
    const wageCostM = weeklyWageTotalThousand / 1000;

    // Use operatingBudget if present; fall back to budget for backward-compatible saves.
    const operatingBudget = team.operatingBudget !== undefined ? team.operatingBudget : team.budget;
    let newOperatingBudget = operatingBudget - wageCostM;

    const homeFixture = playedFixtures.find(fixture => fixture.homeTeamId === team.id);
    if (homeFixture) {
      newOperatingBudget += 1.0 + (team.points * 0.05);
    }

    // Transfer budget (team.budget) stays stable; only operating cash fluctuates weekly.
    updatedTeams[team.id] = {
      ...team,
      operatingBudget: Math.max(0, newOperatingBudget),
    };
  });

  applyTacticalAdaptation(
    updatedPlayers,
    updatedTeams,
    userTeamId ? new Set([userTeamId]) : new Set<string>(),
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
    Object.values(updatedPlayers).forEach(player => {
      let overallRating = player.overallRating;
      if (player.age <= 24) {
        overallRating += Math.floor(random() * 3) + 1;
      } else if (player.age >= 32) {
        overallRating -= Math.floor(random() * 2);
      }
      overallRating = Math.max(1, Math.min(99, overallRating));

      const nextAge = player.age + 1;
      const ratingDelta = overallRating - player.overallRating;

      updatedPlayers[player.id] = {
        ...player,
        overallRating,
        age: nextAge,
        contractLeft: Math.max(0, player.contractLeft - 1),
        stats: applyRatingDeltaToMatchStats(player, ratingDelta),
        marketValue: computeMarketValue(overallRating, nextAge),
        impactCoefficient: calculateImpactCoefficient(overallRating),
      };
    });
    newNews.push('The season has concluded! Check your squad for player growth and updates.');

    // Replenish underfilled squads with youth intake to prevent long-term population collapse.
    const replenishedPlayers = replenishUnderfilledSquads(updatedPlayers, updatedTeams, random);
    const newYouthCount = Object.keys(replenishedPlayers).length - Object.keys(updatedPlayers).length;
    if (newYouthCount > 0) {
      newNews.push(`${newYouthCount} academy graduate${newYouthCount !== 1 ? 's' : ''} promoted to first-team squads.`);
    }
    // Merge replenished players into updatedPlayers.
    Object.keys(replenishedPlayers).forEach(id => {
      if (!updatedPlayers[id]) {
        updatedPlayers[id] = replenishedPlayers[id];
      }
    });
  }

  return {
    currentWeek: currentWeek + 1,
    news: [...newNews, ...oldNews].slice(0, 20),
    generatedNews: newNews,
    players: updatedPlayers,
    teams: updatedTeams,
  };
};

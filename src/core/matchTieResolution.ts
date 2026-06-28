import { PenaltyShootout, Player, Team } from '../models/types';
import { RandomGenerator, resolveRandom } from './random';
import { clamp } from './matchUtils';
import { getTraitBonuses } from './traitEngine';

const getPenaltySkill = (player: Player) => (
  (player.stats.mentality_penalties ??
    player.stats.penalties ??
    player.stats.shooting ??
    player.overallRating) + getTraitBonuses(player).penaltyBonus
);

const getGoalkeeperPenaltySkill = (player?: Player) => {
  if (!player) return 58;
  if (player.position !== 'GK') return Math.max(45, player.stats.defending || player.overallRating * 0.7);
  return (
    (player.stats.gk_reflexes || player.overallRating) * 0.48 +
    (player.stats.gk_positioning || player.overallRating) * 0.34 +
    (player.stats.gk_handling || player.overallRating) * 0.18
  );
};

const getPenaltyTakers = (players: Player[]) => {
  const eligible = players.length > 0 ? players : [];
  return [...eligible].sort((left, right) => {
    const skillDelta = getPenaltySkill(right) - getPenaltySkill(left);
    if (skillDelta !== 0) return skillDelta;
    return right.overallRating - left.overallRating;
  });
};

const pickTaker = (takers: Player[], index: number) => (
  takers[index % Math.max(1, takers.length)]
);

const pickGoalkeeper = (players: Player[]) => (
  players.find(player => player.position === 'GK') || players[0]
);

const getShootoutEdge = (
  takers: Player[],
  targetCount: number,
  homeAdvantage = 1
) => {
  const selected = [...takers]
    .slice(0, targetCount);
  return selected.reduce((sum, player) => sum + getPenaltySkill(player), 0) * homeAdvantage;
};

const shouldStopFiveKickPhase = (
  round: number,
  homeScore: number,
  awayScore: number,
  nextTeam: 'home' | 'away'
) => {
  if (round > 5) return false;
  const homeTaken = nextTeam === 'home' ? round - 1 : round;
  const awayTaken = round - 1;
  const homeRemaining = 5 - homeTaken;
  const awayRemaining = 5 - awayTaken;
  return homeScore > awayScore + awayRemaining || awayScore > homeScore + homeRemaining;
};

export const simulatePenaltyShootout = (
  homeTeam: Team,
  awayTeam: Team,
  homePlayers: Player[],
  awayPlayers: Player[],
  rng: RandomGenerator,
  homeAdvantage = 1
): PenaltyShootout => {
  const random = resolveRandom(rng);
  const homeTakers = getPenaltyTakers(homePlayers);
  const awayTakers = getPenaltyTakers(awayPlayers);
  const homeGoalkeeper = pickGoalkeeper(homePlayers);
  const awayGoalkeeper = pickGoalkeeper(awayPlayers);
  let homeScore = 0;
  let awayScore = 0;
  const kicks: PenaltyShootout['kicks'] = [];

  const takeKick = (team: 'home' | 'away', round: number) => {
    const isHome = team === 'home';
    const taker = pickTaker(isHome ? homeTakers : awayTakers, round - 1);
    const goalkeeper = isHome ? awayGoalkeeper : homeGoalkeeper;
    const takerSkill = (getPenaltySkill(taker) * (isHome ? homeAdvantage : 1)) + ((taker.impactCoefficient || 1) - 1) * 4;
    const keeperSkill = getGoalkeeperPenaltySkill(goalkeeper);
    const scoreChance = clamp(0.74 + ((takerSkill - keeperSkill) / 260), 0.55, 0.92);
    const scored = random() < scoreChance;
    if (scored) {
      if (isHome) homeScore += 1;
      else awayScore += 1;
    }
    const outcome = scored
      ? 'goal'
      : (random() < 0.62 ? 'save' : 'miss');

    kicks.push({
      round,
      teamId: isHome ? homeTeam.id : awayTeam.id,
      takerPlayerId: taker.id,
      goalkeeperPlayerId: goalkeeper?.id,
      outcome,
      homeScore,
      awayScore,
    });
  };

  for (let round = 1; round <= 5; round += 1) {
    takeKick('home', round);
    if (shouldStopFiveKickPhase(round, homeScore, awayScore, 'away')) break;
    takeKick('away', round);
    if (shouldStopFiveKickPhase(round + 1, homeScore, awayScore, 'home')) break;
  }

  let suddenDeathRound = 6;
  while (homeScore === awayScore && suddenDeathRound <= 20) {
    takeKick('home', suddenDeathRound);
    takeKick('away', suddenDeathRound);
    suddenDeathRound += 1;
  }

  if (homeScore === awayScore) {
    const targetCount = Math.max(1, Math.min(homeTakers.length, awayTakers.length));
    const homeEdge = getShootoutEdge(homeTakers, targetCount, homeAdvantage);
    const awayEdge = getShootoutEdge(awayTakers, targetCount, 1);
    const totalEdge = Math.max(1, homeEdge + awayEdge);
    const winnerTeamId = (random() * totalEdge) < homeEdge ? homeTeam.id : awayTeam.id;
    if (winnerTeamId === homeTeam.id) homeScore += 1;
    else awayScore += 1;
    kicks.push({
      round: suddenDeathRound,
      teamId: winnerTeamId,
      takerPlayerId: (winnerTeamId === homeTeam.id ? homeTakers[0] : awayTakers[0]).id,
      goalkeeperPlayerId: (winnerTeamId === homeTeam.id ? awayGoalkeeper : homeGoalkeeper)?.id,
      outcome: 'goal',
      homeScore,
      awayScore,
    });
  }

  return {
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    winnerTeamId: homeScore > awayScore ? homeTeam.id : awayTeam.id,
    homeScore,
    awayScore,
    kicks,
  };
};

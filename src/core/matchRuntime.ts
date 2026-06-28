import { Team, Player } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import type { TeamShapeProfile } from './matchTypes';
import { buildFallbackShapeProfile, buildTeamShapeProfile } from './shapeEngine';
import { RandomGenerator, resolveRandom } from './random';
import {
  avgStat,
  clamp,
  getMoraleModifier,
  getRoleGroups,
  inferRoleTag,
  runDuel,
  scaleLineupForMatch,
  weightedPick,
} from './matchUtils';
import { simulatePenaltyShootout } from './matchTieResolution';
import {
  getCompatiblePlayerRoleForTeamSlot,
  getRoleStatBonus,
  getRoleWeightMultiplier,
} from './playerRoleEngine';

const LOW_INTENSITY_COMMENTARY_CHANCE = 0.04;

export const buildCurrentMatchProfile = (
  team: Team,
  players: Player[],
  formMultiplier: number,
  homeAdvantage: number,
  designatedGoalkeeperId?: string
) => {
  const designatedPlayers = players.map(player => {
    if (player.id !== designatedGoalkeeperId || player.position === 'GK') return player;
    const emergencyKeeperBase = Math.max(player.stats.defending || 50, player.stats.physical || 50, player.overallRating * 0.75);
    return {
      ...player,
      position: 'GK' as const,
      subPosition: 'GK',
      altPositions: Array.from(new Set(['GK', ...(player.altPositions || [])])),
      stats: {
        ...player.stats,
        gk_diving: player.stats.gk_diving || emergencyKeeperBase,
        gk_handling: player.stats.gk_handling || emergencyKeeperBase * 0.92,
        gk_kicking: player.stats.gk_kicking || player.stats.passing || emergencyKeeperBase,
        gk_reflexes: player.stats.gk_reflexes || emergencyKeeperBase,
        gk_speed: player.stats.gk_speed || player.stats.pace || emergencyKeeperBase,
        gk_positioning: player.stats.gk_positioning || emergencyKeeperBase * 0.9,
      },
    };
  });
  const moraleMultiplier = getMoraleModifier(players);
  const scaled = scaleLineupForMatch(designatedPlayers, formMultiplier, moraleMultiplier, homeAdvantage, team.clubClass);
  return {
    scaled,
    shape: buildTeamShapeProfile(team, designatedPlayers),
  };
};

export const resolvePenaltyShootoutWinner = (
  homeTeam: Team,
  awayTeam: Team,
  homePlayers: Player[],
  awayPlayers: Player[],
  rng: RandomGenerator,
  homeAdvantage = 1
) => {
  return simulatePenaltyShootout(homeTeam, awayTeam, homePlayers, awayPlayers, rng, homeAdvantage).winnerTeamId;
};

const getPossessionControlScore = (
  team: Team,
  players: Player[],
  shape: TeamShapeProfile
) => {
  const passing = avgStat(players, player => player.stats.passing || 60, 60);
  const dribbling = avgStat(players, player => player.stats.dribbling || 55, 55);
  const midfieldLoad = shape.lineLoad.mid + (shape.lineLoad.fwd * 0.35);
  const mentalityBonus = team.tactics.mentality === 'Attacking'
    ? 2.5
    : (team.tactics.mentality === 'Defensive' ? -1.5 : 0);
  return Math.max(1, (passing * 0.68) + (dribbling * 0.22) + (midfieldLoad * 1.8) + mentalityBonus);
};

export const selectPossessionAttacker = (
  homeTeam: Team,
  awayTeam: Team,
  homePlayers: Player[],
  awayPlayers: Player[],
  homeShape: TeamShapeProfile,
  awayShape: TeamShapeProfile,
  rng: RandomGenerator
) => {
  const homeControl = getPossessionControlScore(homeTeam, homePlayers, homeShape);
  const awayControl = getPossessionControlScore(awayTeam, awayPlayers, awayShape);
  const homeShare = clamp(homeControl / Math.max(1, homeControl + awayControl), 0.42, 0.58);
  return rng.next() < homeShare;
};

const pickCommentary = (random: () => number, options: string[]) => (
  options[Math.floor(random() * options.length)] || options[0] || null
);

const buildNeutralPossessionEvent = (
  attacker: Team,
  defender: Team,
  random: () => number
) => pickCommentary(random, [
  `${attacker.name} recycle possession and start the move again.`,
  `${defender.name} stay compact and force the play sideways.`,
  `A patient spell from ${attacker.name}, but ${defender.name} keep their shape.`,
  `${attacker.name} probe for an opening without finding the final pass.`,
  `${defender.name} slow the tempo and close the central lanes.`,
]);

const buildPhaseOneStopEvent = (
  defender: Team,
  creator: Player,
  random: () => number
) => pickCommentary(random, [
  `${defender.name} read the build-up early and stop ${creator.name} in midfield.`,
  `${creator.name} cannot play through ${defender.name}'s midfield line.`,
  `${defender.name} compress the space and kill the move before it develops.`,
  `The middle closes quickly and ${defender.name} hold firm.`,
]);

const buildFinalThirdStopEvent = (
  creator: Player,
  defender: Team,
  activeDefender: Player,
  random: () => number
) => pickCommentary(random, [
  `${activeDefender.name} times the tackle and stops ${creator.name} cleanly.`,
  `${creator.name} looks for the gap, but ${activeDefender.name} shuts the door.`,
  `${defender.name} crowd the ball carrier out and clear the danger.`,
  `${activeDefender.name} stands ${creator.name} up and wins the duel.`,
]);

const buildFoulEvent = (
  defender: Player,
  type: 'Y' | 'R',
  random: () => number
) => (
  type === 'R'
    ? pickCommentary(random, [
      `${defender.name} wipes out the break and is shown a red card.`,
      `${defender.name} goes through the man and sees straight red.`,
      `${defender.name} makes a desperate challenge and the referee reaches for red.`,
    ])
    : pickCommentary(random, [
      `${defender.name} clips the runner and goes into the book.`,
      `${defender.name} stops the move with a foul and takes a yellow card.`,
      `${defender.name} arrives late and the referee books him.`,
    ])
);

const buildGoalEvent = (
  attacker: Team,
  finisher: Player,
  assister: Player | undefined,
  isThroughBall: boolean,
  isWideRoute: boolean,
  random: () => number
) => {
  if (assister) {
    if (isThroughBall) {
      return pickCommentary(random, [
        `GOAL! ${assister.name} slides it through and ${finisher.name} finishes for ${attacker.name}.`,
        `GOAL! ${finisher.name} runs onto ${assister.name}'s pass and buries it for ${attacker.name}.`,
        `GOAL! ${attacker.name} split the line and ${finisher.name} does the rest. Assist ${assister.name}.`,
      ]);
    }
    if (isWideRoute) {
      return pickCommentary(random, [
        `GOAL! ${attacker.name} work it wide and ${finisher.name} turns in the delivery from ${assister.name}.`,
        `GOAL! ${assister.name} serves it from the flank and ${finisher.name} applies the finish for ${attacker.name}.`,
        `GOAL! ${finisher.name} meets the service from ${assister.name} and scores for ${attacker.name}.`,
      ]);
    }

    return pickCommentary(random, [
      `GOAL! ${finisher.name} scores for ${attacker.name}! Assist: ${assister.name}.`,
      `GOAL! ${attacker.name} piece it together and ${finisher.name} finishes the move set up by ${assister.name}.`,
      `GOAL! ${finisher.name} converts for ${attacker.name} after the opening is created by ${assister.name}.`,
    ]);
  }

  return pickCommentary(random, [
    `GOAL! ${finisher.name} creates room and scores for ${attacker.name}.`,
    `GOAL! ${finisher.name} does it alone and finds the finish for ${attacker.name}.`,
    `GOAL! ${finisher.name} takes charge of the move and converts for ${attacker.name}.`,
  ]);
};

const buildMissEvent = (
  finisher: Player,
  goalkeeper: Player,
  defender: Player,
  random: () => number
): { event: string | null; onTarget: boolean } => {
  const options = [
    { event: `GREAT SAVE! ${goalkeeper.name} gets across to deny ${finisher.name}.`, onTarget: true },
    { event: `WIDE! ${finisher.name} drags the effort past the post.`, onTarget: false },
    { event: `OVER! ${finisher.name} cannot keep the shot down.`, onTarget: false },
    { event: `PALMED AWAY! ${goalkeeper.name} reacts well to the effort from ${finisher.name}.`, onTarget: true },
    { event: `BLOCK! ${defender.name} throws himself in front of ${finisher.name}'s shot.`, onTarget: false },
    { event: `${finisher.name} gets the strike away, but ${goalkeeper.name} stands tall.`, onTarget: true },
    { event: `Half a chance for ${finisher.name}, but the finish is not there.`, onTarget: false },
  ];
  return options[Math.floor(random() * options.length)] || options[0];
};

export type PossessionShotMetadata = {
  shooterId: string;
  onTarget: boolean;
};

export type SimulatePossessionResult = {
  goal: boolean;
  scorer?: Player;
  assister?: Player;
  event: string | null;
  foul?: { player: Player; type: 'Y' | 'R' };
  shot?: PossessionShotMetadata;
};

// Match engine phase simulation
export const simulatePossession = (
  attacker: Team,
  defender: Team,
  attPlayers: Player[],
  defPlayers: Player[],
  attackerGoals: number,
  defenderGoals: number,
  attackerShape?: TeamShapeProfile,
  defenderShape?: TeamShapeProfile,
  rng?: RandomGenerator,
  bookedPlayerIds?: Set<string>
): SimulatePossessionResult => {
  const random = resolveRandom(rng);
  if (attPlayers.length === 0 || defPlayers.length === 0) return { goal: false, event: null };
  const attRoles = getRoleGroups(attPlayers);
  const defRoles = getRoleGroups(defPlayers);
  const attackerRoleFor = (player: Player) => getCompatiblePlayerRoleForTeamSlot(attacker, player);
  const defenderRoleFor = (player: Player) => getCompatiblePlayerRoleForTeamSlot(defender, player);
  const uniquePlayers = (...pools: Player[][]) => Array.from(new Map(
    pools.flat().map(player => [player.id, player])
  ).values());
  const roleAdjustedStat = (value: number, bonus?: number) => value * (1 + (bonus || 0));
  const attShape = attackerShape || buildFallbackShapeProfile(attPlayers);
  const defShape = defenderShape || buildFallbackShapeProfile(defPlayers);
  const midAtt = [...attRoles.DM, ...attRoles.CM, ...attRoles.AM, ...attRoles.WIDE_MID];
  const fwdAtt = [...attRoles.ST, ...attRoles.WINGER];
  const defDef = [...defRoles.CB, ...defRoles.FB, ...defRoles.WB];
  const gkDef = defRoles.GK;

  // --- Tactical Multipliers ---
  let passBonus = 1.0;
  let shootingBonus = 1.0;
  let defensiveBonus = 1.0;
  let throughBallChance = ENGINE_CONFIG.ATTACKING_THROUGH_BALL_BASE_CHANCE;

  const aTac = attacker.tactics;
  const dTac = defender.tactics;
  const pickFouler = (pool: Player[], weight: (player: Player) => number) => {
    const unbookedPool = pool.filter(player => !bookedPlayerIds?.has(player.id));
    const selectedPool = unbookedPool.length > 0 && random() < ENGINE_CONFIG.BOOKED_PLAYER_FOUL_AVOIDANCE_CHANCE
      ? unbookedPool
      : pool;
    return weightedPick(selectedPool, weight, rng);
  };

  // Mentality: attacking choices affect the attack, defensive choices affect the defender.
  if (aTac.mentality === 'Attacking') {
    shootingBonus *= ENGINE_CONFIG.ATTACKING_MENTALITY_SHOOTING_MULTIPLIER;
    passBonus *= ENGINE_CONFIG.ATTACKING_MENTALITY_PASSING_MULTIPLIER;
  }
  if (aTac.mentality === 'Defensive') {
    shootingBonus *= ENGINE_CONFIG.DEFENSIVE_MENTALITY_SHOOTING_MULTIPLIER;
    passBonus *= ENGINE_CONFIG.DEFENSIVE_MENTALITY_PASSING_MULTIPLIER;
  }
  if (dTac.mentality === 'Attacking') defensiveBonus *= ENGINE_CONFIG.DEFENDER_ATTACKING_MENTALITY_MULTIPLIER;
  if (dTac.mentality === 'Defensive') defensiveBonus *= ENGINE_CONFIG.DEFENDER_DEFENSIVE_MENTALITY_MULTIPLIER;

  // Passing Style
  if (aTac.passingStyle === 'Short') {
    passBonus *= ENGINE_CONFIG.SHORT_PASSING_MULTIPLIER;
    throughBallChance = ENGINE_CONFIG.SHORT_PASS_THROUGH_BALL_CHANCE;
  } else if (aTac.passingStyle === 'Direct') {
    passBonus *= ENGINE_CONFIG.DIRECT_PASSING_MULTIPLIER;
    throughBallChance = ENGINE_CONFIG.DIRECT_PASS_THROUGH_BALL_CHANCE;
  } else {
    passBonus *= ENGINE_CONFIG.MIXED_PASSING_MULTIPLIER;
    throughBallChance = ENGINE_CONFIG.MIXED_PASS_THROUGH_BALL_CHANCE;
  }

  // Defensive Line height multipliers
  const isHighLine = dTac.defensiveLine === 'High';
  const isDeepLine = dTac.defensiveLine === 'Deep';
  if (dTac.pressing === 'High') defensiveBonus *= ENGINE_CONFIG.DEFENSIVE_PRESS_HIGH_MULTIPLIER;
  if (dTac.pressing === 'None') defensiveBonus *= ENGINE_CONFIG.DEFENSIVE_PRESS_NONE_MULTIPLIER;

  // Anti-Steamroll
  if (attackerGoals - defenderGoals >= ENGINE_CONFIG.STEAMROLL_MARGIN_1) defensiveBonus *= ENGINE_CONFIG.STEAMROLL_BONUS_1;
  if (attackerGoals - defenderGoals >= ENGINE_CONFIG.STEAMROLL_MARGIN_2) defensiveBonus *= ENGINE_CONFIG.STEAMROLL_BONUS_2;

  // Tempo and pressing should influence chance volume and shot profile.
  const tempoMultiplier = aTac.tempo === 'Fast'
    ? ENGINE_CONFIG.TEMPO_FAST_BIG_MOMENT_MULTIPLIER
    : (aTac.tempo === 'Slow' ? ENGINE_CONFIG.TEMPO_SLOW_BIG_MOMENT_MULTIPLIER : 1.0);
  const defenderPressMultiplier = dTac.pressing === 'High'
    ? ENGINE_CONFIG.DEFENDER_PRESS_HIGH_BIG_MOMENT_MULTIPLIER
    : (dTac.pressing === 'None' ? ENGINE_CONFIG.DEFENDER_PRESS_NONE_BIG_MOMENT_MULTIPLIER : 1.0);
  throughBallChance *= tempoMultiplier;
  const pressingForwardChanceBoost = fwdAtt.filter(player => attackerRoleFor(player) === 'pressingForward').length * 0.03;
  const bigMomentChance = Math.max(
    ENGINE_CONFIG.BIG_MOMENT_MIN_CHANCE,
    Math.min(ENGINE_CONFIG.BIG_MOMENT_MAX_CHANCE, ENGINE_CONFIG.BIG_MOMENT_CHANCE * tempoMultiplier * defenderPressMultiplier * (1 + pressingForwardChanceBoost))
  );

  // Chance a possession is interesting
  if (random() > bigMomentChance) {
    const event = random() < LOW_INTENSITY_COMMENTARY_CHANCE
      ? buildNeutralPossessionEvent(attacker, defender, random)
      : null;
    return { goal: false, event };
  }

  // Phase 1: Midfield Build-up
  const progressionPool = uniquePlayers(
    [...attRoles.DM, ...attRoles.CM, ...attRoles.AM, ...attRoles.WIDE_MID, ...attRoles.FB, ...attRoles.WB],
    attRoles.ST.filter(player => attackerRoleFor(player) === 'falseNine'),
    attPlayers.filter(player => attackerRoleFor(player) === 'boxToBox')
  ).filter(player => getRoleWeightMultiplier(attackerRoleFor(player), 'buildUp') > 0);
  const activeMid = progressionPool.length > 0
    ? weightedPick(progressionPool, p => {
      const role = inferRoleTag(p);
      const roleMult = role === 'DM' ? 1.1 : (role === 'CM' ? 1.25 : (role === 'AM' ? 1.3 : 1.0));
      const playerRole = attackerRoleFor(p);
      const roleBonus = getRoleStatBonus(playerRole, 'buildUp');
      return (
        roleAdjustedStat(p.stats.passing, roleBonus.passing) +
        roleAdjustedStat(p.stats.dribbling, roleBonus.dribbling) * 0.4 +
        p.stats.pace * 0.2
      ) * roleMult * getRoleWeightMultiplier(playerRole, 'buildUp');
    }, rng)
    : (attPlayers.find(p => p.position === 'DEF') || attPlayers[0]);

  const defensiveWall = uniquePlayers(
    [...defRoles.DM, ...defRoles.CM, ...defDef],
    [...defRoles.ST, ...defRoles.WINGER].filter(player => defenderRoleFor(player) === 'pressingForward')
  );
  const midDefending = defensiveWall.length > 0
    ? (defensiveWall.reduce((sum, p) => {
      const playerRole = defenderRoleFor(p);
      const roleBonus = getRoleStatBonus(playerRole, 'defending');
      const pressure = playerRole === 'pressingForward' ? p.stats.pace * 0.15 + p.stats.physical * 0.15 : 0;
      return sum + (roleAdjustedStat(p.stats.defending || 50, roleBonus.defending) + pressure) * getRoleWeightMultiplier(playerRole, 'defending');
    }, 0) / defensiveWall.length) * 0.90
    : 50;
  const gkSupport = gkDef[0]
    ? ((gkDef[0].stats.gk_positioning || gkDef[0].stats.gk_reflexes || 50) - 50) * 0.12
    : 0;
  const phaseOneDefense = midDefending + (isHighLine ? gkSupport : 0) + defShape.centralShield * 0.9;

  let interceptBonus = isHighLine
    ? ENGINE_CONFIG.INTERCEPT_HIGH_LINE_MULTIPLIER
    : (isDeepLine ? ENGINE_CONFIG.INTERCEPT_DEEP_LINE_MULTIPLIER : 1.0);
  if (dTac.pressing === 'High') interceptBonus *= ENGINE_CONFIG.INTERCEPT_PRESS_HIGH_MULTIPLIER;
  if (dTac.pressing === 'None') interceptBonus *= ENGINE_CONFIG.INTERCEPT_PRESS_NONE_MULTIPLIER;

  // UNDERDOG BUFF: Increased Chaos Factor (from 0.15 to 0.25) so lower teams get through more often
  const buildOutEdge = attShape.buildOutSupport - defShape.centralShield;
  const activeMidBuildBonus = getRoleStatBonus(attackerRoleFor(activeMid), 'buildUp');
  const phaseOneAttack = roleAdjustedStat(activeMid.stats.passing, activeMidBuildBonus.passing) * passBonus * 1.1 * (1 + clamp(buildOutEdge * 0.02, -0.1, 0.16));
  const phase1Success = runDuel(phaseOneAttack, phaseOneDefense * interceptBonus, ENGINE_CONFIG.DUEL_LUCK_MIDFIELD, rng);
  if (!phase1Success && random() > ENGINE_CONFIG.PHASE_ONE_FAIL_ESCAPE_CHANCE) {
    const midfieldFoulMultiplier = dTac.pressing === 'High'
      ? 1.15
      : dTac.pressing === 'None'
        ? 0.85
        : 1;
    if (random() < clamp(ENGINE_CONFIG.MIDFIELD_FOUL_CHANCE * midfieldFoulMultiplier, 0, 0.75)) {
      const foulPool = defensiveWall.length > 0 ? defensiveWall : defPlayers;
      const fouler = pickFouler(foulPool, p => (p.stats.defending || 50) + p.stats.physical * 0.25);
      const type = random() < ENGINE_CONFIG.RED_CARD_CHANCE ? 'R' : 'Y';
      return { goal: false, event: buildFoulEvent(fouler, type, random), foul: { player: fouler, type } };
    }
    return { goal: false, event: buildPhaseOneStopEvent(defender, activeMid, random) };
  }

  // Phase 2: Final Third / Chance Creation
  const wideAttackWidth = attRoles.WINGER.length + attRoles.WB.length + attRoles.WIDE_MID.length;
  const centralAttackWidth = attRoles.DM.length + attRoles.CM.length + attRoles.AM.length + attRoles.ST.length;
  const shapeWideDelta = (attShape.widePresence - defShape.widePresence) * 0.03;
  const shapeCentralPenalty = (defShape.centralShield - attShape.centralShield) * 0.015;
  const invertedWingerBias = attRoles.WINGER.filter(player => attackerRoleFor(player) === 'invertedWinger').length * -0.06;
  const wideRoleBias = uniquePlayers(attRoles.FB, attRoles.WB, attRoles.WIDE_MID)
    .filter(player => ['wingBack', 'wideMidfielder'].includes(attackerRoleFor(player)))
    .length * 0.04;
  const wideRouteChance = clamp(
    ENGINE_CONFIG.WIDE_ROUTE_BASE_CHANCE + (wideAttackWidth - centralAttackWidth) * 0.04 + shapeWideDelta - shapeCentralPenalty + invertedWingerBias + wideRoleBias,
    ENGINE_CONFIG.WIDE_ROUTE_MIN_CHANCE,
    ENGINE_CONFIG.WIDE_ROUTE_MAX_CHANCE
  );
  const isWideRoute = random() < wideRouteChance;

  const attackingWingBacks = [...attRoles.FB, ...attRoles.WB].filter(player => attackerRoleFor(player) === 'wingBack');
  const boxToBoxCreators = attPlayers.filter(player => attackerRoleFor(player) === 'boxToBox');
  const creatorPool = isWideRoute
    ? uniquePlayers([...attRoles.WINGER, ...attRoles.WB, ...attRoles.WIDE_MID, ...attRoles.AM], attackingWingBacks, boxToBoxCreators)
    : uniquePlayers([...attRoles.AM, ...attRoles.CM, ...attRoles.DM, ...attRoles.ST], boxToBoxCreators);
  const creatorFallback = [...fwdAtt, ...midAtt];
  const creatorCandidates = (creatorPool.length > 0 ? creatorPool : creatorFallback)
    .filter(player => getRoleWeightMultiplier(attackerRoleFor(player), 'creation') > 0);
  const creator = creatorCandidates.length > 0
    ? weightedPick(creatorCandidates, p => {
      const role = inferRoleTag(p);
      const roleBoost = role === 'AM' ? 1.25 : (role === 'CM' ? 1.1 : 1.0);
      const playerRole = attackerRoleFor(p);
      const roleBonus = getRoleStatBonus(playerRole, 'creation');
      return (
        roleAdjustedStat(p.stats.passing, roleBonus.passing) * 0.9 +
        roleAdjustedStat(p.stats.dribbling, roleBonus.dribbling) * 0.8 +
        p.stats.pace * 0.3
      ) * roleBoost * getRoleWeightMultiplier(playerRole, 'creation');
    }, rng)
    : attPlayers[0];

  const defenderPool = isWideRoute
    ? [...defRoles.FB, ...defRoles.WB, ...defRoles.CB]
    : [...defRoles.DM, ...defRoles.CM, ...defRoles.CB];
  const activeDefender = defenderPool.length > 0
    ? weightedPick(defenderPool, p => {
      const roleBonus = getRoleStatBonus(defenderRoleFor(p), 'defending');
      return roleAdjustedStat(p.stats.defending || 50, roleBonus.defending) + p.stats.pace * 0.15;
    }, rng)
    : (defDef[0] || defPlayers[0]);

  const creatorRole = inferRoleTag(creator);
  const creatorPlayerRole = attackerRoleFor(creator);
  const creatorRoleBonus = getRoleStatBonus(creatorPlayerRole, 'creation');
  const shieldStrength = avgStat([...defRoles.DM, ...defRoles.CM], p => (p.stats.defending || 50), 55);
  const throughBallSkill = creator.stats.passing > 70 ? 1.0 : 0.9;
  const roleThroughBallBoost = (creatorRole === 'AM' || creatorRole === 'CM' ? 1.08 : 1.0) * (1 + (creatorRoleBonus.throughBall || 0));
  const shieldPenalty = shieldStrength > 72 ? 0.9 : 1.0;
  const shapeThroughBallBoost = attShape.finalThirdPresence > defShape.centralShield ? 1.05 : 0.95;
  const compactBlockPenalty = defShape.lineLoad.def >= 5 ? 0.96 : 1.0;
  const isThroughBall = random() < (
    throughBallChance * throughBallSkill * roleThroughBallBoost * shieldPenalty * shapeThroughBallBoost * compactBlockPenalty
  );

  // Use Physicality for target-man types in Phase 2
  const creatorPassing = roleAdjustedStat(creator.stats.passing, creatorRoleBonus.passing);
  const creatorDribbling = roleAdjustedStat(creator.stats.dribbling || 70, creatorRoleBonus.dribbling);
  const creatorPhysical = roleAdjustedStat(creator.stats.physical || 70, creatorRoleBonus.physical);
  let creationStat = isThroughBall
    ? (creatorPassing * 1.1)
    : Math.max(creatorDribbling, creatorPhysical * 0.9);
  if (isWideRoute) creationStat = Math.max(creationStat, creator.stats.pace * 0.95 + creatorDribbling * 0.4);

  creationStat *= passBonus;
  const routeShapeBoost = isWideRoute
    ? (1 + clamp((attShape.widePresence - defShape.widePresence) * 0.02, -0.08, 0.12))
    : (1 + clamp((attShape.centralShield - defShape.centralShield) * 0.02, -0.08, 0.1));
  creationStat *= routeShapeBoost;
  const activeDefenderBonus = getRoleStatBonus(defenderRoleFor(activeDefender), 'defending');
  let defenderStat = roleAdjustedStat(activeDefender.stats.defending || 60, activeDefenderBonus.defending) * defensiveBonus;

  if (isThroughBall && isHighLine) defenderStat *= 0.85;
  if (isThroughBall && isDeepLine) defenderStat *= 1.1;

  if (!runDuel(creationStat, defenderStat, ENGINE_CONFIG.DUEL_LUCK_ATTACK, rng)) {
    if (random() < ENGINE_CONFIG.FOUL_CHANCE) {
      const type = random() < ENGINE_CONFIG.RED_CARD_CHANCE ? 'R' : 'Y';
      const foulPool = defenderPool.length > 0 ? defenderPool : [activeDefender];
      const fouler = pickFouler(foulPool, p => (p.stats.defending || 50) + p.stats.pace * 0.15);
      return { goal: false, event: buildFoulEvent(fouler, type, random), foul: { player: fouler, type } };
    }
    return { goal: false, event: buildFinalThirdStopEvent(creator, defender, activeDefender, random) };
  }

  // Phase 3: Finishing
  const roleFinishers = attPlayers.filter(player => ['getForward', 'boxToBox', 'invertedWinger', 'targetMan'].includes(attackerRoleFor(player)));
  const attackingOptions = uniquePlayers([...attRoles.ST, ...attRoles.WINGER, ...attRoles.AM, ...midAtt], roleFinishers)
    .filter(player => getRoleWeightMultiplier(attackerRoleFor(player), 'finishing') > 0);
  const possibleFinishers = attackingOptions.length > 0 ? attackingOptions : attPlayers;
  const finisher = weightedPick(possibleFinishers, p => {
    const shooting = p.stats.shooting || 50;
    const role = inferRoleTag(p);
    const roleMultiplier =
      role === 'ST' ? 1.45 :
      role === 'WINGER' ? 1.2 :
      role === 'AM' ? 1.05 :
      (p.position === 'MID' ? 0.85 : 0.3);
    return Math.max(1, shooting - 55) * roleMultiplier * getRoleWeightMultiplier(attackerRoleFor(p), 'finishing');
  }, rng);

  const gk = gkDef[0] || defPlayers[0];
  let shotStat = (finisher.stats.shooting || 70) * shootingBonus;
  shotStat *= 1 + (getRoleStatBonus(attackerRoleFor(finisher), 'finishing').shooting || 0);
  shotStat *= 1 + clamp((attShape.boxTargetPresence - defShape.lineLoad.def) * 0.025, -0.08, 0.1);

  // Toned down impact boost further to prevent 150-goal seasons
  if (finisher.impactCoefficient > 1.2) shotStat *= (1.0 + (finisher.impactCoefficient - 1.0) * 0.15);

  const gkShotStop = (gk.stats.gk_reflexes || gk.stats.defending || 65);
  const gkPosition = gk.stats.gk_positioning || 60;
  const gkHandling = gk.stats.gk_handling || 55;
  let reflexStat = (gkShotStop * 0.6) + (gkPosition * 0.25) + (gkHandling * 0.15);
  reflexStat *= 1 + clamp((defShape.lineLoad.def - attShape.boxTargetPresence) * 0.012, -0.04, 0.06);

  if (runDuel(shotStat, reflexStat, ENGINE_CONFIG.DUEL_LUCK_SHOOTING, rng)) {
    const assister = creator.id !== finisher.id ? creator : undefined;
    return {
      goal: true,
      scorer: finisher,
      assister,
      event: buildGoalEvent(attacker, finisher, assister, isThroughBall, isWideRoute, random),
      shot: { shooterId: finisher.id, onTarget: true },
    };
  }

  const miss = buildMissEvent(finisher, gk, activeDefender, random);
  return { goal: false, event: miss.event, shot: { shooterId: finisher.id, onTarget: miss.onTarget } };
};

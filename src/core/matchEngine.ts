import { Team, Player, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import type { TeamShapeProfile } from './matchTypes';
import { getTeamMatchBench, getTeamMatchStarters } from './lineupEngine';
import { buildFallbackShapeProfile, buildTeamShapeProfile } from './shapeEngine';
import { applySubstitutions } from './substitutionEngine';
import { applySharedPostMatchAccounting } from './postMatchAccounting';
import { rebuildFormationMap } from './formationMapUtils';
import { applyMinuteCaps, buildStarterBenchMinuteMap } from './minuteMapUtils';
import { applyMatchInjuries } from './injuryEngine';
import { isPlayerUnavailable } from './playerStatusUtils';
import { defaultRandomGenerator, RandomGenerator, resolveRandom } from './random';
import { applyMatchResult } from './teamUtils';
import {
  addPlayerStat,
  avgStat,
  clamp,
  getFormModifier,
  getMoraleModifier,
  getRoleGroups,
  inferRoleTag,
  runDuel,
  scaleLineupForMatch,
  weightedPick,
} from './matchUtils';

export { autoAssignLineup } from './lineupEngine';
export { buildTeamShapeProfile } from './shapeEngine';
export { getFormModifier, getMoraleModifier, runDuel } from './matchUtils';

const LOW_INTENSITY_COMMENTARY_CHANCE = 0.04;

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
) => pickCommentary(random, [
  `GREAT SAVE! ${goalkeeper.name} gets across to deny ${finisher.name}.`,
  `WIDE! ${finisher.name} drags the effort past the post.`,
  `OVER! ${finisher.name} cannot keep the shot down.`,
  `PALMED AWAY! ${goalkeeper.name} reacts well to the effort from ${finisher.name}.`,
  `BLOCK! ${defender.name} throws himself in front of ${finisher.name}'s shot.`,
  `${finisher.name} gets the strike away, but ${goalkeeper.name} stands tall.`,
  `Half a chance for ${finisher.name}, but the finish is not there.`,
]);

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
  rng?: RandomGenerator
): { goal: boolean; scorer?: Player; assister?: Player; event: string | null; foul?: { player: Player; type: 'Y' | 'R' } } => {
  const random = resolveRandom(rng);
  if (attPlayers.length === 0 || defPlayers.length === 0) return { goal: false, event: null };
  const attRoles = getRoleGroups(attPlayers);
  const defRoles = getRoleGroups(defPlayers);
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
  const bigMomentChance = Math.max(
    ENGINE_CONFIG.BIG_MOMENT_MIN_CHANCE,
    Math.min(ENGINE_CONFIG.BIG_MOMENT_MAX_CHANCE, ENGINE_CONFIG.BIG_MOMENT_CHANCE * tempoMultiplier * defenderPressMultiplier)
  );

  // Chance a possession is interesting
  if (random() > bigMomentChance) {
    const event = random() < LOW_INTENSITY_COMMENTARY_CHANCE
      ? buildNeutralPossessionEvent(attacker, defender, random)
      : null;
    return { goal: false, event };
  }

  // Phase 1: Midfield Build-up
  const progressionPool = [...attRoles.DM, ...attRoles.CM, ...attRoles.AM, ...attRoles.WIDE_MID, ...attRoles.FB, ...attRoles.WB];
  const activeMid = progressionPool.length > 0
    ? weightedPick(progressionPool, p => {
      const role = inferRoleTag(p);
      const roleMult = role === 'DM' ? 1.1 : (role === 'CM' ? 1.25 : (role === 'AM' ? 1.3 : 1.0));
      return (p.stats.passing + p.stats.dribbling * 0.4 + p.stats.pace * 0.2) * roleMult;
    }, rng)
    : (attPlayers.find(p => p.position === 'DEF') || attPlayers[0]);

  const defensiveWall = [...defRoles.DM, ...defRoles.CM, ...defDef];
  const midDefending = defensiveWall.length > 0
    ? (defensiveWall.reduce((sum, p) => sum + (p.stats.defending || 50), 0) / defensiveWall.length) * 0.90
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
  const phaseOneAttack = activeMid.stats.passing * passBonus * 1.1 * (1 + clamp(buildOutEdge * 0.02, -0.1, 0.16));
  const phase1Success = runDuel(phaseOneAttack, phaseOneDefense * interceptBonus, ENGINE_CONFIG.DUEL_LUCK_MIDFIELD, rng);
  if (!phase1Success && random() > ENGINE_CONFIG.PHASE_ONE_FAIL_ESCAPE_CHANCE) {
    const midfieldFoulMultiplier = dTac.pressing === 'High'
      ? 1.15
      : dTac.pressing === 'None'
        ? 0.85
        : 1;
    if (random() < clamp(ENGINE_CONFIG.MIDFIELD_FOUL_CHANCE * midfieldFoulMultiplier, 0, 0.75)) {
      const foulPool = defensiveWall.length > 0 ? defensiveWall : defPlayers;
      const fouler = weightedPick(foulPool, p => (p.stats.defending || 50) + p.stats.physical * 0.25, rng);
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
  const wideRouteChance = clamp(
    ENGINE_CONFIG.WIDE_ROUTE_BASE_CHANCE + (wideAttackWidth - centralAttackWidth) * 0.04 + shapeWideDelta - shapeCentralPenalty,
    ENGINE_CONFIG.WIDE_ROUTE_MIN_CHANCE,
    ENGINE_CONFIG.WIDE_ROUTE_MAX_CHANCE
  );
  const isWideRoute = random() < wideRouteChance;

  const creatorPool = isWideRoute
    ? [...attRoles.WINGER, ...attRoles.WB, ...attRoles.WIDE_MID, ...attRoles.AM]
    : [...attRoles.AM, ...attRoles.CM, ...attRoles.DM, ...attRoles.ST];
  const creatorFallback = [...fwdAtt, ...midAtt];
  const creatorCandidates = creatorPool.length > 0 ? creatorPool : creatorFallback;
  const creator = creatorCandidates.length > 0
    ? weightedPick(creatorCandidates, p => {
      const role = inferRoleTag(p);
      const roleBoost = role === 'AM' ? 1.25 : (role === 'CM' ? 1.1 : 1.0);
      return (p.stats.passing * 0.9 + p.stats.dribbling * 0.8 + p.stats.pace * 0.3) * roleBoost;
    }, rng)
    : attPlayers[0];

  const defenderPool = isWideRoute
    ? [...defRoles.FB, ...defRoles.WB, ...defRoles.CB]
    : [...defRoles.DM, ...defRoles.CM, ...defRoles.CB];
  const activeDefender = defenderPool.length > 0
    ? weightedPick(defenderPool, p => (p.stats.defending || 50) + p.stats.pace * 0.15, rng)
    : (defDef[0] || defPlayers[0]);

  const creatorRole = inferRoleTag(creator);
  const shieldStrength = avgStat([...defRoles.DM, ...defRoles.CM], p => (p.stats.defending || 50), 55);
  const throughBallSkill = creator.stats.passing > 70 ? 1.0 : 0.9;
  const roleThroughBallBoost = creatorRole === 'AM' || creatorRole === 'CM' ? 1.08 : 1.0;
  const shieldPenalty = shieldStrength > 72 ? 0.9 : 1.0;
  const shapeThroughBallBoost = attShape.finalThirdPresence > defShape.centralShield ? 1.05 : 0.95;
  const compactBlockPenalty = defShape.lineLoad.def >= 5 ? 0.96 : 1.0;
  const isThroughBall = random() < (
    throughBallChance * throughBallSkill * roleThroughBallBoost * shieldPenalty * shapeThroughBallBoost * compactBlockPenalty
  );

  // Use Physicality for target-man types in Phase 2
  let creationStat = isThroughBall
    ? (creator.stats.passing * 1.1)
    : Math.max(creator.stats.dribbling || 70, (creator.stats.physical || 70) * 0.9);
  if (isWideRoute) creationStat = Math.max(creationStat, creator.stats.pace * 0.95 + creator.stats.dribbling * 0.4);

  creationStat *= passBonus;
  const routeShapeBoost = isWideRoute
    ? (1 + clamp((attShape.widePresence - defShape.widePresence) * 0.02, -0.08, 0.12))
    : (1 + clamp((attShape.centralShield - defShape.centralShield) * 0.02, -0.08, 0.1));
  creationStat *= routeShapeBoost;
  let defenderStat = (activeDefender.stats.defending || 60) * defensiveBonus;

  if (isThroughBall && isHighLine) defenderStat *= 0.85;
  if (isThroughBall && isDeepLine) defenderStat *= 1.1;

  if (!runDuel(creationStat, defenderStat, ENGINE_CONFIG.DUEL_LUCK_ATTACK, rng)) {
    if (random() < ENGINE_CONFIG.FOUL_CHANCE) {
      const type = random() < ENGINE_CONFIG.RED_CARD_CHANCE ? 'R' : 'Y';
      return { goal: false, event: buildFoulEvent(activeDefender, type, random), foul: { player: activeDefender, type } };
    }
    return { goal: false, event: buildFinalThirdStopEvent(creator, defender, activeDefender, random) };
  }

  // Phase 3: Finishing
  const attackingOptions = [...attRoles.ST, ...attRoles.WINGER, ...attRoles.AM, ...midAtt];
  const possibleFinishers = attackingOptions.length > 0 ? attackingOptions : attPlayers;
  const finisher = weightedPick(possibleFinishers, p => {
    const shooting = p.stats.shooting || 50;
    const role = inferRoleTag(p);
    const roleMultiplier =
      role === 'ST' ? 1.45 :
      role === 'WINGER' ? 1.2 :
      role === 'AM' ? 1.05 :
      (p.position === 'MID' ? 0.85 : 0.3);
    return Math.max(1, shooting - 55) * roleMultiplier;
  }, rng);

  const gk = gkDef[0] || defPlayers[0];
  let shotStat = (finisher.stats.shooting || 70) * shootingBonus;
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
    };
  }

  const missEvent = buildMissEvent(finisher, gk, activeDefender, random);
  return { goal: false, event: missEvent };
};


/**
 * Pure function to simulate a match without Zustand overhead.
 * Quick sim applies substitutions at checkpoints and uses post-match energy drain,
 * while live mode drains energy per minute and applies substitutions at full time.
 */
export const quickSimMatch = (
  fixtureId: string,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  userTeamId?: string | null,
  options?: { rng?: RandomGenerator }
): { players: Record<string, Player>, teams: Record<string, Team>, fixture: Fixture, events: string[] } => {
  const rng = options?.rng ?? defaultRandomGenerator;
  const random = rng.next;
  const fixture = fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return { players, teams, fixture, events: [] };

  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };
  const matchEvents: string[] = [];

  const homeStarters = getTeamMatchStarters(fixture.homeTeamId, userTeamId, updatedPlayers, updatedTeams, isPlayerUnavailable, rebuildFormationMap);
  const awayStarters = getTeamMatchStarters(fixture.awayTeamId, userTeamId, updatedPlayers, updatedTeams, isPlayerUnavailable, rebuildFormationMap);
  const homeTeam = updatedTeams[fixture.homeTeamId];
  const awayTeam = updatedTeams[fixture.awayTeamId];
  
  const homeBench = getTeamMatchBench(fixture.homeTeamId, homeStarters, updatedPlayers, isPlayerUnavailable);
  const awayBench = getTeamMatchBench(fixture.awayTeamId, awayStarters, updatedPlayers, isPlayerUnavailable);

  if (homeStarters.length === 0 || awayStarters.length === 0) return { players, teams, fixture, events: matchEvents };

  let hScore = 0;
  let aScore = 0;
  const homeGoalMinutes: number[] = [];
  const awayGoalMinutes: number[] = [];
  const homeFormMult = getFormModifier(homeTeam.form);
  const awayFormMult = getFormModifier(awayTeam.form);
  const homeMoraleMult = getMoraleModifier(homeStarters);
  const awayMoraleMult = getMoraleModifier(awayStarters);
  const GLOBAL_HOME_ADVANTAGE = ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE;
  let currentHomeXI = [...homeStarters];
  let currentAwayXI = [...awayStarters];
  let availableHomeBench = [...homeBench];
  let availableAwayBench = [...awayBench];
  let scaledHome = scaleLineupForMatch(currentHomeXI, homeFormMult, homeMoraleMult, GLOBAL_HOME_ADVANTAGE);
  let scaledAway = scaleLineupForMatch(currentAwayXI, awayFormMult, awayMoraleMult);
  let homeShape = buildTeamShapeProfile(homeTeam, currentHomeXI);
  let awayShape = buildTeamShapeProfile(awayTeam, currentAwayXI);
  const homeMinutes = buildStarterBenchMinuteMap(homeStarters, homeBench);
  const awayMinutes = buildStarterBenchMinuteMap(awayStarters, awayBench);
  const homeSubEntryMinutes: Record<string, number> = {};
  const awaySubEntryMinutes: Record<string, number> = {};
  const substitutionCheckpoints = [56, 66, 76, 84];
  let appliedCheckpointIndex = 0;
  const firstAttackIsHome = random() < 0.5;

  const matchYellowCards = new Set<string>();
  const sentOffPlayers = new Set<string>();
  const sentOffMinutes: Record<string, number> = {};
  const sendOffPlayer = (playerId: string, minute: number) => {
    const player = updatedPlayers[playerId];
    if (!player || sentOffPlayers.has(playerId)) return;
    updatedPlayers[playerId] = {
      ...player,
      redCards: player.redCards + 1,
      matchesSuspended: 3,
      suspensionAppliedWeek: fixture.week,
    };
    sentOffPlayers.add(playerId);
    sentOffMinutes[playerId] = minute;
    const wasHome = scaledHome.some(p => p.id === playerId);
    const wasAway = scaledAway.some(p => p.id === playerId);
    currentHomeXI = currentHomeXI.filter(p => p.id !== playerId);
    currentAwayXI = currentAwayXI.filter(p => p.id !== playerId);
    scaledHome = scaledHome.filter(p => p.id !== playerId);
    scaledAway = scaledAway.filter(p => p.id !== playerId);
    if (wasHome) {
      const entryMinute = homeSubEntryMinutes[playerId];
      homeMinutes[playerId] = entryMinute !== undefined
        ? Math.max(0, minute - entryMinute)
        : Math.min(homeMinutes[playerId] || 90, minute);
      if (entryMinute !== undefined) delete homeSubEntryMinutes[playerId];
      homeShape = buildFallbackShapeProfile(scaledHome);
    }
    if (wasAway) {
      const entryMinute = awaySubEntryMinutes[playerId];
      awayMinutes[playerId] = entryMinute !== undefined
        ? Math.max(0, minute - entryMinute)
        : Math.min(awayMinutes[playerId] || 90, minute);
      if (entryMinute !== undefined) delete awaySubEntryMinutes[playerId];
      awayShape = buildFallbackShapeProfile(scaledAway);
    }
  };

  for (let i = 0; i < ENGINE_CONFIG.TOTAL_POSSESSIONS; i++) {
    const minute = Math.max(1, Math.min(90, Math.ceil(((i + 1) * 90) / ENGINE_CONFIG.TOTAL_POSSESSIONS)));
    while (appliedCheckpointIndex < substitutionCheckpoints.length && minute >= substitutionCheckpoints[appliedCheckpointIndex]) {
      const subMinute = substitutionCheckpoints[appliedCheckpointIndex];
      applySubstitutions(currentHomeXI, availableHomeBench, sentOffPlayers, homeMinutes, homeTeam, hScore, aScore, rng, {
        maxSubsOverride: 1,
        minuteOverride: subMinute,
        playerEntryMinutes: homeSubEntryMinutes,
        onSubstitution: (offPlayer, onPlayer) => {
          currentHomeXI = currentHomeXI.map(player => (player.id === offPlayer.id ? onPlayer : player));
          availableHomeBench = availableHomeBench.filter(player => player.id !== onPlayer.id);
          scaledHome = scaleLineupForMatch(currentHomeXI, homeFormMult, homeMoraleMult, GLOBAL_HOME_ADVANTAGE);
          homeShape = buildFallbackShapeProfile(scaledHome);
          matchEvents.push(`${homeTeam.name} make a change: ${offPlayer.name} off, ${onPlayer.name} on.`);
        },
      });
      applySubstitutions(currentAwayXI, availableAwayBench, sentOffPlayers, awayMinutes, awayTeam, aScore, hScore, rng, {
        maxSubsOverride: 1,
        minuteOverride: subMinute,
        playerEntryMinutes: awaySubEntryMinutes,
        onSubstitution: (offPlayer, onPlayer) => {
          currentAwayXI = currentAwayXI.map(player => (player.id === offPlayer.id ? onPlayer : player));
          availableAwayBench = availableAwayBench.filter(player => player.id !== onPlayer.id);
          scaledAway = scaleLineupForMatch(currentAwayXI, awayFormMult, awayMoraleMult);
          awayShape = buildFallbackShapeProfile(scaledAway);
          matchEvents.push(`${awayTeam.name} make a change: ${offPlayer.name} off, ${onPlayer.name} on.`);
        },
      });
      appliedCheckpointIndex += 1;
    }
    const isHomeAttacking = ((i + (firstAttackIsHome ? 0 : 1)) % 2) === 0;
    const attTeam = isHomeAttacking ? homeTeam : awayTeam;
    const defTeam = isHomeAttacking ? awayTeam : homeTeam;
    const attPlayers = isHomeAttacking ? scaledHome : scaledAway;
    const defPlayers = isHomeAttacking ? scaledAway : scaledHome;
    const attShape = isHomeAttacking ? homeShape : awayShape;
    const defShape = isHomeAttacking ? awayShape : homeShape;

    const poss = simulatePossession(
      attTeam,
      defTeam,
      attPlayers,
      defPlayers,
      isHomeAttacking ? hScore : aScore,
      isHomeAttacking ? aScore : hScore,
      attShape,
      defShape,
      rng
    );
    if (poss.event) matchEvents.push(poss.event);
    if (poss.goal) {
      if (isHomeAttacking) {
        hScore++;
        homeGoalMinutes.push(minute);
      } else {
        aScore++;
        awayGoalMinutes.push(minute);
      }
      if (poss.scorer) addPlayerStat(updatedPlayers, poss.scorer.id, 'goals');
      if (poss.assister) addPlayerStat(updatedPlayers, poss.assister.id, 'assists');
    }
    if (poss.foul) {
      const playerId = poss.foul.player.id;
      if (sentOffPlayers.has(playerId)) continue;
      if (poss.foul.type === 'Y') {
        if (matchYellowCards.has(playerId)) {
          if (random() < ENGINE_CONFIG.SECOND_YELLOW_RED_CHANCE) {
            addPlayerStat(updatedPlayers, playerId, 'yellowCards');
            sendOffPlayer(playerId, minute);
            matchEvents.push(`${poss.foul.player.name} receives a second yellow and is sent off.`);
          }
        } else {
          addPlayerStat(updatedPlayers, playerId, 'yellowCards');
          matchYellowCards.add(playerId);
        }
      } else {
        sendOffPlayer(playerId, minute);
      }
    }
  }
  applyMinuteCaps(homeMinutes, sentOffMinutes);
  applyMinuteCaps(awayMinutes, sentOffMinutes);

  const homeParticipants = [...homeStarters, ...homeBench];
  const awayParticipants = [...awayStarters, ...awayBench];
  applySharedPostMatchAccounting({
    teamParticipants: homeParticipants,
    teamStarterIds: new Set(homeStarters.map(player => player.id)),
    minuteMap: homeMinutes,
    concededGoalMinutes: awayGoalMinutes,
    concededGoalsTotal: aScore,
    isWin: hScore > aScore,
    isDraw: hScore === aScore,
    teamTactics: homeTeam.tactics,
    updatedPlayers,
    rng,
  });
  applySharedPostMatchAccounting({
    teamParticipants: awayParticipants,
    teamStarterIds: new Set(awayStarters.map(player => player.id)),
    minuteMap: awayMinutes,
    concededGoalMinutes: homeGoalMinutes,
    concededGoalsTotal: hScore,
    isWin: aScore > hScore,
    isDraw: aScore === hScore,
    teamTactics: awayTeam.tactics,
    updatedPlayers,
    rng,
  });
  applyMatchInjuries(homeParticipants, homeMinutes, updatedPlayers, fixture.week, rng)
    .forEach(event => matchEvents.push(`${event.playerName} suffers a ${event.injuryType} and will miss ${event.weeks} week${event.weeks === 1 ? '' : 's'}.`));
  applyMatchInjuries(awayParticipants, awayMinutes, updatedPlayers, fixture.week, rng)
    .forEach(event => matchEvents.push(`${event.playerName} suffers a ${event.injuryType} and will miss ${event.weeks} week${event.weeks === 1 ? '' : 's'}.`));

  let winnerTeamId: string | undefined;
  let resolution: Fixture['resolution'] | undefined;
  if (fixture.isKnockout) {
    if (hScore === aScore) {
      const homePenaltyEdge = currentHomeXI.reduce((sum, player) => sum + player.overallRating, 0) + (GLOBAL_HOME_ADVANTAGE * 50);
      const awayPenaltyEdge = currentAwayXI.reduce((sum, player) => sum + player.overallRating, 0);
      const totalEdge = Math.max(1, homePenaltyEdge + awayPenaltyEdge);
      winnerTeamId = (random() * totalEdge) < homePenaltyEdge ? homeTeam.id : awayTeam.id;
      resolution = 'penalties';
      matchEvents.push(`${updatedTeams[winnerTeamId].name} keep their nerve and advance on penalties.`);
    } else {
      winnerTeamId = hScore > aScore ? homeTeam.id : awayTeam.id;
      resolution = 'regular';
    }
  }

  const updatedFixture = {
    ...fixture,
    homeScore: hScore,
    awayScore: aScore,
    isPlayed: true,
    winnerTeamId,
    resolution,
  };
  const includeTableStats = fixture.competitionType === 'league';

  const updateLog = (t: Team, gf: number, ga: number, matchStarters: Player[]) => ({
    ...applyMatchResult(t, gf, ga, includeTableStats),
    lastStartingXI: matchStarters.map(p => p.id),
  });

  updatedTeams[homeTeam.id] = updateLog(homeTeam, hScore, aScore, homeStarters);
  updatedTeams[awayTeam.id] = updateLog(awayTeam, aScore, hScore, awayStarters);

  return { players: updatedPlayers, teams: updatedTeams, fixture: updatedFixture, events: matchEvents };
};

// Form and morale modifiers are applied at the match call site.

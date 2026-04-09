import { Team, Player, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { getSlotsForFormation } from '../constants/formations';
import type { TeamShapeProfile } from './matchTypes';
import { buildQuickSimLineup } from './lineupEngine';
import { buildFallbackShapeProfile, buildTeamShapeProfile } from './shapeEngine';
import { applySubstitutions } from './substitutionEngine';
import { applySharedPostMatchAccounting } from './postMatchAccounting';
import { rebuildFormationMap } from './formationMapUtils';
import { applyMinuteCaps, buildStarterBenchMinuteMap } from './minuteMapUtils';
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
  if (random() > bigMomentChance) return { goal: false, event: null };

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
  if (!phase1Success && random() > ENGINE_CONFIG.PHASE_ONE_FAIL_ESCAPE_CHANCE) return { goal: false, event: null };

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
      const cardText = type === 'R' ? 'is shown a red card' : 'is booked';
      return { goal: false, event: `${activeDefender.name} stops the attack and ${cardText}.`, foul: { player: activeDefender, type } };
    }
    return { goal: false, event: null };
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
    let eventDesc = `GOAL! ${finisher.name} scores for ${attacker.name}!`;
    if (assister) eventDesc += ` (Assist: ${assister.name})`;

    return { goal: true, scorer: finisher, assister, event: eventDesc };
  }

  const missEvents = [
    `GREAT SAVE! ${gk.name} denies ${finisher.name}!`,
    `WIDE! ${finisher.name} misses the target.`,
    `TIPPED OVER! ${gk.name} saves the shot from ${finisher.name}!`,
    `BLOCK! ${activeDefender.name} denies ${finisher.name}!`
  ];
  return { goal: false, event: missEvents[Math.floor(random() * Math.min(missEvents.length, ENGINE_CONFIG.MISS_EVENT_POOL_SIZE))] };
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
  const rng = options?.rng || defaultRandomGenerator;
  const random = rng.next;
  const fixture = fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return { players, teams, fixture, events: [] };

  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };
  const matchEvents: string[] = [];

  const getTeamStarters = (teamId: string) => {
    const team = updatedTeams[teamId];
    const shouldPreserveManual = Boolean(userTeamId && teamId === userTeamId);
    if (shouldPreserveManual) {
      const teamPlayers = Object.values(updatedPlayers).filter(p => p.teamId === teamId);
      const eligibleTeamPlayers = teamPlayers.filter(p => p.matchesSuspended === 0);
      const savedStarters = teamPlayers.filter(player => player.isStarting);
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
      let starters = eligibleTeamPlayers.filter(p => p.isStarting);
      if (starters.length > 11) {
        const keepIds = new Set(starters
          .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1))
          .slice(0, 11)
          .map(p => p.id));
        starters.forEach(player => {
          if (!keepIds.has(player.id)) {
            updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: false, isSub: true };
          }
        });
      }
      starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
      if (starters.length < 11) {
        const fillCandidates = eligibleTeamPlayers
          .filter(player => !player.isStarting)
          .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1))
          .slice(0, 11 - starters.length);
        starters = [...starters, ...fillCandidates];
      }
      return starters.slice(0, 11);
    } else {
      const lineupUpdates = buildQuickSimLineup(teamId, updatedPlayers, team.activeFormation);
      Object.keys(lineupUpdates).forEach(id => {
        updatedPlayers[id] = { ...updatedPlayers[id], ...lineupUpdates[id] };
      });
    }
    const starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
    return starters;
  };

  const homeTeam = updatedTeams[fixture.homeTeamId];
  const awayTeam = updatedTeams[fixture.awayTeamId];
  const homeStarters = getTeamStarters(fixture.homeTeamId);
  const awayStarters = getTeamStarters(fixture.awayTeamId);
  const getBench = (teamId: string, matchStarters: Player[]) => {
    const starterIds = new Set(matchStarters.map(player => player.id));
    let bench = Object.values(updatedPlayers).filter(p => (
      p.teamId === teamId &&
      p.isSub &&
      p.matchesSuspended === 0 &&
      !starterIds.has(p.id)
    ));
    if (bench.length < 7) {
      const extra = Object.values(updatedPlayers)
        .filter(p => p.teamId === teamId && !p.isStarting && !p.isSub && p.matchesSuspended === 0 && !starterIds.has(p.id))
        .sort((a, b) => b.overallRating - a.overallRating)
        .slice(0, 7 - bench.length);
      extra.forEach(player => {
        updatedPlayers[player.id] = { ...updatedPlayers[player.id], isSub: true };
      });
      bench = Object.values(updatedPlayers).filter(p => (
        p.teamId === teamId &&
        p.isSub &&
        p.matchesSuspended === 0 &&
        !starterIds.has(p.id)
      ));
    }
    return bench.slice(0, 7);
  };
  const homeBench = getBench(fixture.homeTeamId, homeStarters);
  const awayBench = getBench(fixture.awayTeamId, awayStarters);

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

  const updatedFixture = { ...fixture, homeScore: hScore, awayScore: aScore, isPlayed: true };

  const updateLog = (t: Team, gf: number, ga: number, matchStarters: Player[]) => ({
    ...applyMatchResult(t, gf, ga),
    lastStartingXI: matchStarters.map(p => p.id),
  });

  updatedTeams[homeTeam.id] = updateLog(homeTeam, hScore, aScore, homeStarters);
  updatedTeams[awayTeam.id] = updateLog(awayTeam, aScore, hScore, awayStarters);

  return { players: updatedPlayers, teams: updatedTeams, fixture: updatedFixture, events: matchEvents };
};

// Form and morale modifiers are applied at the match call site.

import { Team, Player, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { getSlotsForFormation } from '../constants/formations';
import type { TeamShapeProfile } from './matchTypes';
import { buildQuickSimLineup } from './lineupEngine';
import { buildFallbackShapeProfile, buildTeamShapeProfile } from './shapeEngine';
import { applySubstitutions } from './substitutionEngine';
import { applyWindowedCleanSheets } from './postMatchAccounting';
import { rebuildFormationMap } from './formationMapUtils';
import {
  addPlayerStat,
  avgStat,
  clamp,
  getFormModifier,
  getMoraleModifier,
  getRoleGroups,
  inferRoleTag,
  runDuel,
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
  defenderShape?: TeamShapeProfile
): { goal: boolean; scorer?: Player; assister?: Player; event: string | null; foul?: { player: Player; type: 'Y' | 'R' } } => {
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
  let throughBallChance = 0.4; 

  const aTac = attacker.tactics;
  const dTac = defender.tactics;

  // Mentality: attacking choices affect the attack, defensive choices affect the defender.
  if (aTac.mentality === 'Attacking') { shootingBonus *= 1.1; passBonus *= 1.05; }
  if (aTac.mentality === 'Defensive') { shootingBonus *= 0.85; passBonus *= 1.05; }
  if (dTac.mentality === 'Attacking') defensiveBonus *= 0.88;
  if (dTac.mentality === 'Defensive') defensiveBonus *= 1.15;

  // Passing Style
  if (aTac.passingStyle === 'Short') { passBonus *= 1.15; throughBallChance = 0.25; }
  if (aTac.passingStyle === 'Direct') { passBonus *= 0.85; throughBallChance = 0.75; }

  // Defensive Line height multipliers
  const isHighLine = dTac.defensiveLine === 'High';
  const isDeepLine = dTac.defensiveLine === 'Deep';
  if (dTac.pressing === 'High') defensiveBonus *= 1.12;
  if (dTac.pressing === 'None') defensiveBonus *= 0.96;

  // Anti-Steamroll
  if (attackerGoals - defenderGoals >= ENGINE_CONFIG.STEAMROLL_MARGIN_1) defensiveBonus *= ENGINE_CONFIG.STEAMROLL_BONUS_1;
  if (attackerGoals - defenderGoals >= ENGINE_CONFIG.STEAMROLL_MARGIN_2) defensiveBonus *= ENGINE_CONFIG.STEAMROLL_BONUS_2;

  // Tempo and pressing should influence chance volume and shot profile.
  const tempoMultiplier = aTac.tempo === 'Fast' ? 1.01 : (aTac.tempo === 'Slow' ? 0.99 : 1.0);
  const defenderPressMultiplier = dTac.pressing === 'High' ? 0.99 : (dTac.pressing === 'None' ? 1.01 : 1.0);
  throughBallChance *= tempoMultiplier;
  shootingBonus *= 1.0;
  const bigMomentChance = Math.max(0.2, Math.min(0.8, ENGINE_CONFIG.BIG_MOMENT_CHANCE * tempoMultiplier * defenderPressMultiplier));

  // Chance a possession is interesting
  if (Math.random() > bigMomentChance) return { goal: false, event: null };

  // Phase 1: Midfield Build-up
  const progressionPool = [...attRoles.DM, ...attRoles.CM, ...attRoles.AM, ...attRoles.WIDE_MID, ...attRoles.FB, ...attRoles.WB];
  const activeMid = progressionPool.length > 0
    ? weightedPick(progressionPool, p => {
      const role = inferRoleTag(p);
      const roleMult = role === 'DM' ? 1.1 : (role === 'CM' ? 1.25 : (role === 'AM' ? 1.3 : 1.0));
      return (p.stats.passing + p.stats.dribbling * 0.4 + p.stats.pace * 0.2) * roleMult;
    })
    : (attPlayers.find(p => p.position === 'DEF') || attPlayers[0]);

  const defensiveWall = [...defRoles.DM, ...defRoles.CM, ...defDef];
  const midDefending = defensiveWall.length > 0
    ? (defensiveWall.reduce((sum, p) => sum + (p.stats.defending || 50), 0) / defensiveWall.length) * 0.90
    : 50;
  const gkSupport = gkDef[0]
    ? ((gkDef[0].stats.gk_positioning || gkDef[0].stats.gk_reflexes || 50) - 50) * 0.12
    : 0;
  const phaseOneDefense = midDefending + (isHighLine ? gkSupport : 0) + defShape.centralShield * 0.9;

  let interceptBonus = isHighLine ? 1.05 : (isDeepLine ? 0.95 : 1.0);
  if (dTac.pressing === 'High') interceptBonus *= 1.08;
  if (dTac.pressing === 'None') interceptBonus *= 0.95;

  // UNDERDOG BUFF: Increased Chaos Factor (from 0.15 to 0.25) so lower teams get through more often
  const buildOutEdge = attShape.buildOutSupport - defShape.centralShield;
  const phaseOneAttack = activeMid.stats.passing * passBonus * 1.1 * (1 + clamp(buildOutEdge * 0.02, -0.1, 0.16));
  const phase1Success = runDuel(phaseOneAttack, phaseOneDefense * interceptBonus, ENGINE_CONFIG.DUEL_LUCK_MIDFIELD);
  if (!phase1Success && Math.random() > 0.25) return { goal: false, event: null };

  // Phase 2: Final Third / Chance Creation
  const wideAttackWidth = attRoles.WINGER.length + attRoles.WB.length + attRoles.WIDE_MID.length;
  const centralAttackWidth = attRoles.DM.length + attRoles.CM.length + attRoles.AM.length + attRoles.ST.length;
  const shapeWideDelta = (attShape.widePresence - defShape.widePresence) * 0.03;
  const shapeCentralPenalty = (defShape.centralShield - attShape.centralShield) * 0.015;
  const wideRouteChance = clamp(0.32 + (wideAttackWidth - centralAttackWidth) * 0.04 + shapeWideDelta - shapeCentralPenalty, 0.15, 0.82);
  const isWideRoute = Math.random() < wideRouteChance;

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
    })
    : attPlayers[0];

  const defenderPool = isWideRoute
    ? [...defRoles.FB, ...defRoles.WB, ...defRoles.CB]
    : [...defRoles.DM, ...defRoles.CM, ...defRoles.CB];
  const activeDefender = defenderPool.length > 0
    ? weightedPick(defenderPool, p => (p.stats.defending || 50) + p.stats.pace * 0.15)
    : (defDef[0] || defPlayers[0]);

  const creatorRole = inferRoleTag(creator);
  const shieldStrength = avgStat([...defRoles.DM, ...defRoles.CM], p => (p.stats.defending || 50), 55);
  const throughBallSkill = creator.stats.passing > 70 ? 1.0 : 0.9;
  const roleThroughBallBoost = creatorRole === 'AM' || creatorRole === 'CM' ? 1.08 : 1.0;
  const shieldPenalty = shieldStrength > 72 ? 0.9 : 1.0;
  const shapeThroughBallBoost = attShape.finalThirdPresence > defShape.centralShield ? 1.05 : 0.95;
  const compactBlockPenalty = defShape.lineLoad.def >= 5 ? 0.96 : 1.0;
  const isThroughBall = Math.random() < (
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

  if (!runDuel(creationStat, defenderStat, ENGINE_CONFIG.DUEL_LUCK_ATTACK)) {
    if (Math.random() < ENGINE_CONFIG.FOUL_CHANCE) {
      const type = Math.random() < ENGINE_CONFIG.RED_CARD_CHANCE ? 'R' : 'Y';
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
  });

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

  if (runDuel(shotStat, reflexStat, ENGINE_CONFIG.DUEL_LUCK_SHOOTING)) {
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
  return { goal: false, event: missEvents[Math.floor(Math.random() * missEvents.length)] };
};


/** Pure function to simulate a match without Zustand overhead */
export const quickSimMatch = (
  fixtureId: string,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  userTeamId?: string | null
): { players: Record<string, Player>, teams: Record<string, Team>, fixture: Fixture, events: string[] } => {
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

  let scaledHome = homeStarters.map((p: Player) => ({ ...p, stats: { ...p.stats,
    passing: p.stats.passing * homeFormMult * homeMoraleMult * GLOBAL_HOME_ADVANTAGE,
    shooting: p.stats.shooting * homeFormMult * homeMoraleMult * GLOBAL_HOME_ADVANTAGE,
    defending: (p.stats.defending || 50) * homeFormMult * homeMoraleMult * GLOBAL_HOME_ADVANTAGE,
    dribbling: (p.stats.dribbling || 50) * homeFormMult * homeMoraleMult * GLOBAL_HOME_ADVANTAGE } }));

  let scaledAway = awayStarters.map((p: Player) => ({ ...p, stats: { ...p.stats,
    passing: p.stats.passing * awayFormMult * awayMoraleMult,
    shooting: p.stats.shooting * awayFormMult * awayMoraleMult,
    defending: (p.stats.defending || 50) * awayFormMult * awayMoraleMult,
    dribbling: (p.stats.dribbling || 50) * awayFormMult * awayMoraleMult } }));
  let homeShape = buildTeamShapeProfile(homeTeam, homeStarters);
  let awayShape = buildTeamShapeProfile(awayTeam, awayStarters);

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
    scaledHome = scaledHome.filter(p => p.id !== playerId);
    scaledAway = scaledAway.filter(p => p.id !== playerId);
    if (wasHome) homeShape = buildFallbackShapeProfile(scaledHome);
    if (wasAway) awayShape = buildFallbackShapeProfile(scaledAway);
  };

  for (let i = 0; i < ENGINE_CONFIG.TOTAL_POSSESSIONS; i++) {
    const minute = Math.max(1, Math.round(((i + 1) / ENGINE_CONFIG.TOTAL_POSSESSIONS) * 90));
    const isHomeAttacking = i % 2 === 0;
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
      defShape
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
          if (Math.random() < ENGINE_CONFIG.SECOND_YELLOW_RED_CHANCE) {
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

  const homeMinutes: Record<string, number> = Object.fromEntries(homeStarters.map(player => [player.id, 90]));
  const awayMinutes: Record<string, number> = Object.fromEntries(awayStarters.map(player => [player.id, 90]));
  Object.entries(sentOffMinutes).forEach(([playerId, minute]) => {
    if (homeMinutes[playerId] !== undefined) homeMinutes[playerId] = Math.min(homeMinutes[playerId], minute);
    if (awayMinutes[playerId] !== undefined) awayMinutes[playerId] = Math.min(awayMinutes[playerId], minute);
  });
  applySubstitutions(homeStarters, homeBench, sentOffPlayers, homeMinutes, homeTeam, hScore, aScore);
  applySubstitutions(awayStarters, awayBench, sentOffPlayers, awayMinutes, awayTeam, aScore, hScore);

  const assignPostMatchStats = (
    teamPlayers: Player[],
    minuteMap: Record<string, number>,
    oppGoals: number,
    isWin: boolean,
    isDraw: boolean
  ) => {
    teamPlayers.forEach(p => {
        const minutes = minuteMap[p.id] || 0;
        if (minutes <= 0) return;
        const team = updatedTeams[p.teamId];
        const drain = 25 * (minutes / 90) * (team.tactics.tempo === 'Fast' ? 1.3 : 1.0) * (team.tactics.pressing === 'High' ? 1.3 : 1.0);
        let rating = 6.0 + (Math.random() * 1.2 - 0.4);
        if (isWin) rating += 0.8;
        if (isDraw) rating += 0.2;
        if (!isWin && !isDraw) rating -= 0.6;
        if (oppGoals === 0 && (p.position === 'DEF' || p.position === 'GK')) rating += 1.0;
        rating += (p.impactCoefficient - 1.0);
        if (minutes < 30) rating -= 0.3;
        rating = Math.max(1.0, Math.min(10.0, Math.round(rating * 10) / 10));
        updatedPlayers[p.id] = {
           ...updatedPlayers[p.id],
           energy: Math.max(0, updatedPlayers[p.id].energy - drain),
           minutesPlayed: (updatedPlayers[p.id].minutesPlayed || 0) + minutes,
           matchRatingHistory: [...(updatedPlayers[p.id].matchRatingHistory || []), rating]
        };
    });
  };

  const homeParticipants = [...homeStarters, ...homeBench];
  const awayParticipants = [...awayStarters, ...awayBench];
  applyWindowedCleanSheets(
    homeParticipants,
    new Set(homeStarters.map(player => player.id)),
    homeMinutes,
    awayGoalMinutes,
    aScore,
    updatedPlayers
  );
  applyWindowedCleanSheets(
    awayParticipants,
    new Set(awayStarters.map(player => player.id)),
    awayMinutes,
    homeGoalMinutes,
    hScore,
    updatedPlayers
  );
  assignPostMatchStats(homeParticipants, homeMinutes, aScore, hScore > aScore, hScore === aScore);
  assignPostMatchStats(awayParticipants, awayMinutes, hScore, aScore > hScore, aScore === hScore);

  const updatedFixture = { ...fixture, homeScore: hScore, awayScore: aScore, isPlayed: true };

  const updateLog = (t: Team, gf: number, ga: number, matchStarters: Player[]) => {
    const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
    const token = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
    return {
      ...t,
      played: t.played + 1,
      wins: t.wins + (gf > ga ? 1 : 0),
      draws: t.draws + (gf === ga ? 1 : 0),
      losses: t.losses + (gf < ga ? 1 : 0),
      goalsFor: t.goalsFor + gf,
      goalsAgainst: t.goalsAgainst + ga,
      points: t.points + pts,
      form: [...(t.form || []), token].slice(-5),
      lastStartingXI: matchStarters.map(p => p.id)
    };
  };

  updatedTeams[homeTeam.id] = updateLog(homeTeam, hScore, aScore, homeStarters);
  updatedTeams[awayTeam.id] = updateLog(awayTeam, aScore, hScore, awayStarters);

  return { players: updatedPlayers, teams: updatedTeams, fixture: updatedFixture, events: matchEvents };
};

// Form and morale modifiers are applied at the match call site.

import { Team, Player, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { getSlotsForFormation } from '../constants/formations';
import type { PlayerCounterStat, RoleTag, TeamShapeProfile } from './matchTypes';
import { buildQuickSimLineup } from './lineupEngine';
import { buildFallbackShapeProfile, buildTeamShapeProfile } from './shapeEngine';
import { applySubstitutions } from './substitutionEngine';
import { applyWindowedCleanSheets } from './postMatchAccounting';
import { getFixtureStatScopeId, recordPlayerScopedMinutes, recordPlayerScopedStat } from './playerStats';
import { resolveCupWinnerTeamId } from './competitionUtils';
import { getFixtureCompetitionId, isLeagueCompetitionId } from './domainRegistry';
import { rebuildFormationMap } from './formationMapUtils';
import { clamp, getFormModifier, getMoraleModifier, getRoleGroups, inferRoleTag, runDuel } from './matchUtils';
import { SimulationRuntime } from './simulationRuntime';
import { compileMatchEffects, CompiledMatchEffects } from './tacticalEffects';

export { autoAssignLineup } from './lineupEngine';
export { buildTeamShapeProfile } from './shapeEngine';
export { getFormModifier, getMoraleModifier, runDuel } from './matchUtils';

type WeightedPool<T> = {
  items: T[];
  cumulativeWeights: number[];
  totalWeight: number;
};

type MatchTeamContext = {
  players: Player[];
  roles: ReturnType<typeof getRoleGroups>;
  shape: TeamShapeProfile;
  effects: CompiledMatchEffects;
  progressionFallback: Player;
  defenderFallback: Player;
  goalkeeper: Player;
  progressionPool: WeightedPool<Player> | null;
  creatorWidePool: WeightedPool<Player> | null;
  creatorCentralPool: WeightedPool<Player> | null;
  creatorFallbackPool: WeightedPool<Player> | null;
  defenderWidePool: WeightedPool<Player> | null;
  defenderCentralPool: WeightedPool<Player> | null;
  finisherPool: WeightedPool<Player> | null;
  passBonusBase: number;
  shootingBonusBase: number;
  throughBallChanceBase: number;
  defensiveBonusBase: number;
  interceptBonusBase: number;
  tempoMultiplier: number;
  pressDisruptionMultiplier: number;
  isHighLine: boolean;
  isDeepLine: boolean;
  midDefending: number;
  shieldStrength: number;
  gkSupport: number;
  gkShotStop: number;
  gkPosition: number;
  gkHandling: number;
  wideAttackWidth: number;
  centralAttackWidth: number;
  compactBlockPenalty: number;
  energyDrainMultiplier: number;
};

type QuickSimOptions = {
  possessionCount?: number;
  captureEvents?: boolean;
  teamPlayerIds?: Record<string, string[]>;
  runtime?: SimulationRuntime;
  random?: () => number;
};

const EMPTY_POSSESSION_RESULT = { goal: false, event: null } as const;
const PROGRESSION_ROLE_WEIGHTS: Partial<Record<RoleTag, number>> = { DM: 1.1, CM: 1.25, AM: 1.3 };
const CREATOR_ROLE_WEIGHTS: Partial<Record<RoleTag, number>> = { AM: 1.25, CM: 1.1 };

const buildWeightedPool = <T,>(items: T[], getWeight: (item: T) => number): WeightedPool<T> | null => {
  if (items.length === 0) return null;

  const cumulativeWeights = new Array<number>(items.length);
  let totalWeight = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    totalWeight += Math.max(0.1, getWeight(item));
    cumulativeWeights[index] = totalWeight;
  }

  return { items, cumulativeWeights, totalWeight };
};

const pickFromWeightedPool = <T,>(pool: WeightedPool<T> | null, fallback: T, random: () => number = Math.random): T => {
  if (!pool || pool.items.length === 0) return fallback;

  const roll = random() * pool.totalWeight;
  let low = 0;
  let high = pool.cumulativeWeights.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (roll <= pool.cumulativeWeights[middle]) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return pool.items[low] || fallback;
};

const roleWeightMultiplier = (role: RoleTag, weights: Partial<Record<RoleTag, number>>) => weights[role] || 1.0;

const concatPlayerGroups = (...groups: Player[][]) => {
  let totalLength = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    totalLength += groups[groupIndex].length;
  }

  const players = new Array<Player>(totalLength);
  let insertIndex = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    for (let playerIndex = 0; playerIndex < group.length; playerIndex += 1) {
      players[insertIndex] = group[playerIndex];
      insertIndex += 1;
    }
  }
  return players;
};

const avgGroupedStat = (
  groups: Player[][],
  getStat: (player: Player) => number,
  fallback: number
) => {
  let total = 0;
  let count = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    for (let playerIndex = 0; playerIndex < group.length; playerIndex += 1) {
      total += getStat(group[playerIndex]);
      count += 1;
    }
  }
  return count === 0 ? fallback : total / count;
};

const pickMissEvent = (
  goalkeeperName: string,
  finisherName: string,
  defenderName: string,
  random: () => number = Math.random
) => {
  switch (Math.floor(random() * 4)) {
    case 0:
      return `GREAT SAVE! ${goalkeeperName} denies ${finisherName}!`;
    case 1:
      return `WIDE! ${finisherName} misses the target.`;
    case 2:
      return `TIPPED OVER! ${goalkeeperName} saves the shot from ${finisherName}!`;
    default:
      return `BLOCK! ${defenderName} denies ${finisherName}!`;
  }
};

const buildMinuteMap = (players: Player[]) => {
  const minuteMap: Record<string, number> = {};
  for (let index = 0; index < players.length; index += 1) {
    minuteMap[players[index].id] = 90;
  }
  return minuteMap;
};

const buildPlayerIdSet = (players: Player[]) => {
  const playerIds = new Set<string>();
  for (let index = 0; index < players.length; index += 1) {
    playerIds.add(players[index].id);
  }
  return playerIds;
};

const buildPlayerIdList = (players: Player[]) => {
  const playerIds = new Array(players.length);
  for (let index = 0; index < players.length; index += 1) {
    playerIds[index] = players[index].id;
  }
  return playerIds;
};

const combinePlayers = (primary: Player[], secondary: Player[]) => {
  const combined = primary.slice();
  for (let index = 0; index < secondary.length; index += 1) {
    combined.push(secondary[index]);
  }
  return combined;
};

const appendFormToken = (form: string[] | undefined, token: string) => {
  if (!form || form.length === 0) return [token];
  const nextForm = form.length >= 5 ? form.slice(form.length - 4) : form.slice();
  nextForm.push(token);
  return nextForm;
};

export const buildMatchTeamContext = (
  team: Team,
  players: Player[],
  shape?: TeamShapeProfile
): MatchTeamContext => {
  const roles = getRoleGroups(players);
  const actualShape = shape || buildFallbackShapeProfile(players);
  const effects = compileMatchEffects(team, players);
  const midAtt = concatPlayerGroups(roles.DM, roles.CM, roles.AM, roles.WIDE_MID);
  const fwdAtt = concatPlayerGroups(roles.ST, roles.WINGER);
  const defDef = concatPlayerGroups(roles.CB, roles.FB, roles.WB);
  const gkDef = roles.GK;
  const progressionPoolPlayers = concatPlayerGroups(roles.DM, roles.CM, roles.AM, roles.WIDE_MID, roles.FB, roles.WB);
  const creatorWidePlayers = concatPlayerGroups(roles.WINGER, roles.WB, roles.WIDE_MID, roles.AM);
  const creatorCentralPlayers = concatPlayerGroups(roles.AM, roles.CM, roles.DM, roles.ST);
  const creatorFallbackPlayers = concatPlayerGroups(fwdAtt, midAtt);
  const defenderWidePlayers = concatPlayerGroups(roles.FB, roles.WB, roles.CB);
  const defenderCentralPlayers = concatPlayerGroups(roles.DM, roles.CM, roles.CB);
  const finisherPlayers = concatPlayerGroups(roles.ST, roles.WINGER, roles.AM, midAtt);

  const goalkeeper = gkDef[0] || players[0];
  const gkPositioning = goalkeeper?.stats.gk_positioning || goalkeeper?.stats.gk_reflexes || 50;

  return {
    players,
    roles,
    shape: actualShape,
    effects,
    progressionFallback: players.find(player => player.position === 'DEF') || players[0],
    defenderFallback: defDef[0] || players[0],
    goalkeeper,
    progressionPool: buildWeightedPool(progressionPoolPlayers, player => {
      const role = inferRoleTag(player);
      const roleMult = roleWeightMultiplier(role, PROGRESSION_ROLE_WEIGHTS);
      return (player.stats.passing + player.stats.dribbling * 0.4 + player.stats.pace * 0.2) * roleMult;
    }),
    creatorWidePool: buildWeightedPool(creatorWidePlayers, player => {
      const role = inferRoleTag(player);
      const roleBoost = roleWeightMultiplier(role, CREATOR_ROLE_WEIGHTS);
      return (player.stats.passing * 0.9 + player.stats.dribbling * 0.8 + player.stats.pace * 0.3) * roleBoost;
    }),
    creatorCentralPool: buildWeightedPool(creatorCentralPlayers, player => {
      const role = inferRoleTag(player);
      const roleBoost = roleWeightMultiplier(role, CREATOR_ROLE_WEIGHTS);
      return (player.stats.passing * 0.9 + player.stats.dribbling * 0.8 + player.stats.pace * 0.3) * roleBoost;
    }),
    creatorFallbackPool: buildWeightedPool(creatorFallbackPlayers, player => {
      const role = inferRoleTag(player);
      const roleBoost = roleWeightMultiplier(role, CREATOR_ROLE_WEIGHTS);
      return (player.stats.passing * 0.9 + player.stats.dribbling * 0.8 + player.stats.pace * 0.3) * roleBoost;
    }),
    defenderWidePool: buildWeightedPool(defenderWidePlayers, player => (player.stats.defending || 50) + player.stats.pace * 0.15),
    defenderCentralPool: buildWeightedPool(defenderCentralPlayers, player => (player.stats.defending || 50) + player.stats.pace * 0.15),
    finisherPool: buildWeightedPool(finisherPlayers.length > 0 ? finisherPlayers : players, player => {
      const shooting = player.stats.shooting || 50;
      const role = inferRoleTag(player);
      const roleMultiplier =
        role === 'ST' ? 1.45 :
        role === 'WINGER' ? 1.2 :
        role === 'AM' ? 1.05 :
        (player.position === 'MID' ? 0.85 : 0.3);
      return Math.max(1, shooting - 55) * roleMultiplier;
    }),
    passBonusBase: effects.buildUp.passBonusMultiplier,
    shootingBonusBase: effects.finishing.shootingBonusMultiplier,
    throughBallChanceBase: effects.buildUp.throughBallChance,
    defensiveBonusBase: effects.defensiveStructure.defensiveBonusMultiplier,
    interceptBonusBase: effects.defensiveStructure.interceptBonusMultiplier,
    tempoMultiplier: effects.chanceCreation.tempoMultiplier,
    pressDisruptionMultiplier: effects.defensiveStructure.pressDisruptionMultiplier,
    isHighLine: effects.defensiveStructure.isHighLine,
    isDeepLine: effects.defensiveStructure.isDeepLine,
    midDefending: avgGroupedStat([roles.DM, roles.CM, roles.CB, roles.FB, roles.WB], player => (player.stats.defending || 50), 50) * 0.9,
    shieldStrength: avgGroupedStat([roles.DM, roles.CM], player => (player.stats.defending || 50), 55),
    gkSupport: (gkPositioning - 50) * 0.12,
    gkShotStop: goalkeeper?.stats.gk_reflexes || goalkeeper?.stats.defending || 65,
    gkPosition: goalkeeper?.stats.gk_positioning || 60,
    gkHandling: goalkeeper?.stats.gk_handling || 55,
    wideAttackWidth: roles.WINGER.length + roles.WB.length + roles.WIDE_MID.length,
    centralAttackWidth: roles.DM.length + roles.CM.length + roles.AM.length + roles.ST.length,
    compactBlockPenalty: actualShape.lineLoad.def >= 5 ? 0.96 : 1.0,
    energyDrainMultiplier: effects.energyDrain.multiplier,
  };
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
  attackerContext?: MatchTeamContext,
  defenderContext?: MatchTeamContext,
  captureEventText = true,
  random: () => number = Math.random
): { goal: boolean; scorer?: Player; assister?: Player; event: string | null; foul?: { player: Player; type: 'Y' | 'R' } } => {
  if (attPlayers.length === 0 || defPlayers.length === 0) return EMPTY_POSSESSION_RESULT;
  const attContext = attackerContext || buildMatchTeamContext(attacker, attPlayers, attackerShape);
  const defContext = defenderContext || buildMatchTeamContext(defender, defPlayers, defenderShape);
  const attShape = attContext.shape;
  const defShape = defContext.shape;
  const gk = defContext.goalkeeper;

  // --- Tactical Multipliers ---
  const passBonus = attContext.passBonusBase;
  const shootingBonus = attContext.shootingBonusBase;
  let defensiveBonus = defContext.defensiveBonusBase;
  let throughBallChance = attContext.throughBallChanceBase;

  // Anti-Steamroll
  if (attackerGoals - defenderGoals >= ENGINE_CONFIG.STEAMROLL_MARGIN_1) defensiveBonus *= ENGINE_CONFIG.STEAMROLL_BONUS_1;
  if (attackerGoals - defenderGoals >= ENGINE_CONFIG.STEAMROLL_MARGIN_2) defensiveBonus *= ENGINE_CONFIG.STEAMROLL_BONUS_2;

  // Tempo and pressing should influence chance volume and shot profile.
  throughBallChance *= attContext.tempoMultiplier;
  const bigMomentChance = Math.max(0.2, Math.min(0.8, ENGINE_CONFIG.BIG_MOMENT_CHANCE * attContext.tempoMultiplier * defContext.pressDisruptionMultiplier));

  // Chance a possession is interesting
  if (random() > bigMomentChance) return EMPTY_POSSESSION_RESULT;

  // Phase 1: Midfield Build-up
  const activeMid = pickFromWeightedPool(attContext.progressionPool, attContext.progressionFallback, random);
  const phaseOneDefense = defContext.midDefending + (defContext.isHighLine ? defContext.gkSupport : 0) + defShape.centralShield * 0.9;

  // UNDERDOG BUFF: Increased Chaos Factor (from 0.15 to 0.25) so lower teams get through more often
  const buildOutEdge = attShape.buildOutSupport - defShape.centralShield;
  const phaseOneAttack = activeMid.stats.passing * passBonus * 1.1 * (1 + clamp(buildOutEdge * 0.02, -0.1, 0.16));
  const phase1Success = runDuel(phaseOneAttack, phaseOneDefense * defContext.interceptBonusBase, ENGINE_CONFIG.DUEL_LUCK_MIDFIELD, random);
  if (!phase1Success && random() > 0.25) return EMPTY_POSSESSION_RESULT;

  // Phase 2: Final Third / Chance Creation
  const shapeWideDelta = (attShape.widePresence - defShape.widePresence) * 0.03;
  const shapeCentralPenalty = (defShape.centralShield - attShape.centralShield) * 0.015;
  const wideRouteChance = clamp(
    0.32 +
      (attContext.wideAttackWidth - attContext.centralAttackWidth) * 0.04 +
      shapeWideDelta -
      shapeCentralPenalty +
      attContext.effects.chanceCreation.wideRouteBias,
    0.15,
    0.82
  );
  const isWideRoute = random() < wideRouteChance;

  const creator = isWideRoute
    ? pickFromWeightedPool(attContext.creatorWidePool || attContext.creatorFallbackPool, attPlayers[0], random)
    : pickFromWeightedPool(attContext.creatorCentralPool || attContext.creatorFallbackPool, attPlayers[0], random);
  const activeDefender = isWideRoute
    ? pickFromWeightedPool(defContext.defenderWidePool, defContext.defenderFallback, random)
    : pickFromWeightedPool(defContext.defenderCentralPool, defContext.defenderFallback, random);

  const creatorRole = inferRoleTag(creator);
  const throughBallSkill = creator.stats.passing > 70 ? 1.0 : 0.9;
  const roleThroughBallBoost = creatorRole === 'AM' || creatorRole === 'CM' ? 1.08 : 1.0;
  const shieldPenalty = defContext.shieldStrength > 72 ? 0.9 : 1.0;
  const shapeThroughBallBoost = attShape.finalThirdPresence > defShape.centralShield ? 1.05 : 0.95;
  const isThroughBall = random() < (
    throughBallChance * throughBallSkill * roleThroughBallBoost * shieldPenalty * shapeThroughBallBoost * defContext.compactBlockPenalty
  );

  // Use Physicality for target-man types in Phase 2
  let creationStat = isThroughBall
    ? (creator.stats.passing * 1.1)
    : Math.max(creator.stats.dribbling || 70, (creator.stats.physical || 70) * 0.9);
  if (isWideRoute) creationStat = Math.max(creationStat, creator.stats.pace * 0.95 + creator.stats.dribbling * 0.4);

  creationStat *= passBonus * attContext.effects.chanceCreation.creatorBonusMultiplier;
  const routeShapeBoost = isWideRoute
    ? (1 + clamp((attShape.widePresence - defShape.widePresence) * 0.02, -0.08, 0.12))
    : (1 + clamp((attShape.centralShield - defShape.centralShield) * 0.02, -0.08, 0.1));
  creationStat *= routeShapeBoost;
  let defenderStat = (activeDefender.stats.defending || 60) * defensiveBonus;

  if (isThroughBall && defContext.isHighLine) defenderStat *= 0.85;
  if (isThroughBall && defContext.isDeepLine) defenderStat *= 1.1;

  if (!runDuel(creationStat, defenderStat, ENGINE_CONFIG.DUEL_LUCK_ATTACK, random)) {
    if (random() < ENGINE_CONFIG.FOUL_CHANCE) {
      const type = random() < ENGINE_CONFIG.RED_CARD_CHANCE ? 'R' : 'Y';
      const event = captureEventText
        ? `${activeDefender.name} stops the attack and ${type === 'R' ? 'is shown a red card' : 'is booked'}.`
        : null;
      return { goal: false, event, foul: { player: activeDefender, type } };
    }
    return EMPTY_POSSESSION_RESULT;
  }

  // Phase 3: Finishing
  const finisher = pickFromWeightedPool(attContext.finisherPool, attPlayers[0], random);
  let shotStat = (finisher.stats.shooting || 70) * shootingBonus;
  shotStat *= 1 + clamp((attShape.boxTargetPresence - defShape.lineLoad.def) * 0.025, -0.08, 0.1);

  // Toned down impact boost further to prevent 150-goal seasons
  if (finisher.impactCoefficient > 1.2) shotStat *= (1.0 + (finisher.impactCoefficient - 1.0) * 0.15);

  let reflexStat = (defContext.gkShotStop * 0.6) + (defContext.gkPosition * 0.25) + (defContext.gkHandling * 0.15);
  reflexStat *= 1 + clamp((defShape.lineLoad.def - attShape.boxTargetPresence) * 0.012, -0.04, 0.06);

  if (runDuel(shotStat, reflexStat, ENGINE_CONFIG.DUEL_LUCK_SHOOTING, random)) {
    const assister = creator.id !== finisher.id ? creator : undefined;
    let eventDesc: string | null = null;
    if (captureEventText) {
      eventDesc = `GOAL! ${finisher.name} scores for ${attacker.name}!`;
      if (assister) eventDesc += ` (Assist: ${assister.name})`;
    }

    return { goal: true, scorer: finisher, assister, event: eventDesc };
  }

  if (!captureEventText) return EMPTY_POSSESSION_RESULT;
  return { goal: false, event: pickMissEvent(gk.name, finisher.name, activeDefender.name, random) };
};


/** Pure function to simulate a match without Zustand overhead */
export const quickSimMatch = (
  fixtureId: string,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  userTeamId?: string | null,
  options?: QuickSimOptions
): { players: Record<string, Player>, teams: Record<string, Team>, fixture: Fixture, events: string[] } => {
  const fixture = fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return { players, teams, fixture, events: [] };

  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };
  const matchEvents: string[] = [];
  const statScopeId = getFixtureStatScopeId(fixture);
  const possessionCount = Math.max(1, Math.floor(options?.possessionCount || ENGINE_CONFIG.TOTAL_POSSESSIONS));
  const captureEvents = options?.captureEvents ?? true;
  const random = options?.random || options?.runtime?.random || Math.random;
  const touchedPlayerIds = new Set<string>();
  const homeTeamId = fixture.homeTeamId;
  const awayTeamId = fixture.awayTeamId;
  const providedTeamPlayerIds = options?.teamPlayerIds || options?.runtime?.teamPlayerIds;
  const hasProvidedHomePlayerIds = providedTeamPlayerIds?.[homeTeamId] !== undefined;
  const hasProvidedAwayPlayerIds = providedTeamPlayerIds?.[awayTeamId] !== undefined;
  const teamPlayerIds: Record<string, string[]> = {
    [homeTeamId]: providedTeamPlayerIds?.[homeTeamId] || [],
    [awayTeamId]: providedTeamPlayerIds?.[awayTeamId] || [],
  };

  if (!hasProvidedHomePlayerIds || !hasProvidedAwayPlayerIds) {
    Object.values(updatedPlayers).forEach(player => {
      if (player.teamId === homeTeamId && !hasProvidedHomePlayerIds) {
        teamPlayerIds[homeTeamId].push(player.id);
      } else if (player.teamId === awayTeamId && !hasProvidedAwayPlayerIds) {
        teamPlayerIds[awayTeamId].push(player.id);
      }
    });
  }

  const getMutablePlayer = (playerId: string) => {
    const player = updatedPlayers[playerId];
    if (!player) return null;
    if (!touchedPlayerIds.has(playerId)) {
      updatedPlayers[playerId] = { ...player };
      touchedPlayerIds.add(playerId);
    }
    return updatedPlayers[playerId];
  };

  const assignPlayerUpdates = (playerId: string, updates: Partial<Player>) => {
    const player = getMutablePlayer(playerId);
    if (!player) return;
    Object.assign(player, updates);
  };

  const incrementPlayerStatLocal = (
    playerId: string,
    stat: PlayerCounterStat,
    amount = 1
  ) => {
    getMutablePlayer(playerId);
    recordPlayerScopedStat(updatedPlayers, playerId, statScopeId, stat, amount);
  };

  const collectTeamPlayers = (
    teamId: string,
    predicate?: (player: Player) => boolean
  ) => {
    const teamPlayers: Player[] = [];
    const playerIds = teamPlayerIds[teamId] || [];
    for (const playerId of playerIds) {
      const player = updatedPlayers[playerId];
      if (!player) continue;
      if (predicate && !predicate(player)) continue;
      teamPlayers.push(player);
    }
    return teamPlayers;
  };

  const getTeamStarters = (teamId: string) => {
    const team = updatedTeams[teamId];
    const shouldPreserveManual = Boolean(userTeamId && teamId === userTeamId);
    if (shouldPreserveManual) {
      const teamPlayers = collectTeamPlayers(teamId);
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
            assignPlayerUpdates(player.id, { isStarting: true, isSub: false });
          } else if (enforceMapXi && player.isStarting) {
            assignPlayerUpdates(player.id, { isStarting: false, isSub: true });
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
            assignPlayerUpdates(player.id, { isStarting: false, isSub: true });
          }
        });
      }
      starters = collectTeamPlayers(teamId, player => player.isStarting && player.matchesSuspended === 0);
      if (starters.length < 11) {
        const fillCandidates = eligibleTeamPlayers
          .filter(player => !player.isStarting)
          .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1))
          .slice(0, 11 - starters.length);
        starters = [...starters, ...fillCandidates];
      }
      return starters.slice(0, 11);
    } else {
      const lineupUpdates = buildQuickSimLineup(
        teamId,
        updatedPlayers,
        team.activeFormation,
        collectTeamPlayers(teamId, player => player.matchesSuspended === 0)
      );
      Object.keys(lineupUpdates).forEach(id => {
        assignPlayerUpdates(id, lineupUpdates[id]);
      });
    }
    const starters = collectTeamPlayers(teamId, player => player.isStarting && player.matchesSuspended === 0);
    return starters;
  };

  const homeTeam = updatedTeams[homeTeamId];
  const awayTeam = updatedTeams[awayTeamId];
  const homeStarters = getTeamStarters(homeTeamId);
  const awayStarters = getTeamStarters(awayTeamId);
  const getBench = (teamId: string, matchStarters: Player[]) => {
    const starterIds = new Set(matchStarters.map(player => player.id));
    let bench = collectTeamPlayers(teamId, player => (
      player.isSub &&
      player.matchesSuspended === 0 &&
      !starterIds.has(player.id)
    ));
    if (bench.length < 7) {
      const extra = collectTeamPlayers(teamId, player => (
        !player.isStarting &&
        !player.isSub &&
        player.matchesSuspended === 0 &&
        !starterIds.has(player.id)
      ))
        .sort((a, b) => b.overallRating - a.overallRating)
        .slice(0, 7 - bench.length);
      extra.forEach(player => {
        assignPlayerUpdates(player.id, { isSub: true });
      });
      bench = collectTeamPlayers(teamId, player => (
        player.isSub &&
        player.matchesSuspended === 0 &&
        !starterIds.has(player.id)
      ));
    }
    return bench.slice(0, 7);
  };
  const homeBench = getBench(homeTeamId, homeStarters);
  const awayBench = getBench(awayTeamId, awayStarters);

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
  let homeContext = buildMatchTeamContext(homeTeam, scaledHome, homeShape);
  let awayContext = buildMatchTeamContext(awayTeam, scaledAway, awayShape);

  const matchYellowCards = new Set<string>();
  const sentOffPlayers = new Set<string>();
  const sentOffMinutes: Record<string, number> = {};
  const sendOffPlayer = (playerId: string, minute: number) => {
    const player = getMutablePlayer(playerId);
    if (!player || sentOffPlayers.has(playerId)) return;
    player.matchesSuspended = 3;
    recordPlayerScopedStat(updatedPlayers, playerId, statScopeId, 'redCards');
    sentOffPlayers.add(playerId);
    sentOffMinutes[playerId] = minute;
    const wasHome = scaledHome.some(p => p.id === playerId);
    const wasAway = scaledAway.some(p => p.id === playerId);
    scaledHome = scaledHome.filter(p => p.id !== playerId);
    scaledAway = scaledAway.filter(p => p.id !== playerId);
    if (wasHome) {
      homeShape = buildFallbackShapeProfile(scaledHome);
      homeContext = buildMatchTeamContext(homeTeam, scaledHome, homeShape);
    }
    if (wasAway) {
      awayShape = buildFallbackShapeProfile(scaledAway);
      awayContext = buildMatchTeamContext(awayTeam, scaledAway, awayShape);
    }
  };

  for (let i = 0; i < possessionCount; i++) {
    const minute = Math.max(1, Math.round(((i + 1) / possessionCount) * 90));
    const isHomeAttacking = i % 2 === 0;
    const attTeam = isHomeAttacking ? homeTeam : awayTeam;
    const defTeam = isHomeAttacking ? awayTeam : homeTeam;
    const attPlayers = isHomeAttacking ? scaledHome : scaledAway;
    const defPlayers = isHomeAttacking ? scaledAway : scaledHome;
    const attShape = isHomeAttacking ? homeShape : awayShape;
    const defShape = isHomeAttacking ? awayShape : homeShape;
    const attContext = isHomeAttacking ? homeContext : awayContext;
    const defContext = isHomeAttacking ? awayContext : homeContext;

    const poss = simulatePossession(
      attTeam,
      defTeam,
      attPlayers,
      defPlayers,
      isHomeAttacking ? hScore : aScore,
      isHomeAttacking ? aScore : hScore,
      attShape,
      defShape,
      attContext,
      defContext,
      captureEvents,
      random
    );
    if (captureEvents && poss.event) matchEvents.push(poss.event);
    if (poss.goal) {
      if (isHomeAttacking) {
        hScore++;
        homeGoalMinutes.push(minute);
      } else {
        aScore++;
        awayGoalMinutes.push(minute);
      }
      if (poss.scorer) incrementPlayerStatLocal(poss.scorer.id, 'goals');
      if (poss.assister) incrementPlayerStatLocal(poss.assister.id, 'assists');
    }
    if (poss.foul) {
      if (!isLeagueCompetitionId(getFixtureCompetitionId(fixture))) continue;
      const playerId = poss.foul.player.id;
      if (sentOffPlayers.has(playerId)) continue;
      if (poss.foul.type === 'Y') {
        if (matchYellowCards.has(playerId)) {
          if (random() < ENGINE_CONFIG.SECOND_YELLOW_RED_CHANCE) {
            incrementPlayerStatLocal(playerId, 'yellowCards');
            sendOffPlayer(playerId, minute);
            if (captureEvents) {
              matchEvents.push(`${poss.foul.player.name} receives a second yellow and is sent off.`);
            }
          }
        } else {
          incrementPlayerStatLocal(playerId, 'yellowCards');
          matchYellowCards.add(playerId);
        }
      } else {
        sendOffPlayer(playerId, minute);
      }
    }
  }

  const homeMinutes = buildMinuteMap(homeStarters);
  const awayMinutes = buildMinuteMap(awayStarters);
  Object.entries(sentOffMinutes).forEach(([playerId, minute]) => {
    if (homeMinutes[playerId] !== undefined) homeMinutes[playerId] = Math.min(homeMinutes[playerId], minute);
    if (awayMinutes[playerId] !== undefined) awayMinutes[playerId] = Math.min(awayMinutes[playerId], minute);
  });
  applySubstitutions(homeStarters, homeBench, sentOffPlayers, homeMinutes, homeTeam, hScore, aScore);
  applySubstitutions(awayStarters, awayBench, sentOffPlayers, awayMinutes, awayTeam, aScore, hScore);

  const energyMultiplier = isLeagueCompetitionId(getFixtureCompetitionId(fixture)) ? 1 : 0.5;

  const assignPostMatchStats = (
    teamPlayers: Player[],
    minuteMap: Record<string, number>,
    oppGoals: number,
    isWin: boolean,
    isDraw: boolean,
    energyDrainMultiplier: number
  ) => {
    teamPlayers.forEach(p => {
        const minutes = minuteMap[p.id] || 0;
        if (minutes <= 0) return;
        const drain = 25 * (minutes / 90) * energyDrainMultiplier * energyMultiplier;
        let rating = 6.0 + (random() * 1.2 - 0.4);
        if (isWin) rating += 0.8;
        if (isDraw) rating += 0.2;
        if (!isWin && !isDraw) rating -= 0.6;
        if (oppGoals === 0 && (p.position === 'DEF' || p.position === 'GK')) rating += 1.0;
        rating += (p.impactCoefficient - 1.0);
        if (minutes < 30) rating -= 0.3;
        rating = Math.max(1.0, Math.min(10.0, Math.round(rating * 10) / 10));
        const player = getMutablePlayer(p.id);
        if (!player) return;
        player.energy = Math.max(0, player.energy - drain);
        recordPlayerScopedMinutes(updatedPlayers, p.id, statScopeId, minutes);
        const nextPlayer = updatedPlayers[p.id];
        if (!nextPlayer) return;
        nextPlayer.matchRatingHistory = nextPlayer.matchRatingHistory
          ? [...nextPlayer.matchRatingHistory, rating]
          : [rating];
    });
  };

  const homeParticipants = combinePlayers(homeStarters, homeBench);
  const awayParticipants = combinePlayers(awayStarters, awayBench);
  applyWindowedCleanSheets(
    homeParticipants,
    buildPlayerIdSet(homeStarters),
    homeMinutes,
    awayGoalMinutes,
    aScore,
    updatedPlayers,
    statScopeId
  );
  applyWindowedCleanSheets(
    awayParticipants,
    buildPlayerIdSet(awayStarters),
    awayMinutes,
    homeGoalMinutes,
    hScore,
    updatedPlayers,
    statScopeId
  );
  assignPostMatchStats(homeParticipants, homeMinutes, aScore, hScore > aScore, hScore === aScore, homeContext.energyDrainMultiplier);
  assignPostMatchStats(awayParticipants, awayMinutes, hScore, aScore > hScore, aScore === hScore, awayContext.energyDrainMultiplier);

  const updatedFixture = { ...fixture, homeScore: hScore, awayScore: aScore, isPlayed: true };
  const winnerTeamId = resolveCupWinnerTeamId(updatedFixture, hScore, aScore, random);
  if (winnerTeamId) {
    updatedFixture.winnerTeamId = winnerTeamId;
    if (hScore === aScore) updatedFixture.decidedBy = 'PEN';
  }

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
      form: appendFormToken(t.form, token),
      lastStartingXI: buildPlayerIdList(matchStarters)
    };
  };

  if (isLeagueCompetitionId(getFixtureCompetitionId(fixture))) {
    updatedTeams[homeTeam.id] = updateLog(homeTeam, hScore, aScore, homeStarters);
    updatedTeams[awayTeam.id] = updateLog(awayTeam, aScore, hScore, awayStarters);
  } else {
    updatedTeams[homeTeam.id] = { ...homeTeam, lastStartingXI: buildPlayerIdList(homeStarters) };
    updatedTeams[awayTeam.id] = { ...awayTeam, lastStartingXI: buildPlayerIdList(awayStarters) };
  }

  return { players: updatedPlayers, teams: updatedTeams, fixture: updatedFixture, events: matchEvents };
};

// Form and morale modifiers are applied at the match call site.

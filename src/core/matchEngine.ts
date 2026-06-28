import { Team, Player, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { getTeamMatchBench, getTeamMatchStarters } from './lineupEngine';
import { applySharedPostMatchAccounting, PlayerMatchContribution } from './postMatchAccounting';
import { rebuildFormationMap, removePlayerFromTeamSelections } from './formationMapUtils';
import { applyMinuteCaps, buildStarterBenchMinuteMap, EXTRA_TIME_MATCH_MINUTES, REGULATION_MATCH_MINUTES } from './minuteMapUtils';
import { applyMatchInjuries } from './injuryEngine';
import { isPlayerUnavailable } from './playerStatusUtils';
import { createFixtureEventRandomGenerator, RandomGenerator } from './random';
import { selectEmergencyGoalkeeperId, selectDesignatedGoalkeeperId, validateMatchdayXI } from './matchdayValidation';
import { applyFixtureSuspensionService, buildVoidFixture, getAdministrativeFixtureOutcome } from './fixtureLifecycle';
import { applyFixtureTeamResults, resolveAdministrativeFixture } from './matchFinalization';
import { buildMatchSummary } from './matchSummary';
import {
  applySubstitutions,
  canUseSubstitutionWindow,
  createSubstitutionState,
  recordSubstitution,
} from './matchSubstitutions';
import { addPlayerStat, getFormModifier } from './matchUtils';
import {
  buildCurrentMatchProfile,
  selectPossessionAttacker,
  simulatePossession,
} from './matchRuntime';
import { simulatePenaltyShootout } from './matchTieResolution';
import { getCompatiblePlayerRoleForTeamSlot, getRoleEnergyDrainMultiplier } from './playerRoleEngine';

export { autoAssignLineup } from './lineupEngine';
export { buildCurrentMatchProfile, resolvePenaltyShootoutWinner, selectPossessionAttacker, simulatePossession } from './matchRuntime';

const drainQuickMatchEnergy = (players: Player[], team: Team, multiplier = 1) => {
  const drainMultiplier =
    (team.tactics.tempo === 'Fast' ? ENGINE_CONFIG.TEMPO_FAST_DRAIN_MULTIPLIER : 1.0) *
    (team.tactics.pressing === 'High' ? ENGINE_CONFIG.PRESSING_HIGH_DRAIN_MULTIPLIER : 1.0);
  const baseDrain = (ENGINE_CONFIG.BASE_POST_MATCH_ENERGY_DRAIN / ENGINE_CONFIG.TOTAL_POSSESSIONS) * drainMultiplier * multiplier;
  return players.map(player => {
    const roleDrainMultiplier = getRoleEnergyDrainMultiplier(getCompatiblePlayerRoleForTeamSlot(team, player));
    return {
      ...player,
      energy: Math.max(0, player.energy - baseDrain * roleDrainMultiplier),
    };
  });
};

const replaceFormationMapPlayer = (team: Team, offPlayerId: string, onPlayerId: string): Team => {
  const formationMap = team.formationMap || {};
  let changed = false;
  const nextMap = Object.fromEntries(Object.entries(formationMap).map(([slotKey, playerId]) => {
    if (playerId !== offPlayerId) return [slotKey, playerId];
    changed = true;
    return [slotKey, onPlayerId];
  }));
  return changed ? { ...team, formationMap: nextMap } : team;
};

const removeFromFormationMap = (team: Team, playerId: string): Team => {
  if (!team.formationMap) return team;
  const nextMap = Object.fromEntries(Object.entries(team.formationMap).filter(([, mappedId]) => mappedId !== playerId));
  return { ...team, formationMap: nextMap };
};

type QuickSimMatchStats = {
  homePossessions: number;
  awayPossessions: number;
  totalPossessions: number;
  homePossessionShare: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
};

type QuickSimMatchResult = {
  players: Record<string, Player>;
  teams: Record<string, Team>;
  fixture: Fixture;
  events: string[];
  matchStats: QuickSimMatchStats;
};

const buildQuickSimMatchStats = (
  homePossessions: number,
  awayPossessions: number,
  homeShots = 0,
  awayShots = 0,
  homeShotsOnTarget = 0,
  awayShotsOnTarget = 0
): QuickSimMatchStats => {
  const totalPossessions = homePossessions + awayPossessions;

  return {
    homePossessions,
    awayPossessions,
    totalPossessions,
    homePossessionShare: totalPossessions > 0 ? homePossessions / totalPossessions : 0.5,
    homeShots,
    awayShots,
    homeShotsOnTarget,
    awayShotsOnTarget,
  };
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
): QuickSimMatchResult => {
  const rng = options?.rng ?? createFixtureEventRandomGenerator(fixtureId, 0);
  const fixture = fixtures[fixtureId];
  const emptyMatchStats = buildQuickSimMatchStats(0, 0);
  if (!fixture) throw new RangeError(`Unknown fixture: ${fixtureId}`);
  if (fixture.isPlayed) return { players, teams, fixture, events: [], matchStats: emptyMatchStats };
  if (fixture.resolution === 'void') return { players, teams, fixture, events: [], matchStats: emptyMatchStats };

  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };
  const matchEvents: string[] = [];

  const homeStarters = getTeamMatchStarters(fixture.homeTeamId, userTeamId, updatedPlayers, updatedTeams, isPlayerUnavailable, rebuildFormationMap);
  const awayStarters = getTeamMatchStarters(fixture.awayTeamId, userTeamId, updatedPlayers, updatedTeams, isPlayerUnavailable, rebuildFormationMap);
  let homeTeam = updatedTeams[fixture.homeTeamId];
  let awayTeam = updatedTeams[fixture.awayTeamId];

  const homeBench = getTeamMatchBench(fixture.homeTeamId, homeStarters, updatedPlayers, isPlayerUnavailable);
  const awayBench = getTeamMatchBench(fixture.awayTeamId, awayStarters, updatedPlayers, isPlayerUnavailable);

  const homeValidation = validateMatchdayXI(homeStarters, { teamId: fixture.homeTeamId });
  const awayValidation = validateMatchdayXI(awayStarters, { teamId: fixture.awayTeamId });
  if (!homeValidation.ok || !awayValidation.ok) {
    const finalized = resolveAdministrativeFixture(
      fixture,
      homeValidation.ok,
      awayValidation.ok,
      updatedTeams,
      updatedPlayers,
      homeStarters.map(player => player.id),
      awayStarters.map(player => player.id)
    );
    const eventPrefix = finalized.isVoid ? 'Fixture cannot be played' : 'Fixture resolved by forfeit';
    matchEvents.push(`${eventPrefix}: ${homeValidation.reason || 'home XI legal'}; ${awayValidation.reason || 'away XI legal'}.`);
    return {
      players: finalized.players,
      teams: finalized.teams,
      fixture: finalized.fixture,
      events: matchEvents,
      matchStats: emptyMatchStats,
    };
  }

  let hScore = 0;
  let aScore = 0;
  const homeGoalMinutes: number[] = [];
  const awayGoalMinutes: number[] = [];
  const homeFormMult = getFormModifier(homeTeam.form);
  const awayFormMult = getFormModifier(awayTeam.form);
  const GLOBAL_HOME_ADVANTAGE = ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE;
  let currentHomeXI = [...homeStarters];
  let currentAwayXI = [...awayStarters];
  let availableHomeBench = [...homeBench];
  let availableAwayBench = [...awayBench];
  let homeGoalkeeperId = homeValidation.goalkeeperId;
  let awayGoalkeeperId = awayValidation.goalkeeperId;
  let homeProfile = buildCurrentMatchProfile(homeTeam, currentHomeXI, homeFormMult, GLOBAL_HOME_ADVANTAGE, homeGoalkeeperId);
  let awayProfile = buildCurrentMatchProfile(awayTeam, currentAwayXI, awayFormMult, 1, awayGoalkeeperId);
  let scaledHome = homeProfile.scaled;
  let scaledAway = awayProfile.scaled;
  let homeShape = homeProfile.shape;
  let awayShape = awayProfile.shape;
  const homeMinutes = buildStarterBenchMinuteMap(homeStarters, homeBench);
  const awayMinutes = buildStarterBenchMinuteMap(awayStarters, awayBench);
  const homeSubEntryMinutes: Record<string, number> = {};
  const awaySubEntryMinutes: Record<string, number> = {};
  const homeSubstitutionState = createSubstitutionState();
  const awaySubstitutionState = createSubstitutionState();
  const substitutionCheckpoints = [56, 66, 76, 84];
  let appliedCheckpointIndex = 0;

  const matchYellowCards = new Set<string>();
  const sentOffPlayers = new Set<string>();
  const sentOffMinutes: Record<string, number> = {};
  let homePossessions = 0;
  let awayPossessions = 0;
  let homeShots = 0;
  let awayShots = 0;
  let homeShotsOnTarget = 0;
  let awayShotsOnTarget = 0;
  const matchContributions: Record<string, PlayerMatchContribution> = {};
  let forcedWinnerTeamId: string | undefined;
  let forcedResolution: Fixture['resolution'] | undefined;
  let forcedIncludeTableStats: boolean | undefined;
  let maxMatchMinutes = REGULATION_MATCH_MINUTES;
  let regulationHomeScore = 0;
  let regulationAwayScore = 0;
  let penaltyShootout: Fixture['penaltyShootout'] | undefined;
  const addContribution = (playerId: string, key: keyof PlayerMatchContribution) => {
    matchContributions[playerId] = {
      ...matchContributions[playerId],
      [key]: (matchContributions[playerId]?.[key] || 0) + 1,
    };
  };
  const refreshHomeProfile = () => {
    homeGoalkeeperId = selectDesignatedGoalkeeperId(currentHomeXI, homeGoalkeeperId)
      || selectEmergencyGoalkeeperId(currentHomeXI);
    homeProfile = buildCurrentMatchProfile(homeTeam, currentHomeXI, homeFormMult, GLOBAL_HOME_ADVANTAGE, homeGoalkeeperId);
    scaledHome = homeProfile.scaled;
    homeShape = homeProfile.shape;
  };
  const refreshAwayProfile = () => {
    awayGoalkeeperId = selectDesignatedGoalkeeperId(currentAwayXI, awayGoalkeeperId)
      || selectEmergencyGoalkeeperId(currentAwayXI);
    awayProfile = buildCurrentMatchProfile(awayTeam, currentAwayXI, awayFormMult, 1, awayGoalkeeperId);
    scaledAway = awayProfile.scaled;
    awayShape = awayProfile.shape;
  };
  const coverDismissedGoalkeeper = (side: 'home' | 'away', minute: number) => {
    const isHome = side === 'home';
    const xi = isHome ? currentHomeXI : currentAwayXI;
    if (xi.some(player => player.position === 'GK')) {
      if (isHome) refreshHomeProfile();
      else refreshAwayProfile();
      return;
    }

    const bench = isHome ? availableHomeBench : availableAwayBench;
    const reserveGoalkeeper = bench.find(player => player.position === 'GK' && !sentOffPlayers.has(player.id) && !isPlayerUnavailable(player));
    const substitutionState = isHome ? homeSubstitutionState : awaySubstitutionState;
    if (reserveGoalkeeper && xi.length >= 7 && canUseSubstitutionWindow(substitutionState)) {
      const outfielderOff = [...xi]
        .filter(player => player.position !== 'GK')
        .sort((a, b) => a.overallRating - b.overallRating)[0];
      if (outfielderOff) {
        const minutes = isHome ? homeMinutes : awayMinutes;
        const entries = isHome ? homeSubEntryMinutes : awaySubEntryMinutes;
        const offEntryMinute = entries[outfielderOff.id];
        minutes[outfielderOff.id] = offEntryMinute !== undefined
          ? Math.max(0, minute - offEntryMinute)
          : Math.min(minutes[outfielderOff.id] || maxMatchMinutes, minute);
        if (offEntryMinute !== undefined) delete entries[outfielderOff.id];
        entries[reserveGoalkeeper.id] = minute;
        minutes[reserveGoalkeeper.id] = Math.max(minutes[reserveGoalkeeper.id] || 0, maxMatchMinutes - minute);

        if (isHome) {
          currentHomeXI = currentHomeXI.map(player => player.id === outfielderOff.id ? reserveGoalkeeper : player);
          availableHomeBench = availableHomeBench.filter(player => player.id !== reserveGoalkeeper.id);
          homeTeam = replaceFormationMapPlayer(homeTeam, outfielderOff.id, reserveGoalkeeper.id);
          updatedTeams[homeTeam.id] = homeTeam;
          homeGoalkeeperId = reserveGoalkeeper.id;
          recordSubstitution(homeSubstitutionState);
          refreshHomeProfile();
        } else {
          currentAwayXI = currentAwayXI.map(player => player.id === outfielderOff.id ? reserveGoalkeeper : player);
          availableAwayBench = availableAwayBench.filter(player => player.id !== reserveGoalkeeper.id);
          awayTeam = replaceFormationMapPlayer(awayTeam, outfielderOff.id, reserveGoalkeeper.id);
          updatedTeams[awayTeam.id] = awayTeam;
          awayGoalkeeperId = reserveGoalkeeper.id;
          recordSubstitution(awaySubstitutionState);
          refreshAwayProfile();
        }
        matchEvents.push(`${isHome ? homeTeam.name : awayTeam.name} sacrifice ${outfielderOff.name} to bring on reserve goalkeeper ${reserveGoalkeeper.name}.`);
        return;
      }
    }

    if (isHome) {
      homeGoalkeeperId = selectEmergencyGoalkeeperId(currentHomeXI);
      refreshHomeProfile();
      const emergency = currentHomeXI.find(player => player.id === homeGoalkeeperId);
      if (emergency) matchEvents.push(`${emergency.name} is designated as ${homeTeam.name}'s emergency goalkeeper.`);
    } else {
      awayGoalkeeperId = selectEmergencyGoalkeeperId(currentAwayXI);
      refreshAwayProfile();
      const emergency = currentAwayXI.find(player => player.id === awayGoalkeeperId);
      if (emergency) matchEvents.push(`${emergency.name} is designated as ${awayTeam.name}'s emergency goalkeeper.`);
    }
  };
  const sendOffPlayer = (playerId: string, minute: number) => {
    const player = updatedPlayers[playerId];
    if (!player || sentOffPlayers.has(playerId)) return;
    updatedPlayers[playerId] = {
      ...player,
      redCards: player.redCards + 1,
      matchesSuspended: 3,
      // `suspensionAppliedWeek` is deprecated; same-match skip is driven by `suspensionAppliedFixtureId`.
      suspensionAppliedFixtureId: fixture.id,
    };
    sentOffPlayers.add(playerId);
    sentOffMinutes[playerId] = minute;
    const wasHome = scaledHome.some(p => p.id === playerId);
    const wasAway = scaledAway.some(p => p.id === playerId);
    currentHomeXI = currentHomeXI.filter(p => p.id !== playerId);
    currentAwayXI = currentAwayXI.filter(p => p.id !== playerId);
    if (wasHome) {
      homeTeam = removeFromFormationMap(homeTeam, playerId);
      updatedTeams[homeTeam.id] = homeTeam;
      const entryMinute = homeSubEntryMinutes[playerId];
      homeMinutes[playerId] = entryMinute !== undefined
        ? Math.max(0, minute - entryMinute)
        : Math.min(homeMinutes[playerId] || maxMatchMinutes, minute);
      if (entryMinute !== undefined) delete homeSubEntryMinutes[playerId];
      coverDismissedGoalkeeper('home', minute);
    }
    if (wasAway) {
      awayTeam = removeFromFormationMap(awayTeam, playerId);
      updatedTeams[awayTeam.id] = awayTeam;
      const entryMinute = awaySubEntryMinutes[playerId];
      awayMinutes[playerId] = entryMinute !== undefined
        ? Math.max(0, minute - entryMinute)
        : Math.min(awayMinutes[playerId] || maxMatchMinutes, minute);
      if (entryMinute !== undefined) delete awaySubEntryMinutes[playerId];
      coverDismissedGoalkeeper('away', minute);
    }
  };

  for (let i = 0; i < ENGINE_CONFIG.TOTAL_POSSESSIONS; i++) {
    const minute = Math.max(1, Math.min(REGULATION_MATCH_MINUTES, Math.ceil(((i + 1) * REGULATION_MATCH_MINUTES) / ENGINE_CONFIG.TOTAL_POSSESSIONS)));
    while (appliedCheckpointIndex < substitutionCheckpoints.length && minute >= substitutionCheckpoints[appliedCheckpointIndex]) {
      const subMinute = substitutionCheckpoints[appliedCheckpointIndex];
      applySubstitutions(currentHomeXI, availableHomeBench, sentOffPlayers, homeMinutes, homeTeam, hScore, aScore, rng, {
        minuteOverride: subMinute,
        playerEntryMinutes: homeSubEntryMinutes,
        substitutionState: homeSubstitutionState,
        onSubstitution: (offPlayer, onPlayer) => {
          currentHomeXI = currentHomeXI.map(player => (player.id === offPlayer.id ? onPlayer : player));
          availableHomeBench = availableHomeBench.filter(player => player.id !== onPlayer.id);
          homeTeam = replaceFormationMapPlayer(homeTeam, offPlayer.id, onPlayer.id);
          updatedTeams[homeTeam.id] = homeTeam;
          if (offPlayer.id === homeGoalkeeperId || onPlayer.position === 'GK') homeGoalkeeperId = onPlayer.id;
          refreshHomeProfile();
          matchEvents.push(`${homeTeam.name} make a change: ${offPlayer.name} off, ${onPlayer.name} on.`);
        },
      });
      applySubstitutions(currentAwayXI, availableAwayBench, sentOffPlayers, awayMinutes, awayTeam, aScore, hScore, rng, {
        minuteOverride: subMinute,
        playerEntryMinutes: awaySubEntryMinutes,
        substitutionState: awaySubstitutionState,
        onSubstitution: (offPlayer, onPlayer) => {
          currentAwayXI = currentAwayXI.map(player => (player.id === offPlayer.id ? onPlayer : player));
          availableAwayBench = availableAwayBench.filter(player => player.id !== onPlayer.id);
          awayTeam = replaceFormationMapPlayer(awayTeam, offPlayer.id, onPlayer.id);
          updatedTeams[awayTeam.id] = awayTeam;
          if (offPlayer.id === awayGoalkeeperId || onPlayer.position === 'GK') awayGoalkeeperId = onPlayer.id;
          refreshAwayProfile();
          matchEvents.push(`${awayTeam.name} make a change: ${offPlayer.name} off, ${onPlayer.name} on.`);
        },
      });
      appliedCheckpointIndex += 1;
    }
    currentHomeXI = drainQuickMatchEnergy(currentHomeXI, homeTeam);
    currentAwayXI = drainQuickMatchEnergy(currentAwayXI, awayTeam);
    refreshHomeProfile();
    refreshAwayProfile();
    const homeLiveValidation = validateMatchdayXI(currentHomeXI, {
      teamId: homeTeam.id,
      designatedGoalkeeperId: homeGoalkeeperId,
      allowEmergencyGoalkeeper: true,
    });
    const awayLiveValidation = validateMatchdayXI(currentAwayXI, {
      teamId: awayTeam.id,
      designatedGoalkeeperId: awayGoalkeeperId,
      allowEmergencyGoalkeeper: true,
    });
    if (!homeLiveValidation.ok || !awayLiveValidation.ok) {
      if (!homeLiveValidation.ok && !awayLiveValidation.ok) {
        const voidFixture = buildVoidFixture(fixture);
        matchEvents.push(`Match voided: ${homeLiveValidation.reason || 'home XI legal'}; ${awayLiveValidation.reason || 'away XI legal'}.`);
        return {
          players,
          teams,
          fixture: voidFixture,
          events: matchEvents,
          matchStats: buildQuickSimMatchStats(homePossessions, awayPossessions),
        };
      }
      const outcome = getAdministrativeFixtureOutcome(fixture, homeLiveValidation.ok, awayLiveValidation.ok);
      forcedResolution = outcome.resolution;
      forcedWinnerTeamId = outcome.winnerTeamId;
      forcedIncludeTableStats = outcome.includeTableStats;
      if (outcome.resolution === 'void') {
        hScore = 0;
        aScore = 0;
      } else if (homeLiveValidation.ok && !awayLiveValidation.ok) {
        hScore = Math.max(hScore, aScore + 1, outcome.homeScore);
      } else if (awayLiveValidation.ok && !homeLiveValidation.ok) {
        aScore = Math.max(aScore, hScore + 1, outcome.awayScore);
      }
      matchEvents.push(`Match abandoned: ${homeLiveValidation.reason || 'home XI legal'}; ${awayLiveValidation.reason || 'away XI legal'}.`);
      break;
    }
    const isHomeAttacking = selectPossessionAttacker(
      homeTeam,
      awayTeam,
      scaledHome,
      scaledAway,
      homeShape,
      awayShape,
      rng
    );
    if (isHomeAttacking) homePossessions += 1;
    else awayPossessions += 1;
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
      rng,
      matchYellowCards
    );
    if (poss.event) matchEvents.push(poss.event);
    if (poss.shot) {
      if (isHomeAttacking) {
        homeShots += 1;
        if (poss.shot.onTarget) homeShotsOnTarget += 1;
      } else {
        awayShots += 1;
        if (poss.shot.onTarget) awayShotsOnTarget += 1;
      }
    }
    if (poss.goal) {
      if (isHomeAttacking) {
        hScore++;
        homeGoalMinutes.push(minute);
      } else {
        aScore++;
        awayGoalMinutes.push(minute);
      }
      if (poss.scorer) addPlayerStat(updatedPlayers, poss.scorer.id, 'goals');
      if (poss.scorer) addContribution(poss.scorer.id, 'goals');
      if (poss.assister) addPlayerStat(updatedPlayers, poss.assister.id, 'assists');
      if (poss.assister) addContribution(poss.assister.id, 'assists');
    }
    if (poss.foul) {
      const playerId = poss.foul.player.id;
      if (sentOffPlayers.has(playerId)) continue;
      if (poss.foul.type === 'Y') {
        if (matchYellowCards.has(playerId)) {
          // Second yellow always results in dismissal (real football rule).
          addPlayerStat(updatedPlayers, playerId, 'yellowCards');
          addContribution(playerId, 'yellowCards');
          sendOffPlayer(playerId, minute);
          addContribution(playerId, 'redCards');
          matchEvents.push(`${poss.foul.player.name} receives a second yellow and is sent off.`);
        } else {
          addPlayerStat(updatedPlayers, playerId, 'yellowCards');
          addContribution(playerId, 'yellowCards');
          matchYellowCards.add(playerId);
        }
      } else {
        sendOffPlayer(playerId, minute);
        addContribution(playerId, 'redCards');
      }
    }
  }
  regulationHomeScore = hScore;
  regulationAwayScore = aScore;

  const extendActivePlayersToMinute = (endMinute: number) => {
    currentHomeXI.forEach(player => {
      if (sentOffPlayers.has(player.id)) return;
      const entryMinute = homeSubEntryMinutes[player.id] ?? 0;
      homeMinutes[player.id] = Math.max(homeMinutes[player.id] || 0, endMinute - entryMinute);
    });
    currentAwayXI.forEach(player => {
      if (sentOffPlayers.has(player.id)) return;
      const entryMinute = awaySubEntryMinutes[player.id] ?? 0;
      awayMinutes[player.id] = Math.max(awayMinutes[player.id] || 0, endMinute - entryMinute);
    });
  };

  if (!forcedResolution && fixture.isKnockout && hScore === aScore) {
    maxMatchMinutes = EXTRA_TIME_MATCH_MINUTES;
    homeSubstitutionState.maxWindows = Math.max(homeSubstitutionState.maxWindows, 4);
    awaySubstitutionState.maxWindows = Math.max(awaySubstitutionState.maxWindows, 4);
    matchEvents.push('Extra time begins.');
    let extraTimeSubstitutionApplied = false;

    for (let i = 0; i < ENGINE_CONFIG.EXTRA_TIME_POSSESSIONS; i += 1) {
      const minute = REGULATION_MATCH_MINUTES + Math.max(1, Math.min(30, Math.ceil(((i + 1) * 30) / ENGINE_CONFIG.EXTRA_TIME_POSSESSIONS)));
      if (!extraTimeSubstitutionApplied && minute >= 105) {
        applySubstitutions(currentHomeXI, availableHomeBench, sentOffPlayers, homeMinutes, homeTeam, hScore, aScore, rng, {
          minuteOverride: 105,
          playerEntryMinutes: homeSubEntryMinutes,
          substitutionState: homeSubstitutionState,
          matchEndMinute: EXTRA_TIME_MATCH_MINUTES,
          onSubstitution: (offPlayer, onPlayer) => {
            currentHomeXI = currentHomeXI.map(player => (player.id === offPlayer.id ? onPlayer : player));
            availableHomeBench = availableHomeBench.filter(player => player.id !== onPlayer.id);
            homeTeam = replaceFormationMapPlayer(homeTeam, offPlayer.id, onPlayer.id);
            updatedTeams[homeTeam.id] = homeTeam;
            if (offPlayer.id === homeGoalkeeperId || onPlayer.position === 'GK') homeGoalkeeperId = onPlayer.id;
            refreshHomeProfile();
            matchEvents.push(`${homeTeam.name} make an extra-time change: ${offPlayer.name} off, ${onPlayer.name} on.`);
          },
        });
        applySubstitutions(currentAwayXI, availableAwayBench, sentOffPlayers, awayMinutes, awayTeam, aScore, hScore, rng, {
          minuteOverride: 105,
          playerEntryMinutes: awaySubEntryMinutes,
          substitutionState: awaySubstitutionState,
          matchEndMinute: EXTRA_TIME_MATCH_MINUTES,
          onSubstitution: (offPlayer, onPlayer) => {
            currentAwayXI = currentAwayXI.map(player => (player.id === offPlayer.id ? onPlayer : player));
            availableAwayBench = availableAwayBench.filter(player => player.id !== onPlayer.id);
            awayTeam = replaceFormationMapPlayer(awayTeam, offPlayer.id, onPlayer.id);
            updatedTeams[awayTeam.id] = awayTeam;
            if (offPlayer.id === awayGoalkeeperId || onPlayer.position === 'GK') awayGoalkeeperId = onPlayer.id;
            refreshAwayProfile();
            matchEvents.push(`${awayTeam.name} make an extra-time change: ${offPlayer.name} off, ${onPlayer.name} on.`);
          },
        });
        extraTimeSubstitutionApplied = true;
      }

      currentHomeXI = drainQuickMatchEnergy(currentHomeXI, homeTeam, ENGINE_CONFIG.EXTRA_TIME_ENERGY_DRAIN_MULTIPLIER);
      currentAwayXI = drainQuickMatchEnergy(currentAwayXI, awayTeam, ENGINE_CONFIG.EXTRA_TIME_ENERGY_DRAIN_MULTIPLIER);
      refreshHomeProfile();
      refreshAwayProfile();
      const isHomeAttacking = selectPossessionAttacker(
        homeTeam,
        awayTeam,
        scaledHome,
        scaledAway,
        homeShape,
        awayShape,
        rng
      );
      if (isHomeAttacking) homePossessions += 1;
      else awayPossessions += 1;
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
        rng,
        matchYellowCards
      );
      if (poss.event) matchEvents.push(`[ET ${minute}'] ${poss.event}`);
      if (poss.shot) {
        if (isHomeAttacking) {
          homeShots += 1;
          if (poss.shot.onTarget) homeShotsOnTarget += 1;
        } else {
          awayShots += 1;
          if (poss.shot.onTarget) awayShotsOnTarget += 1;
        }
      }
      if (poss.goal) {
        if (isHomeAttacking) {
          hScore += 1;
          homeGoalMinutes.push(minute);
        } else {
          aScore += 1;
          awayGoalMinutes.push(minute);
        }
        if (poss.scorer) addPlayerStat(updatedPlayers, poss.scorer.id, 'goals');
        if (poss.scorer) addContribution(poss.scorer.id, 'goals');
        if (poss.assister) addPlayerStat(updatedPlayers, poss.assister.id, 'assists');
        if (poss.assister) addContribution(poss.assister.id, 'assists');
      }
      if (poss.foul) {
        const playerId = poss.foul.player.id;
        if (sentOffPlayers.has(playerId)) continue;
        if (poss.foul.type === 'Y') {
          if (matchYellowCards.has(playerId)) {
            addPlayerStat(updatedPlayers, playerId, 'yellowCards');
            addContribution(playerId, 'yellowCards');
            sendOffPlayer(playerId, minute);
            addContribution(playerId, 'redCards');
            matchEvents.push(`${poss.foul.player.name} receives a second yellow and is sent off.`);
          } else {
            addPlayerStat(updatedPlayers, playerId, 'yellowCards');
            addContribution(playerId, 'yellowCards');
            matchYellowCards.add(playerId);
          }
        } else {
          sendOffPlayer(playerId, minute);
          addContribution(playerId, 'redCards');
        }
      }
    }
    if (hScore === aScore) matchEvents.push('Extra time cannot separate them. Penalties will decide it.');
    else matchEvents.push(`${hScore > aScore ? homeTeam.name : awayTeam.name} win after extra time.`);
  }

  extendActivePlayersToMinute(maxMatchMinutes);
  applyMinuteCaps(homeMinutes, sentOffMinutes, maxMatchMinutes);
  applyMinuteCaps(awayMinutes, sentOffMinutes, maxMatchMinutes);

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
    playerMatchContributions: matchContributions,
    maxMatchMinutes,
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
    playerMatchContributions: matchContributions,
    maxMatchMinutes,
  });
  [
    ...applyMatchInjuries(homeParticipants, homeMinutes, updatedPlayers, fixture.week, rng),
    ...applyMatchInjuries(awayParticipants, awayMinutes, updatedPlayers, fixture.week, rng),
  ].forEach(event => {
    const injuredPlayer = updatedPlayers[event.playerId];
    const injuredTeam = injuredPlayer ? updatedTeams[injuredPlayer.teamId] : undefined;
    if (injuredTeam) {
      updatedTeams[injuredTeam.id] = removePlayerFromTeamSelections(injuredTeam, event.playerId);
    }
    matchEvents.push(`${event.playerName} suffers a ${event.injuryType} and will miss ${event.weeks} week${event.weeks === 1 ? '' : 's'}.`);
  });

  let winnerTeamId: string | undefined;
  let resolution: Fixture['resolution'] | undefined;
  if (forcedResolution) {
    winnerTeamId = forcedWinnerTeamId;
    resolution = forcedResolution;
  } else if (fixture.isKnockout) {
    if (hScore === aScore) {
      penaltyShootout = simulatePenaltyShootout(
        homeTeam,
        awayTeam,
        currentHomeXI.filter(player => !sentOffPlayers.has(player.id)),
        currentAwayXI.filter(player => !sentOffPlayers.has(player.id)),
        rng,
        GLOBAL_HOME_ADVANTAGE
      );
      winnerTeamId = penaltyShootout.winnerTeamId;
      resolution = 'penalties';
      matchEvents.push(`${updatedTeams[winnerTeamId].name} keep their nerve and advance on penalties.`);
    } else {
      winnerTeamId = hScore > aScore ? homeTeam.id : awayTeam.id;
      resolution = regulationHomeScore === regulationAwayScore ? 'extra_time' : 'regular';
    }
  }

  const updatedFixture = {
    ...fixture,
    homeScore: hScore,
    awayScore: aScore,
    isPlayed: true,
    winnerTeamId,
    resolution,
    scoreBreakdown: fixture.isKnockout && regulationHomeScore === regulationAwayScore
      ? {
          regulationHomeScore,
          regulationAwayScore,
          extraTimeHomeScore: hScore,
          extraTimeAwayScore: aScore,
          penaltyHomeScore: penaltyShootout?.homeScore,
          penaltyAwayScore: penaltyShootout?.awayScore,
        }
      : undefined,
    penaltyShootout,
  };
  const matchSummary = userTeamId && (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
    ? buildMatchSummary({
        fixture: updatedFixture,
        homeTeam,
        awayTeam,
        players: updatedPlayers,
        homeParticipants,
        awayParticipants,
        homeStarterIds: new Set(homeStarters.map(player => player.id)),
        awayStarterIds: new Set(awayStarters.map(player => player.id)),
        homeMinuteMap: homeMinutes,
        awayMinuteMap: awayMinutes,
        matchContributions,
        homeShots,
        awayShots,
        homeShotsOnTarget,
        awayShotsOnTarget,
        homePossessions,
        awayPossessions,
        maxMatchMinutes,
      })
    : undefined;
  const fixtureWithSummary = matchSummary ? { ...updatedFixture, matchSummary } : updatedFixture;
  const includeTableStats = forcedIncludeTableStats ?? (fixture.competitionType === 'league' && fixture.round === 'league');

  const finalizedTeams = applyFixtureTeamResults(
    fixtureWithSummary,
    hScore,
    aScore,
    resolution,
    updatedTeams,
    homeStarters.map(player => player.id),
    awayStarters.map(player => player.id),
    includeTableStats
  );

  return {
    players: applyFixtureSuspensionService(updatedPlayers, fixtureWithSummary),
    teams: finalizedTeams,
    fixture: fixtureWithSummary,
    events: matchEvents,
    matchStats: buildQuickSimMatchStats(homePossessions, awayPossessions, homeShots, awayShots, homeShotsOnTarget, awayShotsOnTarget),
  };
};

// Form and morale modifiers are applied at the match call site.

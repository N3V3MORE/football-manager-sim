import { ENGINE_CONFIG } from '../config/engineConfig';
import { Fixture, GameState, Player } from '../models/types';
import {
  buildCurrentMatchProfile,
  getFormModifier,
  resolvePenaltyShootoutWinner,
  selectPossessionAttacker,
  simulatePossession,
} from '../core/matchEngine';
import { addPlayerStat } from '../core/matchUtils';
import { createFixtureEventRandomGenerator, RandomGenerator } from '../core/random';
import { applySubstitutions } from '../core/substitutionEngine';
import { buildStarterBenchMinuteMap, buildStarterMinuteMap } from '../core/minuteMapUtils';
import { applySharedPostMatchAccounting, PlayerMatchContribution } from '../core/postMatchAccounting';
import { applyMatchInjuries } from '../core/injuryEngine';
import { getTeamMatchBench } from '../core/lineupEngine';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { resolveCompetitionProgression } from '../core/competitionEngine';
import { removePlayerFromTeamSelections } from '../core/formationMapUtils';
import { selectDesignatedGoalkeeperId, selectEmergencyGoalkeeperId, validateMatchdayXI } from '../core/matchdayValidation';
import {
  LiveMatchState,
  drainLiveMatchEnergy,
  ensureLiveTeamStarters,
  getPlayersByIds,
  getPossessionIndexForMinute,
  removeLiveMatchFixture,
  updateTeamStats,
} from './liveMatchHelpers';
import {
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  mergeInboxMessages,
} from './inboxHelpers';

type LiveMatchActionState = GameState & {
  liveMatches: Record<string, LiveMatchState>;
};

type LiveMatchActionPatch = LiveMatchActionState | Partial<LiveMatchActionState>;

const LIVE_SUBSTITUTION_CHECKPOINTS = [56, 66, 76, 84];

const createLiveSubstitutionState = () => ({
  substitutesUsed: 0,
  substitutionWindowsUsed: 0,
  maxSubstitutes: 5,
  maxWindows: 3,
});

const replaceFormationMapPlayer = (team: LiveMatchActionState['teams'][string], offPlayerId: string, onPlayerId: string) => {
  const formationMap = team.formationMap || {};
  let changed = false;
  const nextMap = Object.fromEntries(Object.entries(formationMap).map(([slotKey, playerId]) => {
    if (playerId !== offPlayerId) return [slotKey, playerId];
    changed = true;
    return [slotKey, onPlayerId];
  }));
  return changed ? { ...team, formationMap: nextMap } : team;
};

const refreshPlayersById = (players: Record<string, Player>, current: Player[]) => (
  current.map(player => players[player.id]).filter((player): player is Player => Boolean(player))
);

export const processLiveMatchMinuteState = (
  state: LiveMatchActionState,
  fixtureId: string,
  minute: number,
  rng?: RandomGenerator
): { patch: LiveMatchActionPatch; event: string | null } => {
  let eventMsg: string | null = null;
  const fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return { patch: state, event: eventMsg };
  const activeRng = rng ?? createFixtureEventRandomGenerator(fixtureId, getPossessionIndexForMinute(minute) ?? minute, state.rngState ?? 1);
  const random = activeRng.next;

  const storedLiveState = state.liveMatches?.[fixtureId];
  const processedMinutes = new Set(storedLiveState?.processedMinutes || []);
  if (processedMinutes.has(minute)) return { patch: state, event: eventMsg };

  const updatedPlayers = { ...state.players };
  const updatedTeams = { ...state.teams };
  const updatedFixture = { ...fixture };
  if (updatedFixture.homeScore === null) updatedFixture.homeScore = 0;
  if (updatedFixture.awayScore === null) updatedFixture.awayScore = 0;

  let homeTeam = updatedTeams[fixture.homeTeamId];
  let awayTeam = updatedTeams[fixture.awayTeamId];
  const sentOffPlayers = new Set(storedLiveState?.sentOffPlayerIds || []);
  const sentOffMinutes = { ...(storedLiveState?.sentOffMinutes || {}) };
  const homeGoalMinutes = [...(storedLiveState?.homeGoalMinutes || [])];
  const awayGoalMinutes = [...(storedLiveState?.awayGoalMinutes || [])];
  const matchContributions: Record<string, PlayerMatchContribution> = {
    ...(storedLiveState?.matchContributions || {}),
  };
  const addContribution = (playerId: string, key: keyof PlayerMatchContribution) => {
    matchContributions[playerId] = {
      ...matchContributions[playerId],
      [key]: (matchContributions[playerId]?.[key] || 0) + 1,
    };
  };
  const matchYellowCards = new Set(storedLiveState?.yellowCardPlayerIds || []);
  const allowAutoAssign = !storedLiveState?.initialized;

  let homeStarters = storedLiveState?.currentHomePlayerIds
    ? getPlayersByIds(updatedPlayers, storedLiveState.currentHomePlayerIds).filter(player => !sentOffPlayers.has(player.id))
    : ensureLiveTeamStarters(homeTeam.id, state.teams, updatedPlayers, sentOffPlayers, allowAutoAssign);
  let awayStarters = storedLiveState?.currentAwayPlayerIds
    ? getPlayersByIds(updatedPlayers, storedLiveState.currentAwayPlayerIds).filter(player => !sentOffPlayers.has(player.id))
    : ensureLiveTeamStarters(awayTeam.id, state.teams, updatedPlayers, sentOffPlayers, allowAutoAssign);

  const homeValidation = validateMatchdayXI(homeStarters, { teamId: homeTeam.id });
  const awayValidation = validateMatchdayXI(awayStarters, { teamId: awayTeam.id });
  if (!homeValidation.ok || !awayValidation.ok) {
    const hScore = homeValidation.ok === awayValidation.ok ? 0 : homeValidation.ok ? 3 : 0;
    const aScore = homeValidation.ok === awayValidation.ok ? 0 : awayValidation.ok ? 3 : 0;
    const winnerTeamId = fixture.isKnockout
      ? hScore === aScore
        ? (random() < 0.5 ? homeTeam.id : awayTeam.id)
        : hScore > aScore ? homeTeam.id : awayTeam.id
      : undefined;
    const includeTableStats = fixture.competitionType === 'league';
    updatedTeams[homeTeam.id] = {
      ...updateTeamStats(homeTeam, hScore, aScore, includeTableStats),
      lastStartingXI: homeValidation.ok ? homeStarters.map(player => player.id) : [],
    };
    updatedTeams[awayTeam.id] = {
      ...updateTeamStats(awayTeam, aScore, hScore, includeTableStats),
      lastStartingXI: awayValidation.ok ? awayStarters.map(player => player.id) : [],
    };
    eventMsg = `Fixture resolved by forfeit: ${homeValidation.reason || 'home XI legal'}; ${awayValidation.reason || 'away XI legal'}.`;
    const forfeitedFixture = { ...updatedFixture, homeScore: hScore, awayScore: aScore, isPlayed: true, winnerTeamId, resolution: 'forfeit' as const };
    const nextFixtures = { ...state.fixtures, [fixtureId]: forfeitedFixture };
    const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, updatedTeams);
    return {
      patch: {
        fixtures: competitionProgression.fixtures,
        competitions: competitionProgression.competitions,
        teams: updatedTeams,
        news: competitionProgression.generatedNews.length > 0
          ? [...competitionProgression.generatedNews, ...state.news].slice(0, 20)
          : state.news,
        liveMatches: removeLiveMatchFixture(state.liveMatches || {}, fixtureId),
      },
      event: eventMsg,
    };
  }

  const homeStarterIds = storedLiveState?.homeStarterIds || homeStarters.map(player => player.id);
  const awayStarterIds = storedLiveState?.awayStarterIds || awayStarters.map(player => player.id);
  const homeBench = storedLiveState?.homeBenchIds
    ? getPlayersByIds(updatedPlayers, storedLiveState.homeBenchIds)
    : getLiveMatchBench(updatedPlayers, homeTeam.id, homeStarters);
  const awayBench = storedLiveState?.awayBenchIds
    ? getPlayersByIds(updatedPlayers, storedLiveState.awayBenchIds)
    : getLiveMatchBench(updatedPlayers, awayTeam.id, awayStarters);
  let availableHomeBench = homeBench.filter(player => !isPlayerUnavailable(player) && !homeStarters.some(starter => starter.id === player.id));
  let availableAwayBench = awayBench.filter(player => !isPlayerUnavailable(player) && !awayStarters.some(starter => starter.id === player.id));
  const homeMinuteMap = storedLiveState?.homeMinuteMap
    ? { ...storedLiveState.homeMinuteMap }
    : buildStarterBenchMinuteMap(homeStarters, homeBench);
  const awayMinuteMap = storedLiveState?.awayMinuteMap
    ? { ...storedLiveState.awayMinuteMap }
    : buildStarterBenchMinuteMap(awayStarters, awayBench);
  const homeSubEntryMinutes = { ...(storedLiveState?.homeSubEntryMinutes || {}) };
  const awaySubEntryMinutes = { ...(storedLiveState?.awaySubEntryMinutes || {}) };
  let homeGoalkeeperId = storedLiveState?.homeGoalkeeperId || homeValidation.goalkeeperId;
  let awayGoalkeeperId = storedLiveState?.awayGoalkeeperId || awayValidation.goalkeeperId;
  const homeSubstitutionState = storedLiveState?.homeSubstitutionState
    ? { ...storedLiveState.homeSubstitutionState }
    : createLiveSubstitutionState();
  const awaySubstitutionState = storedLiveState?.awaySubstitutionState
    ? { ...storedLiveState.awaySubstitutionState }
    : createLiveSubstitutionState();
  const appliedSubstitutionCheckpoints = new Set(storedLiveState?.appliedSubstitutionCheckpoints || []);

  LIVE_SUBSTITUTION_CHECKPOINTS
    .filter(checkpoint => checkpoint <= minute && !appliedSubstitutionCheckpoints.has(checkpoint))
    .forEach(checkpoint => {
      applySubstitutions(homeStarters, availableHomeBench, sentOffPlayers, homeMinuteMap, homeTeam, updatedFixture.homeScore!, updatedFixture.awayScore!, activeRng, {
        minuteOverride: checkpoint,
        playerEntryMinutes: homeSubEntryMinutes,
        substitutionState: homeSubstitutionState,
        onSubstitution: (offPlayer, onPlayer) => {
          homeStarters = homeStarters.map(player => (player.id === offPlayer.id ? onPlayer : player));
          availableHomeBench = availableHomeBench.filter(player => player.id !== onPlayer.id);
          homeTeam = replaceFormationMapPlayer(homeTeam, offPlayer.id, onPlayer.id);
          updatedTeams[homeTeam.id] = homeTeam;
          if (offPlayer.id === homeGoalkeeperId || onPlayer.position === 'GK') homeGoalkeeperId = onPlayer.id;
        },
      });
      applySubstitutions(awayStarters, availableAwayBench, sentOffPlayers, awayMinuteMap, awayTeam, updatedFixture.awayScore!, updatedFixture.homeScore!, activeRng, {
        minuteOverride: checkpoint,
        playerEntryMinutes: awaySubEntryMinutes,
        substitutionState: awaySubstitutionState,
        onSubstitution: (offPlayer, onPlayer) => {
          awayStarters = awayStarters.map(player => (player.id === offPlayer.id ? onPlayer : player));
          availableAwayBench = availableAwayBench.filter(player => player.id !== onPlayer.id);
          awayTeam = replaceFormationMapPlayer(awayTeam, offPlayer.id, onPlayer.id);
          updatedTeams[awayTeam.id] = awayTeam;
          if (offPlayer.id === awayGoalkeeperId || onPlayer.position === 'GK') awayGoalkeeperId = onPlayer.id;
        },
      });
      appliedSubstitutionCheckpoints.add(checkpoint);
    });

  drainLiveMatchEnergy(updatedPlayers, homeStarters, homeTeam.tactics);
  drainLiveMatchEnergy(updatedPlayers, awayStarters, awayTeam.tactics);
  homeStarters = refreshPlayersById(updatedPlayers, homeStarters);
  awayStarters = refreshPlayersById(updatedPlayers, awayStarters);

  const possessionIndex = getPossessionIndexForMinute(minute);
  if (possessionIndex !== null) {
    const homeFormMult = getFormModifier(homeTeam.form);
    const awayFormMult = getFormModifier(awayTeam.form);
    homeGoalkeeperId = selectDesignatedGoalkeeperId(homeStarters, homeGoalkeeperId) || selectEmergencyGoalkeeperId(homeStarters);
    awayGoalkeeperId = selectDesignatedGoalkeeperId(awayStarters, awayGoalkeeperId) || selectEmergencyGoalkeeperId(awayStarters);
    const homeProfile = buildCurrentMatchProfile(homeTeam, homeStarters, homeFormMult, ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE, homeGoalkeeperId);
    const awayProfile = buildCurrentMatchProfile(awayTeam, awayStarters, awayFormMult, 1, awayGoalkeeperId);
    const scaledHome = homeProfile.scaled;
    const scaledAway = awayProfile.scaled;
    const homeShape = homeProfile.shape;
    const awayShape = awayProfile.shape;
    const isHomeAttacking = selectPossessionAttacker(
      homeTeam,
      awayTeam,
      scaledHome,
      scaledAway,
      homeShape,
      awayShape,
      activeRng
    );
    const attacker = isHomeAttacking ? homeTeam : awayTeam;
    const defender = isHomeAttacking ? awayTeam : homeTeam;
    const attPlayers = isHomeAttacking ? scaledHome : scaledAway;
    const defPlayers = isHomeAttacking ? scaledAway : scaledHome;
    const attShape = isHomeAttacking ? homeShape : awayShape;
    const defShape = isHomeAttacking ? awayShape : homeShape;

    const coverDismissedGoalkeeper = (side: 'home' | 'away') => {
      const isHome = side === 'home';
      const xi = isHome ? homeStarters : awayStarters;
      if (xi.some(player => player.position === 'GK')) {
        if (isHome) homeGoalkeeperId = selectDesignatedGoalkeeperId(homeStarters, homeGoalkeeperId);
        else awayGoalkeeperId = selectDesignatedGoalkeeperId(awayStarters, awayGoalkeeperId);
        return;
      }

      const bench = isHome ? availableHomeBench : availableAwayBench;
      const reserveGoalkeeper = bench.find(player => player.position === 'GK' && !sentOffPlayers.has(player.id) && !isPlayerUnavailable(player));
      if (reserveGoalkeeper && xi.length >= 7) {
        const outfielderOff = [...xi]
          .filter(player => player.position !== 'GK')
          .sort((a, b) => a.overallRating - b.overallRating)[0];
        if (!outfielderOff) return;

        const minuteMap = isHome ? homeMinuteMap : awayMinuteMap;
        const entries = isHome ? homeSubEntryMinutes : awaySubEntryMinutes;
        const entryMinute = entries[outfielderOff.id];
        minuteMap[outfielderOff.id] = entryMinute !== undefined
          ? Math.max(0, minute - entryMinute)
          : Math.min(minuteMap[outfielderOff.id] || 90, minute);
        if (entryMinute !== undefined) delete entries[outfielderOff.id];
        entries[reserveGoalkeeper.id] = minute;
        minuteMap[reserveGoalkeeper.id] = Math.max(minuteMap[reserveGoalkeeper.id] || 0, 90 - minute);

        if (isHome) {
          homeStarters = homeStarters.map(player => player.id === outfielderOff.id ? reserveGoalkeeper : player);
          availableHomeBench = availableHomeBench.filter(player => player.id !== reserveGoalkeeper.id);
          homeTeam = replaceFormationMapPlayer(homeTeam, outfielderOff.id, reserveGoalkeeper.id);
          updatedTeams[homeTeam.id] = homeTeam;
          homeGoalkeeperId = reserveGoalkeeper.id;
          homeSubstitutionState.substitutesUsed = Math.min(homeSubstitutionState.maxSubstitutes || 5, homeSubstitutionState.substitutesUsed + 1);
          homeSubstitutionState.substitutionWindowsUsed = Math.min(homeSubstitutionState.maxWindows || 3, homeSubstitutionState.substitutionWindowsUsed + 1);
        } else {
          awayStarters = awayStarters.map(player => player.id === outfielderOff.id ? reserveGoalkeeper : player);
          availableAwayBench = availableAwayBench.filter(player => player.id !== reserveGoalkeeper.id);
          awayTeam = replaceFormationMapPlayer(awayTeam, outfielderOff.id, reserveGoalkeeper.id);
          updatedTeams[awayTeam.id] = awayTeam;
          awayGoalkeeperId = reserveGoalkeeper.id;
          awaySubstitutionState.substitutesUsed = Math.min(awaySubstitutionState.maxSubstitutes || 5, awaySubstitutionState.substitutesUsed + 1);
          awaySubstitutionState.substitutionWindowsUsed = Math.min(awaySubstitutionState.maxWindows || 3, awaySubstitutionState.substitutionWindowsUsed + 1);
        }
        const coverMessage = `${isHome ? homeTeam.name : awayTeam.name} bring on reserve goalkeeper ${reserveGoalkeeper.name}.`;
        eventMsg = eventMsg ? `${eventMsg} ${coverMessage}` : coverMessage;
        return;
      }

      if (isHome) homeGoalkeeperId = selectEmergencyGoalkeeperId(homeStarters);
      else awayGoalkeeperId = selectEmergencyGoalkeeperId(awayStarters);
    };

    const sendOffPlayer = (playerId: string, message: string) => {
      const player = updatedPlayers[playerId];
      if (!player || sentOffPlayers.has(playerId)) return;
      updatedPlayers[playerId] = {
        ...player,
        redCards: player.redCards + 1,
        matchesSuspended: 3,
        suspensionAppliedWeek: fixture.week,
      };
      addContribution(playerId, 'redCards');
      sentOffPlayers.add(playerId);
      sentOffMinutes[playerId] = minute;
      eventMsg = message;
      if (homeMinuteMap[playerId] !== undefined) {
        const entryMinute = homeSubEntryMinutes[playerId];
        homeMinuteMap[playerId] = entryMinute !== undefined
          ? Math.max(0, minute - entryMinute)
          : Math.min(homeMinuteMap[playerId] || 90, minute);
        delete homeSubEntryMinutes[playerId];
        homeStarters = homeStarters.filter(starter => starter.id !== playerId);
        homeTeam = removePlayerFromTeamSelections(homeTeam, playerId);
        updatedTeams[homeTeam.id] = homeTeam;
        coverDismissedGoalkeeper('home');
      }
      if (awayMinuteMap[playerId] !== undefined) {
        const entryMinute = awaySubEntryMinutes[playerId];
        awayMinuteMap[playerId] = entryMinute !== undefined
          ? Math.max(0, minute - entryMinute)
          : Math.min(awayMinuteMap[playerId] || 90, minute);
        delete awaySubEntryMinutes[playerId];
        awayStarters = awayStarters.filter(starter => starter.id !== playerId);
        awayTeam = removePlayerFromTeamSelections(awayTeam, playerId);
        updatedTeams[awayTeam.id] = awayTeam;
        coverDismissedGoalkeeper('away');
      }
      eventMsg = eventMsg || message;
    };

    const res = simulatePossession(
      attacker,
      defender,
      attPlayers,
      defPlayers,
      isHomeAttacking ? updatedFixture.homeScore! : updatedFixture.awayScore!,
      isHomeAttacking ? updatedFixture.awayScore! : updatedFixture.homeScore!,
      attShape,
      defShape,
      activeRng
    );
    eventMsg = res.event;

    if (res.goal) {
      if (isHomeAttacking) {
        updatedFixture.homeScore!++;
        homeGoalMinutes.push(minute);
      } else {
        updatedFixture.awayScore!++;
        awayGoalMinutes.push(minute);
      }
      if (res.scorer) addPlayerStat(updatedPlayers, res.scorer.id, 'goals');
      if (res.scorer) addContribution(res.scorer.id, 'goals');
      if (res.assister) addPlayerStat(updatedPlayers, res.assister.id, 'assists');
      if (res.assister) addContribution(res.assister.id, 'assists');
    }

    if (res.foul) {
      const playerId = res.foul.player.id;
      if (!sentOffPlayers.has(playerId)) {
        if (res.foul.type === 'Y') {
          if (matchYellowCards.has(playerId)) {
            // Second yellow always results in dismissal (real football rule).
            addPlayerStat(updatedPlayers, playerId, 'yellowCards');
            addContribution(playerId, 'yellowCards');
            sendOffPlayer(playerId, `${res.foul.player.name} receives a second yellow and is sent off.`);
          } else {
            addPlayerStat(updatedPlayers, playerId, 'yellowCards');
            addContribution(playerId, 'yellowCards');
            matchYellowCards.add(playerId);
          }
        } else {
          sendOffPlayer(playerId, `${res.foul.player.name} is shown a straight red card.`);
        }
      }
    }
  }

  if (minute === 45 && !eventMsg) eventMsg = 'HALF TIME.';
  if (minute === 90 && !eventMsg) eventMsg = 'FULL TIME.';

  const homeContinuation = validateMatchdayXI(homeStarters, {
    teamId: homeTeam.id,
    designatedGoalkeeperId: homeGoalkeeperId,
    allowEmergencyGoalkeeper: true,
  });
  const awayContinuation = validateMatchdayXI(awayStarters, {
    teamId: awayTeam.id,
    designatedGoalkeeperId: awayGoalkeeperId,
    allowEmergencyGoalkeeper: true,
  });
  if (!homeContinuation.ok || !awayContinuation.ok) {
    const homeCanContinue = homeContinuation.ok;
    const awayCanContinue = awayContinuation.ok;
    if (homeCanContinue && !awayCanContinue) updatedFixture.homeScore = Math.max(updatedFixture.homeScore || 0, (updatedFixture.awayScore || 0) + 1, 3);
    if (awayCanContinue && !homeCanContinue) updatedFixture.awayScore = Math.max(updatedFixture.awayScore || 0, (updatedFixture.homeScore || 0) + 1, 3);
    const winnerTeamId = fixture.isKnockout
      ? homeCanContinue === awayCanContinue
        ? undefined
        : homeCanContinue ? homeTeam.id : awayTeam.id
      : undefined;
    const forfeitedFixture = {
      ...updatedFixture,
      isPlayed: true,
      winnerTeamId,
      resolution: 'forfeit' as const,
    };
    const includeTableStats = fixture.competitionType === 'league';
    updatedTeams[homeTeam.id] = {
      ...updateTeamStats(homeTeam, forfeitedFixture.homeScore || 0, forfeitedFixture.awayScore || 0, includeTableStats),
      lastStartingXI: homeStarterIds,
    };
    updatedTeams[awayTeam.id] = {
      ...updateTeamStats(awayTeam, forfeitedFixture.awayScore || 0, forfeitedFixture.homeScore || 0, includeTableStats),
      lastStartingXI: awayStarterIds,
    };
    const nextFixtures = { ...state.fixtures, [fixtureId]: forfeitedFixture };
    const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, updatedTeams);
    return {
      patch: {
        fixtures: competitionProgression.fixtures,
        competitions: competitionProgression.competitions,
        teams: updatedTeams,
        players: updatedPlayers,
        news: competitionProgression.generatedNews.length > 0
          ? [...competitionProgression.generatedNews, ...state.news].slice(0, 20)
          : state.news,
        liveMatches: removeLiveMatchFixture(state.liveMatches || {}, fixtureId),
      },
      event: eventMsg || `Match abandoned: ${homeContinuation.reason || 'home XI legal'}; ${awayContinuation.reason || 'away XI legal'}.`,
    };
  }

  const liveMatchState: LiveMatchState = {
    initialized: true,
    yellowCardPlayerIds: Array.from(matchYellowCards),
    sentOffPlayerIds: Array.from(sentOffPlayers),
    firstAttackIsHome: storedLiveState?.firstAttackIsHome,
    sentOffMinutes,
    homeGoalMinutes,
    awayGoalMinutes,
    matchContributions,
    homeStarterIds,
    awayStarterIds,
    currentHomePlayerIds: homeStarters.map(player => player.id),
    currentAwayPlayerIds: awayStarters.map(player => player.id),
    homeBenchIds: storedLiveState?.homeBenchIds || homeBench.map(player => player.id),
    awayBenchIds: storedLiveState?.awayBenchIds || awayBench.map(player => player.id),
    homeMinuteMap,
    awayMinuteMap,
    homeSubEntryMinutes,
    awaySubEntryMinutes,
    homeGoalkeeperId,
    awayGoalkeeperId,
    homeSubstitutionState,
    awaySubstitutionState,
    appliedSubstitutionCheckpoints: Array.from(appliedSubstitutionCheckpoints),
    processedMinutes: [...processedMinutes, minute],
  };

  return {
    patch: {
      fixtures: { ...state.fixtures, [fixtureId]: updatedFixture },
      teams: updatedTeams,
      players: updatedPlayers,
      liveMatches: { ...(state.liveMatches || {}), [fixtureId]: liveMatchState },
    },
    event: eventMsg,
  };
};

const getLiveMatchBench = (
  players: Record<string, Player>,
  teamId: string,
  starters: Player[]
) => {
  return getTeamMatchBench(teamId, starters, players, isPlayerUnavailable);
};

const completeLiveMatchMinutes = (
  state: LiveMatchActionState,
  fixtureId: string,
  rng?: RandomGenerator
) => {
  const storedLiveState = state.liveMatches?.[fixtureId];
  if (storedLiveState && !storedLiveState.processedMinutes) {
    const fixture = state.fixtures[fixtureId];
    const hasLegacyProgress = Boolean(fixture && (
      fixture.homeScore !== null ||
      fixture.awayScore !== null ||
      Boolean(storedLiveState.sentOffPlayerIds.length) ||
      Boolean(storedLiveState.yellowCardPlayerIds.length) ||
      Boolean(storedLiveState.homeGoalMinutes?.length) ||
      Boolean(storedLiveState.awayGoalMinutes?.length)
    ));
    if (hasLegacyProgress) return state;
  }

  let nextState = state;
  for (let minute = 1; minute <= 90; minute += 1) {
    const processedMinutes = new Set(nextState.liveMatches?.[fixtureId]?.processedMinutes || []);
    if (processedMinutes.has(minute)) continue;
    const update = processLiveMatchMinuteState(nextState, fixtureId, minute, rng);
    nextState = { ...nextState, ...update.patch };
  }
  return nextState;
};

export const finishLiveMatchState = (
  state: LiveMatchActionState,
  fixtureId: string,
  rng?: RandomGenerator
): LiveMatchActionPatch => {
  state = completeLiveMatchMinutes(state, fixtureId, rng);
  const fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return state;
  const finalRng = rng ?? createFixtureEventRandomGenerator(fixtureId, 91, state.rngState ?? 1);
  const previousPlayers = state.players;

  const homeTeam = state.teams[fixture.homeTeamId];
  const awayTeam = state.teams[fixture.awayTeamId];
  const liveMatchState = state.liveMatches?.[fixtureId];
  const sentOffMinutes = liveMatchState?.sentOffMinutes || {};
  const sentOffPlayers = new Set(liveMatchState?.sentOffPlayerIds || []);
  const homeGoalMinutes = liveMatchState?.homeGoalMinutes || [];
  const awayGoalMinutes = liveMatchState?.awayGoalMinutes || [];
  const homeTeamStarters = liveMatchState
    ? getPlayersByIds(state.players, liveMatchState.homeStarterIds)
    : Object.values(state.players).filter(player => player.teamId === homeTeam.id && player.isStarting && !isPlayerUnavailable(player));
  const awayTeamStarters = liveMatchState
    ? getPlayersByIds(state.players, liveMatchState.awayStarterIds)
    : Object.values(state.players).filter(player => player.teamId === awayTeam.id && player.isStarting && !isPlayerUnavailable(player));

  const updatedPlayers = { ...state.players };
  const hScore = fixture.homeScore || 0;
  const aScore = fixture.awayScore || 0;
  const homeBench = liveMatchState?.homeBenchIds
    ? getPlayersByIds(state.players, liveMatchState.homeBenchIds)
    : getLiveMatchBench(state.players, homeTeam.id, homeTeamStarters);
  const awayBench = liveMatchState?.awayBenchIds
    ? getPlayersByIds(state.players, liveMatchState.awayBenchIds)
    : getLiveMatchBench(state.players, awayTeam.id, awayTeamStarters);
  const homeMinuteMap = liveMatchState?.homeMinuteMap
    ? { ...liveMatchState.homeMinuteMap }
    : buildStarterMinuteMap(homeTeamStarters, sentOffMinutes);
  const awayMinuteMap = liveMatchState?.awayMinuteMap
    ? { ...liveMatchState.awayMinuteMap }
    : buildStarterMinuteMap(awayTeamStarters, sentOffMinutes);

  if (!liveMatchState?.homeMinuteMap) {
    applySubstitutions(homeTeamStarters, homeBench, sentOffPlayers, homeMinuteMap, homeTeam, hScore, aScore, finalRng);
  }
  if (!liveMatchState?.awayMinuteMap) {
    applySubstitutions(awayTeamStarters, awayBench, sentOffPlayers, awayMinuteMap, awayTeam, aScore, hScore, finalRng);
  }

  const homeParticipants = [...homeTeamStarters, ...homeBench];
  const awayParticipants = [...awayTeamStarters, ...awayBench];
  applySharedPostMatchAccounting({
    teamParticipants: homeParticipants,
    teamStarterIds: new Set(homeTeamStarters.map(player => player.id)),
    minuteMap: homeMinuteMap,
    concededGoalMinutes: awayGoalMinutes,
    concededGoalsTotal: aScore,
    isWin: hScore > aScore,
    isDraw: hScore === aScore,
    teamTactics: homeTeam.tactics,
    updatedPlayers,
    rng: finalRng,
    applyEnergyDrain: false,
    playerMatchContributions: liveMatchState?.matchContributions,
  });
  applySharedPostMatchAccounting({
    teamParticipants: awayParticipants,
    teamStarterIds: new Set(awayTeamStarters.map(player => player.id)),
    minuteMap: awayMinuteMap,
    concededGoalMinutes: homeGoalMinutes,
    concededGoalsTotal: hScore,
    isWin: aScore > hScore,
    isDraw: aScore === hScore,
    teamTactics: awayTeam.tactics,
    updatedPlayers,
    rng: finalRng,
    applyEnergyDrain: false,
    playerMatchContributions: liveMatchState?.matchContributions,
  });
  const injuryEvents = [
    ...applyMatchInjuries(homeParticipants, homeMinuteMap, updatedPlayers, fixture.week, finalRng),
    ...applyMatchInjuries(awayParticipants, awayMinuteMap, updatedPlayers, fixture.week, finalRng),
  ];

  let winnerTeamId: string | undefined;
  let resolution: Fixture['resolution'] | undefined;
  if (fixture.isKnockout) {
    if (hScore === aScore) {
      const homePenaltyPlayers = liveMatchState?.currentHomePlayerIds
        ? getPlayersByIds(updatedPlayers, liveMatchState.currentHomePlayerIds).filter(player => !sentOffPlayers.has(player.id))
        : homeTeamStarters.filter(player => !sentOffPlayers.has(player.id));
      const awayPenaltyPlayers = liveMatchState?.currentAwayPlayerIds
        ? getPlayersByIds(updatedPlayers, liveMatchState.currentAwayPlayerIds).filter(player => !sentOffPlayers.has(player.id))
        : awayTeamStarters.filter(player => !sentOffPlayers.has(player.id));
      winnerTeamId = resolvePenaltyShootoutWinner(
        homeTeam,
        awayTeam,
        homePenaltyPlayers,
        awayPenaltyPlayers,
        finalRng,
        ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE
      );
      resolution = 'penalties';
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
  const updatedTeams = {
    ...state.teams,
    [homeTeam.id]: {
      ...updateTeamStats(homeTeam, hScore, aScore, includeTableStats),
      lastStartingXI: homeTeamStarters.map(player => player.id),
    },
    [awayTeam.id]: {
      ...updateTeamStats(awayTeam, aScore, hScore, includeTableStats),
      lastStartingXI: awayTeamStarters.map(player => player.id),
    },
  };
  injuryEvents.forEach(event => {
    const injuredPlayer = updatedPlayers[event.playerId];
    const injuredTeam = injuredPlayer ? updatedTeams[injuredPlayer.teamId] : undefined;
    if (injuredTeam) {
      updatedTeams[injuredTeam.id] = removePlayerFromTeamSelections(injuredTeam, event.playerId);
    }
  });
  const nextFixtures = { ...state.fixtures, [fixtureId]: updatedFixture };
  const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, updatedTeams);
  const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);
  const postMatchReport = generatePostMatchReportMessage({
    currentWeek: state.currentWeek,
    userTeamId: state.userTeamId,
    fixture: updatedFixture,
    teams: updatedTeams,
    players: updatedPlayers,
    previousPlayers,
  });

  return {
    fixtures: competitionProgression.fixtures,
    competitions: competitionProgression.competitions,
    teams: updatedTeams,
    players: updatedPlayers,
    news: competitionProgression.generatedNews.length > 0
      ? [...competitionProgression.generatedNews, ...state.news].slice(0, 20)
      : state.news,
    liveMatches,
    inboxMessages: mergeInboxMessages(
      state.inboxMessages,
      [
        ...(postMatchReport ? [postMatchReport] : []),
        ...generateSystemInboxMessages(state.currentWeek, competitionProgression.generatedNews),
      ]
    ),
  };
};

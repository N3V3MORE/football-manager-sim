import { ENGINE_CONFIG } from '../config/engineConfig';
import { Fixture, Formation, GameState, Player, Team } from '../models/types';
import {
  buildCurrentMatchProfile,
  selectPossessionAttacker,
  simulatePossession,
} from '../core/matchRuntime';
import { simulatePenaltyShootout } from '../core/matchTieResolution';
import { addPlayerStat, getFormModifier } from '../core/matchUtils';
import { createFixtureEventRandomGenerator, RandomGenerator } from '../core/random';
import { applySubstitutions } from '../core/substitutionEngine';
import { SUBSTITUTION_CHECKPOINTS } from '../core/matchSubstitutions';
import { buildStarterBenchMinuteMap, buildStarterMinuteMap } from '../core/minuteMapUtils';
import { applySharedPostMatchAccounting, PlayerMatchContribution } from '../core/postMatchAccounting';
import { applyMatchInjuries } from '../core/injuryEngine';
import { getTeamMatchBench } from '../core/lineupEngine';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { resolveCompetitionProgression } from '../core/competitionEngine';
import { rebuildFormationMap, removePlayerFromTeamSelections } from '../core/formationMapUtils';
import { selectDesignatedGoalkeeperId, selectEmergencyGoalkeeperId, validateMatchdayXI } from '../core/matchdayValidation';
import { applyFixtureSuspensionService, buildVoidFixture, getAdministrativeFixtureOutcome } from '../core/fixtureLifecycle';
import { getSlotsForFormation, SUPPORTED_FORMATIONS } from '../constants/formations';
import { buildMatchSummary } from '../core/matchSummary';
import {
  LiveMatchState,
  drainLiveMatchEnergy,
  ensureLiveTeamStarters,
  getPlayersByIds,
  LIVE_MATCH_EXTRA_TIME_MINUTES,
  LIVE_MATCH_MINUTES,
  getPossessionIndexForMinute,
  removeLiveMatchFixture,
  updateTeamStats,
} from './liveMatchHelpers';
import { appendFixtureResultToState } from './fixtureResolution';

type LiveMatchActionState = GameState & {
  liveMatches: Record<string, LiveMatchState>;
};

type LiveMatchActionPatch = LiveMatchActionState | Partial<LiveMatchActionState>;

type LiveSubstitutionState = {
  substitutesUsed: number;
  substitutionWindowsUsed: number;
  maxSubstitutes?: number;
  maxWindows?: number;
};

type LiveMatchActionResult = { success: boolean; message: string };

type LiveReplacement = {
  offPlayerId: string;
  onPlayerId: string;
};

const createLiveSubstitutionState = (): LiveSubstitutionState => ({
  substitutesUsed: 0,
  substitutionWindowsUsed: 0,
  maxSubstitutes: 5,
  maxWindows: 3,
});

const canUseLiveSubstitutionWindow = (
  state: LiveSubstitutionState,
  replacementCount = 1,
  spendWindow = true
) => (
  state.substitutesUsed + replacementCount <= (state.maxSubstitutes || 5) &&
  (!spendWindow || state.substitutionWindowsUsed < (state.maxWindows || 3))
);

const recordLiveSubstitution = (
  state: LiveSubstitutionState,
  replacementCount = 1,
  spendWindow = true
) => {
  state.substitutesUsed += replacementCount;
  if (spendWindow) state.substitutionWindowsUsed += 1;
};

const replaceLiveFormationMapPlayer = (
  formationMap: Record<string, string>,
  offPlayerId: string,
  onPlayerId: string
) => {
  let changed = false;
  const nextMap = Object.fromEntries(Object.entries(formationMap).map(([slotKey, playerId]) => {
    if (playerId !== offPlayerId) return [slotKey, playerId];
    changed = true;
    return [slotKey, onPlayerId];
  }));
  return changed ? nextMap : formationMap;
};

const removePlayerFromLiveFormationMap = (
  formationMap: Record<string, string>,
  playerId: string
) => Object.fromEntries(Object.entries(formationMap).filter(([, mappedId]) => mappedId !== playerId));

const buildLiveFormationMap = (
  team: Team,
  formation: Formation,
  starters: Player[],
  existingMap?: Record<string, string>
) => rebuildFormationMap(getSlotsForFormation(formation), starters, existingMap || team.formationMap || {});

const buildLiveTeamOverlay = (
  team: Team,
  activeFormation?: Formation,
  formationMap?: Record<string, string>
): Team => ({
  ...team,
  activeFormation: activeFormation || team.activeFormation,
  formationMap: formationMap || team.formationMap,
});

const getLatestProcessedMinute = (liveMatchState: LiveMatchState) => {
  const processed = liveMatchState.processedMinutes || [];
  return processed.length > 0 ? Math.max(...processed) : 0;
};

const isTiedKnockoutAtEndOfRegulation = (
  fixture: Fixture,
  liveMatchState?: LiveMatchState
) => (
  fixture.isKnockout &&
  (
    liveMatchState?.extraTimeStarted ||
    (
      (liveMatchState?.processedMinutes || []).includes(LIVE_MATCH_MINUTES) &&
      (fixture.homeScore || 0) === (fixture.awayScore || 0)
    )
  )
);

const getLiveMatchMaxMinute = (
  fixture: Fixture,
  liveMatchState?: LiveMatchState
) => (
  isTiedKnockoutAtEndOfRegulation(fixture, liveMatchState)
    ? LIVE_MATCH_EXTRA_TIME_MINUTES
    : LIVE_MATCH_MINUTES
);

const refreshPlayersById = (players: Record<string, Player>, current: Player[]) => (
  current.map(player => players[player.id]).filter((player): player is Player => Boolean(player))
);

const failLiveAction = (message: string): { patch: Partial<LiveMatchActionState>; result: LiveMatchActionResult } => ({
  patch: {},
  result: { success: false, message },
});

const getManagedLiveSide = (
  state: LiveMatchActionState,
  fixture: Fixture,
  liveMatchState: LiveMatchState
) => {
  const teamId = state.userTeamId;
  if (!teamId || (fixture.homeTeamId !== teamId && fixture.awayTeamId !== teamId)) return null;
  const isHome = fixture.homeTeamId === teamId;
  return {
    teamId,
    isHome,
    currentIds: isHome ? (liveMatchState.currentHomePlayerIds || liveMatchState.homeStarterIds) : (liveMatchState.currentAwayPlayerIds || liveMatchState.awayStarterIds),
    starterIds: isHome ? liveMatchState.homeStarterIds : liveMatchState.awayStarterIds,
    benchIds: isHome ? (liveMatchState.homeBenchIds || []) : (liveMatchState.awayBenchIds || []),
    minuteMap: isHome ? { ...(liveMatchState.homeMinuteMap || {}) } : { ...(liveMatchState.awayMinuteMap || {}) },
    subEntryMinutes: isHome ? { ...(liveMatchState.homeSubEntryMinutes || {}) } : { ...(liveMatchState.awaySubEntryMinutes || {}) },
    goalkeeperId: isHome ? liveMatchState.homeGoalkeeperId : liveMatchState.awayGoalkeeperId,
    substitutionState: isHome
      ? { ...(liveMatchState.homeSubstitutionState || createLiveSubstitutionState()) }
      : { ...(liveMatchState.awaySubstitutionState || createLiveSubstitutionState()) },
    activeFormation: isHome ? (liveMatchState.homeActiveFormation || state.teams[teamId]?.activeFormation) : (liveMatchState.awayActiveFormation || state.teams[teamId]?.activeFormation),
    formationMap: isHome
      ? { ...(liveMatchState.homeFormationMap || {}) }
      : { ...(liveMatchState.awayFormationMap || {}) },
  };
};

export const makeLiveSubstitutionsState = (
  state: LiveMatchActionState,
  fixtureId: string,
  replacements: LiveReplacement[]
): { patch: Partial<LiveMatchActionState>; result: LiveMatchActionResult } => {
  const fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return failLiveAction('No active live fixture found.');
  const liveMatchState = state.liveMatches?.[fixtureId];
  if (!liveMatchState?.initialized) return failLiveAction('Start the match before making substitutions.');
  if (!Array.isArray(replacements) || replacements.length === 0) return failLiveAction('Choose at least one substitution.');

  const side = getManagedLiveSide(state, fixture, liveMatchState);
  if (!side) return failLiveAction('You can only make substitutions for your own team.');
  const team = state.teams[side.teamId];
  if (!team) return failLiveAction('Your team could not be found.');

  const latestMinute = getLatestProcessedMinute(liveMatchState);
  const maxLiveMinute = getLiveMatchMaxMinute(fixture, liveMatchState);
  if (latestMinute <= 0 || latestMinute >= maxLiveMinute) return failLiveAction('Substitutions are only available during an active match.');
  const isHalfTime = latestMinute === 45;
  const spendWindow = !isHalfTime;
  const activeSubstitutionState = { ...side.substitutionState };
  if (maxLiveMinute > LIVE_MATCH_MINUTES && latestMinute >= LIVE_MATCH_MINUTES) {
    activeSubstitutionState.maxWindows = Math.max(activeSubstitutionState.maxWindows || 3, 4);
  }
  if (!canUseLiveSubstitutionWindow(activeSubstitutionState, replacements.length, spendWindow)) {
    return failLiveAction(spendWindow ? 'No substitution windows remaining.' : 'No substitutions remaining.');
  }

  const sentOffPlayers = new Set(liveMatchState.sentOffPlayerIds || []);
  const currentIds = [...side.currentIds];
  const benchIds = new Set(side.benchIds);
  const starterIds = new Set(side.starterIds);
  const offIds = new Set<string>();
  const onIds = new Set<string>();

  for (const replacement of replacements) {
    if (!replacement?.offPlayerId || !replacement?.onPlayerId) return failLiveAction('Every substitution needs an off-player and on-player.');
    if (replacement.offPlayerId === replacement.onPlayerId) return failLiveAction('A player cannot replace himself.');
    if (offIds.has(replacement.offPlayerId) || onIds.has(replacement.onPlayerId)) return failLiveAction('Duplicate players in a substitution batch.');
    offIds.add(replacement.offPlayerId);
    onIds.add(replacement.onPlayerId);

    const offPlayer = state.players[replacement.offPlayerId];
    const onPlayer = state.players[replacement.onPlayerId];
    if (!offPlayer || !onPlayer || offPlayer.teamId !== side.teamId || onPlayer.teamId !== side.teamId) {
      return failLiveAction('Substitutions must use players from your own team.');
    }
    if (!currentIds.includes(offPlayer.id)) return failLiveAction(`${offPlayer.name} is not currently on the pitch.`);
    if (!benchIds.has(onPlayer.id)) return failLiveAction(`${onPlayer.name} is not on the match bench.`);
    if (currentIds.includes(onPlayer.id) || onIds.has(offPlayer.id)) return failLiveAction('A player already on the pitch cannot come on.');
    if (sentOffPlayers.has(offPlayer.id) || sentOffPlayers.has(onPlayer.id)) return failLiveAction('Sent-off players cannot be used in substitutions.');
    if (isPlayerUnavailable(onPlayer)) return failLiveAction(`${onPlayer.name} is unavailable.`);
    if ((side.minuteMap[onPlayer.id] || 0) > 0 || starterIds.has(onPlayer.id)) {
      return failLiveAction(`${onPlayer.name} cannot re-enter the match.`);
    }
    if (offPlayer.position === 'GK' && onPlayer.position !== 'GK') {
      return failLiveAction('A goalkeeper can only be replaced by another goalkeeper.');
    }
  }

  let nextCurrentIds = currentIds.map(playerId => {
    const replacement = replacements.find(item => item.offPlayerId === playerId);
    return replacement ? replacement.onPlayerId : playerId;
  });
  nextCurrentIds = nextCurrentIds.filter((playerId, index, ids) => ids.indexOf(playerId) === index);
  const nextPlayers = getPlayersByIds(state.players, nextCurrentIds);
  const validation = validateMatchdayXI(nextPlayers, { teamId: side.teamId });
  if (!validation.ok) return failLiveAction(validation.reason || 'The resulting XI is not legal.');

  let nextFormationMap = { ...side.formationMap };
  const nextSubEntryMinutes = { ...side.subEntryMinutes };
  const nextMinuteMap = { ...side.minuteMap };
  replacements.forEach(replacement => {
    const entryMinute = nextSubEntryMinutes[replacement.offPlayerId];
    nextMinuteMap[replacement.offPlayerId] = entryMinute !== undefined
      ? Math.max(0, latestMinute - entryMinute)
      : Math.min(nextMinuteMap[replacement.offPlayerId] || maxLiveMinute, latestMinute);
    if (entryMinute !== undefined) delete nextSubEntryMinutes[replacement.offPlayerId];
    nextSubEntryMinutes[replacement.onPlayerId] = latestMinute;
    nextMinuteMap[replacement.onPlayerId] = Math.max(nextMinuteMap[replacement.onPlayerId] || 0, maxLiveMinute - latestMinute);
    nextFormationMap = replaceLiveFormationMapPlayer(nextFormationMap, replacement.offPlayerId, replacement.onPlayerId);
  });

  const nextSubstitutionState = { ...activeSubstitutionState };
  recordLiveSubstitution(nextSubstitutionState, replacements.length, spendWindow);
  const nextGoalkeeperId = selectDesignatedGoalkeeperId(nextPlayers, side.goalkeeperId) || validation.goalkeeperId;
  const nextLiveMatchState: LiveMatchState = side.isHome
    ? {
        ...liveMatchState,
        currentHomePlayerIds: nextCurrentIds,
        homeMinuteMap: nextMinuteMap,
        homeSubEntryMinutes: nextSubEntryMinutes,
        homeGoalkeeperId: nextGoalkeeperId,
        homeSubstitutionState: nextSubstitutionState,
        homeFormationMap: nextFormationMap,
      }
    : {
        ...liveMatchState,
        currentAwayPlayerIds: nextCurrentIds,
        awayMinuteMap: nextMinuteMap,
        awaySubEntryMinutes: nextSubEntryMinutes,
        awayGoalkeeperId: nextGoalkeeperId,
        awaySubstitutionState: nextSubstitutionState,
        awayFormationMap: nextFormationMap,
      };

  return {
    patch: {
      liveMatches: {
        ...(state.liveMatches || {}),
        [fixtureId]: nextLiveMatchState,
      },
    },
    result: {
      success: true,
      message: `${replacements.length} substitution${replacements.length === 1 ? '' : 's'} made.`,
    },
  };
};

export const setLiveMatchFormationState = (
  state: LiveMatchActionState,
  fixtureId: string,
  teamId: string,
  formation: Formation
): { patch: Partial<LiveMatchActionState>; result: LiveMatchActionResult } => {
  const fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return failLiveAction('No active live fixture found.');
  const liveMatchState = state.liveMatches?.[fixtureId];
  if (!liveMatchState?.initialized) return failLiveAction('Start the match before changing shape.');
  if (teamId !== state.userTeamId) return failLiveAction('You can only change shape for your own team.');
  if (fixture.homeTeamId !== teamId && fixture.awayTeamId !== teamId) return failLiveAction('That team is not in this fixture.');
  if (!SUPPORTED_FORMATIONS.includes(formation)) return failLiveAction('Unsupported formation.');

  const isHome = fixture.homeTeamId === teamId;
  const team = state.teams[teamId];
  const currentIds = isHome
    ? (liveMatchState.currentHomePlayerIds || liveMatchState.homeStarterIds)
    : (liveMatchState.currentAwayPlayerIds || liveMatchState.awayStarterIds);
  const currentPlayers = getPlayersByIds(state.players, currentIds);
  const validation = validateMatchdayXI(currentPlayers, {
    teamId,
    designatedGoalkeeperId: isHome ? liveMatchState.homeGoalkeeperId : liveMatchState.awayGoalkeeperId,
    allowEmergencyGoalkeeper: true,
  });
  if (!team || !validation.ok) return failLiveAction(validation.reason || 'The current XI cannot be reshaped.');

  const currentMap = isHome ? liveMatchState.homeFormationMap : liveMatchState.awayFormationMap;
  const formationMap = buildLiveFormationMap(team, formation, currentPlayers, currentMap);
  const nextLiveMatchState: LiveMatchState = isHome
    ? { ...liveMatchState, homeActiveFormation: formation, homeFormationMap: formationMap }
    : { ...liveMatchState, awayActiveFormation: formation, awayFormationMap: formationMap };

  return {
    patch: {
      liveMatches: {
        ...(state.liveMatches || {}),
        [fixtureId]: nextLiveMatchState,
      },
    },
    result: { success: true, message: `Shape changed to ${formation}.` },
  };
};

export const processLiveMatchMinuteState = (
  state: LiveMatchActionState,
  fixtureId: string,
  minute: number,
  rng?: RandomGenerator
): { patch: LiveMatchActionPatch; event: string | null } => {
  let eventMsg: string | null = null;
  const fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return { patch: state, event: eventMsg };
  if (fixture.resolution === 'void') return { patch: state, event: eventMsg };
  const storedLiveState = state.liveMatches?.[fixtureId];
  const maxLiveMinute = getLiveMatchMaxMinute(fixture, storedLiveState);
  if (!Number.isInteger(minute) || minute < 1 || minute > maxLiveMinute) {
    throw new Error(`Live match minute must be an integer from 1 to ${maxLiveMinute}; got ${minute}.`);
  }
  const fixtureSeason = state.competitions[fixture.competitionId]?.season || 1;
  const activeRng = rng ?? createFixtureEventRandomGenerator(fixtureId, getPossessionIndexForMinute(minute) ?? minute, state.rngState ?? 1, fixtureSeason, 'live-minute');

  const processedMinutes = new Set(storedLiveState?.processedMinutes || []);
  if (processedMinutes.has(minute)) return { patch: state, event: eventMsg };
  const highestProcessedMinute = processedMinutes.size > 0 ? Math.max(...processedMinutes) : 0;
  if (minute !== highestProcessedMinute + 1) {
    throw new Error(`Live match minutes must be processed sequentially; expected ${highestProcessedMinute + 1}, got ${minute}.`);
  }

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
    if (!homeValidation.ok && !awayValidation.ok) {
      const voidFixture = buildVoidFixture(fixture);
      eventMsg = `Fixture cannot be played: ${homeValidation.reason || 'home XI legal'}; ${awayValidation.reason || 'away XI legal'}.`;
      return {
        patch: {
          fixtures: { ...state.fixtures, [fixtureId]: voidFixture },
          liveMatches: removeLiveMatchFixture(state.liveMatches || {}, fixtureId),
        },
        event: eventMsg,
      };
    }
    const outcome = getAdministrativeFixtureOutcome(fixture, homeValidation.ok, awayValidation.ok);
    updatedTeams[homeTeam.id] = {
      ...(outcome.resolution === 'void'
        ? homeTeam
        : updateTeamStats(homeTeam, outcome.homeScore, outcome.awayScore, outcome.includeTableStats)),
      lastStartingXI: homeValidation.ok ? homeStarters.map(player => player.id) : [],
    };
    updatedTeams[awayTeam.id] = {
      ...(outcome.resolution === 'void'
        ? awayTeam
        : updateTeamStats(awayTeam, outcome.awayScore, outcome.homeScore, outcome.includeTableStats)),
      lastStartingXI: awayValidation.ok ? awayStarters.map(player => player.id) : [],
    };
    eventMsg = `Fixture resolved by forfeit: ${homeValidation.reason || 'home XI legal'}; ${awayValidation.reason || 'away XI legal'}.`;
    const forfeitedFixture = {
      ...updatedFixture,
      homeScore: outcome.homeScore,
      awayScore: outcome.awayScore,
      isPlayed: true,
      winnerTeamId: outcome.winnerTeamId,
      resolution: outcome.resolution,
    };
    const suspensionServedPlayers = applyFixtureSuspensionService(updatedPlayers, forfeitedFixture);
    const nextFixtures = { ...state.fixtures, [fixtureId]: forfeitedFixture };
    const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, updatedTeams);
    return {
      patch: {
        fixtures: competitionProgression.fixtures,
        competitions: competitionProgression.competitions,
        teams: updatedTeams,
        players: suspensionServedPlayers,
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
  let extraTimeStarted = Boolean(storedLiveState?.extraTimeStarted);
  let regulationHomeScore = storedLiveState?.regulationHomeScore;
  let regulationAwayScore = storedLiveState?.regulationAwayScore;
  if (minute > LIVE_MATCH_MINUTES && !extraTimeStarted) {
    extraTimeStarted = true;
    regulationHomeScore = fixture.homeScore || 0;
    regulationAwayScore = fixture.awayScore || 0;
    homeSubstitutionState.maxWindows = Math.max(homeSubstitutionState.maxWindows || 3, 4);
    awaySubstitutionState.maxWindows = Math.max(awaySubstitutionState.maxWindows || 3, 4);
    eventMsg = 'EXTRA TIME.';
  }
  const appliedSubstitutionCheckpoints = new Set(storedLiveState?.appliedSubstitutionCheckpoints || []);
  let homeActiveFormation = storedLiveState?.homeActiveFormation || homeTeam.activeFormation;
  let awayActiveFormation = storedLiveState?.awayActiveFormation || awayTeam.activeFormation;
  let homeFormationMap = storedLiveState?.homeFormationMap
    ? { ...storedLiveState.homeFormationMap }
    : buildLiveFormationMap(homeTeam, homeActiveFormation, homeStarters, homeTeam.formationMap);
  let awayFormationMap = storedLiveState?.awayFormationMap
    ? { ...storedLiveState.awayFormationMap }
    : buildLiveFormationMap(awayTeam, awayActiveFormation, awayStarters, awayTeam.formationMap);
  let homeShots = storedLiveState?.homeShots || 0;
  let awayShots = storedLiveState?.awayShots || 0;
  let homeShotsOnTarget = storedLiveState?.homeShotsOnTarget || 0;
  let awayShotsOnTarget = storedLiveState?.awayShotsOnTarget || 0;

  const liveSubstitutionCheckpoints = minute > LIVE_MATCH_MINUTES
    ? [105]
    : [...SUBSTITUTION_CHECKPOINTS];

  liveSubstitutionCheckpoints
    .filter(checkpoint => checkpoint <= minute && !appliedSubstitutionCheckpoints.has(checkpoint))
    .forEach(checkpoint => {
      if (state.userTeamId !== homeTeam.id) {
        applySubstitutions(homeStarters, availableHomeBench, sentOffPlayers, homeMinuteMap, homeTeam, updatedFixture.homeScore!, updatedFixture.awayScore!, activeRng, {
          minuteOverride: checkpoint,
          playerEntryMinutes: homeSubEntryMinutes,
          substitutionState: homeSubstitutionState,
          matchEndMinute: minute > LIVE_MATCH_MINUTES ? LIVE_MATCH_EXTRA_TIME_MINUTES : LIVE_MATCH_MINUTES,
          onSubstitution: (offPlayer, onPlayer) => {
            homeStarters = homeStarters.map(player => (player.id === offPlayer.id ? onPlayer : player));
            availableHomeBench = availableHomeBench.filter(player => player.id !== onPlayer.id);
            homeFormationMap = replaceLiveFormationMapPlayer(homeFormationMap, offPlayer.id, onPlayer.id);
            if (offPlayer.id === homeGoalkeeperId || onPlayer.position === 'GK') homeGoalkeeperId = onPlayer.id;
          },
        });
      }
      if (state.userTeamId !== awayTeam.id) {
        applySubstitutions(awayStarters, availableAwayBench, sentOffPlayers, awayMinuteMap, awayTeam, updatedFixture.awayScore!, updatedFixture.homeScore!, activeRng, {
          minuteOverride: checkpoint,
          playerEntryMinutes: awaySubEntryMinutes,
          substitutionState: awaySubstitutionState,
          matchEndMinute: minute > LIVE_MATCH_MINUTES ? LIVE_MATCH_EXTRA_TIME_MINUTES : LIVE_MATCH_MINUTES,
          onSubstitution: (offPlayer, onPlayer) => {
            awayStarters = awayStarters.map(player => (player.id === offPlayer.id ? onPlayer : player));
            availableAwayBench = availableAwayBench.filter(player => player.id !== onPlayer.id);
            awayFormationMap = replaceLiveFormationMapPlayer(awayFormationMap, offPlayer.id, onPlayer.id);
            if (offPlayer.id === awayGoalkeeperId || onPlayer.position === 'GK') awayGoalkeeperId = onPlayer.id;
          },
        });
      }
      appliedSubstitutionCheckpoints.add(checkpoint);
    });

  const liveHomeTeam = buildLiveTeamOverlay(homeTeam, homeActiveFormation, homeFormationMap);
  const liveAwayTeam = buildLiveTeamOverlay(awayTeam, awayActiveFormation, awayFormationMap);
  const energyDrainMultiplier = minute > LIVE_MATCH_MINUTES ? ENGINE_CONFIG.EXTRA_TIME_ENERGY_DRAIN_MULTIPLIER : 1;
  drainLiveMatchEnergy(updatedPlayers, homeStarters, liveHomeTeam, energyDrainMultiplier);
  drainLiveMatchEnergy(updatedPlayers, awayStarters, liveAwayTeam, energyDrainMultiplier);
  homeStarters = refreshPlayersById(updatedPlayers, homeStarters);
  awayStarters = refreshPlayersById(updatedPlayers, awayStarters);

  const possessionIndex = getPossessionIndexForMinute(minute);
  if (possessionIndex !== null) {
    const activeMatchEndMinute = minute > LIVE_MATCH_MINUTES ? LIVE_MATCH_EXTRA_TIME_MINUTES : LIVE_MATCH_MINUTES;
    const homeFormMult = getFormModifier(homeTeam.form);
    const awayFormMult = getFormModifier(awayTeam.form);
    homeGoalkeeperId = selectDesignatedGoalkeeperId(homeStarters, homeGoalkeeperId) || selectEmergencyGoalkeeperId(homeStarters);
    awayGoalkeeperId = selectDesignatedGoalkeeperId(awayStarters, awayGoalkeeperId) || selectEmergencyGoalkeeperId(awayStarters);
    const homeProfile = buildCurrentMatchProfile(liveHomeTeam, homeStarters, homeFormMult, ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE, homeGoalkeeperId);
    const awayProfile = buildCurrentMatchProfile(liveAwayTeam, awayStarters, awayFormMult, 1, awayGoalkeeperId);
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
    const attacker = isHomeAttacking ? liveHomeTeam : liveAwayTeam;
    const defender = isHomeAttacking ? liveAwayTeam : liveHomeTeam;
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
      const substitutionState = isHome ? homeSubstitutionState : awaySubstitutionState;
      if (reserveGoalkeeper && xi.length >= 7 && canUseLiveSubstitutionWindow(substitutionState)) {
        const outfielderOff = [...xi]
          .filter(player => player.position !== 'GK')
          .sort((a, b) => a.overallRating - b.overallRating)[0];
        if (!outfielderOff) return;

        const minuteMap = isHome ? homeMinuteMap : awayMinuteMap;
        const entries = isHome ? homeSubEntryMinutes : awaySubEntryMinutes;
        const entryMinute = entries[outfielderOff.id];
        minuteMap[outfielderOff.id] = entryMinute !== undefined
          ? Math.max(0, minute - entryMinute)
          : Math.min(minuteMap[outfielderOff.id] || activeMatchEndMinute, minute);
        if (entryMinute !== undefined) delete entries[outfielderOff.id];
        entries[reserveGoalkeeper.id] = minute;
        minuteMap[reserveGoalkeeper.id] = Math.max(minuteMap[reserveGoalkeeper.id] || 0, activeMatchEndMinute - minute);

        if (isHome) {
          homeStarters = homeStarters.map(player => player.id === outfielderOff.id ? reserveGoalkeeper : player);
          availableHomeBench = availableHomeBench.filter(player => player.id !== reserveGoalkeeper.id);
          homeFormationMap = replaceLiveFormationMapPlayer(homeFormationMap, outfielderOff.id, reserveGoalkeeper.id);
          homeGoalkeeperId = reserveGoalkeeper.id;
          recordLiveSubstitution(homeSubstitutionState);
        } else {
          awayStarters = awayStarters.map(player => player.id === outfielderOff.id ? reserveGoalkeeper : player);
          availableAwayBench = availableAwayBench.filter(player => player.id !== reserveGoalkeeper.id);
          awayFormationMap = replaceLiveFormationMapPlayer(awayFormationMap, outfielderOff.id, reserveGoalkeeper.id);
          awayGoalkeeperId = reserveGoalkeeper.id;
          recordLiveSubstitution(awaySubstitutionState);
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
        // `suspensionAppliedWeek` is deprecated; same-match skip is driven by `suspensionAppliedFixtureId`.
        suspensionAppliedFixtureId: fixture.id,
      };
      addContribution(playerId, 'redCards');
      sentOffPlayers.add(playerId);
      sentOffMinutes[playerId] = minute;
      eventMsg = message;
      if (homeMinuteMap[playerId] !== undefined) {
        const entryMinute = homeSubEntryMinutes[playerId];
        homeMinuteMap[playerId] = entryMinute !== undefined
          ? Math.max(0, minute - entryMinute)
          : Math.min(homeMinuteMap[playerId] || activeMatchEndMinute, minute);
        delete homeSubEntryMinutes[playerId];
        homeStarters = homeStarters.filter(starter => starter.id !== playerId);
        homeFormationMap = removePlayerFromLiveFormationMap(homeFormationMap, playerId);
        coverDismissedGoalkeeper('home');
      }
      if (awayMinuteMap[playerId] !== undefined) {
        const entryMinute = awaySubEntryMinutes[playerId];
        awayMinuteMap[playerId] = entryMinute !== undefined
          ? Math.max(0, minute - entryMinute)
          : Math.min(awayMinuteMap[playerId] || activeMatchEndMinute, minute);
        delete awaySubEntryMinutes[playerId];
        awayStarters = awayStarters.filter(starter => starter.id !== playerId);
        awayFormationMap = removePlayerFromLiveFormationMap(awayFormationMap, playerId);
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
      activeRng,
      matchYellowCards
    );
    eventMsg = res.event;

    if (res.shot) {
      if (isHomeAttacking) {
        homeShots += 1;
        if (res.shot.onTarget) homeShotsOnTarget += 1;
      } else {
        awayShots += 1;
        if (res.shot.onTarget) awayShotsOnTarget += 1;
      }
    }

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
  if (minute === LIVE_MATCH_MINUTES && !eventMsg) {
    eventMsg = fixture.isKnockout && updatedFixture.homeScore === updatedFixture.awayScore
      ? 'END OF 90. Extra time to come.'
      : 'FULL TIME.';
  }
  if (minute === LIVE_MATCH_EXTRA_TIME_MINUTES && !eventMsg) eventMsg = 'END OF EXTRA TIME.';

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
    if (!homeCanContinue && !awayCanContinue) {
      const voidFixture = buildVoidFixture(fixture);
      return {
        patch: {
          fixtures: { ...state.fixtures, [fixtureId]: voidFixture },
          liveMatches: removeLiveMatchFixture(state.liveMatches || {}, fixtureId),
        },
        event: eventMsg || `Match voided: ${homeContinuation.reason || 'home XI legal'}; ${awayContinuation.reason || 'away XI legal'}.`,
      };
    }
    const outcome = getAdministrativeFixtureOutcome(fixture, homeCanContinue, awayCanContinue);
    if (outcome.resolution === 'void') {
      updatedFixture.homeScore = outcome.homeScore;
      updatedFixture.awayScore = outcome.awayScore;
    } else {
      if (homeCanContinue && !awayCanContinue) updatedFixture.homeScore = Math.max(updatedFixture.homeScore || 0, (updatedFixture.awayScore || 0) + 1, outcome.homeScore);
      if (awayCanContinue && !homeCanContinue) updatedFixture.awayScore = Math.max(updatedFixture.awayScore || 0, (updatedFixture.homeScore || 0) + 1, outcome.awayScore);
    }
    const forfeitedFixture = {
      ...updatedFixture,
      isPlayed: true,
      winnerTeamId: outcome.winnerTeamId,
      resolution: outcome.resolution,
    };
    const includeTableStats = outcome.includeTableStats;
    updatedTeams[homeTeam.id] = {
      ...(outcome.resolution === 'void'
        ? homeTeam
        : updateTeamStats(homeTeam, forfeitedFixture.homeScore || 0, forfeitedFixture.awayScore || 0, includeTableStats)),
      lastStartingXI: homeStarterIds,
    };
    updatedTeams[awayTeam.id] = {
      ...(outcome.resolution === 'void'
        ? awayTeam
        : updateTeamStats(awayTeam, forfeitedFixture.awayScore || 0, forfeitedFixture.homeScore || 0, includeTableStats)),
      lastStartingXI: awayStarterIds,
    };
    const suspensionServedPlayers = applyFixtureSuspensionService(updatedPlayers, forfeitedFixture);
    const nextFixtures = { ...state.fixtures, [fixtureId]: forfeitedFixture };
    const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, updatedTeams);
    return {
      patch: {
        fixtures: competitionProgression.fixtures,
        competitions: competitionProgression.competitions,
        teams: updatedTeams,
        players: suspensionServedPlayers,
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
    sentOffMinutes,
    homeGoalMinutes,
    awayGoalMinutes,
    matchContributions,
    homeShots,
    awayShots,
    homeShotsOnTarget,
    awayShotsOnTarget,
    homeStarterIds,
    awayStarterIds,
    currentHomePlayerIds: homeStarters.map(player => player.id),
    currentAwayPlayerIds: awayStarters.map(player => player.id),
    homeActiveFormation,
    awayActiveFormation,
    homeFormationMap,
    awayFormationMap,
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
    extraTimeStarted,
    regulationHomeScore,
    regulationAwayScore,
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
  const processThroughMinute = (endMinute: number) => {
    for (let minute = 1; minute <= endMinute; minute += 1) {
      const processedMinutes = new Set(nextState.liveMatches?.[fixtureId]?.processedMinutes || []);
      if (processedMinutes.has(minute)) continue;
      const update = processLiveMatchMinuteState(nextState, fixtureId, minute, rng);
      nextState = { ...nextState, ...update.patch };
    }
  };

  processThroughMinute(LIVE_MATCH_MINUTES);
  const fixtureAfterRegulation = nextState.fixtures[fixtureId];
  const liveAfterRegulation = nextState.liveMatches?.[fixtureId];
  if (fixtureAfterRegulation && isTiedKnockoutAtEndOfRegulation(fixtureAfterRegulation, liveAfterRegulation)) {
    processThroughMinute(LIVE_MATCH_EXTRA_TIME_MINUTES);
  }
  return nextState;
};

export const finishLiveMatchState = (
  state: LiveMatchActionState,
  fixtureId: string,
  rng?: RandomGenerator
): LiveMatchActionPatch => {
  let fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return state;
  if (fixture.resolution === 'void') return state;
  state = completeLiveMatchMinutes(state, fixtureId, rng);
  fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return state;
  if (fixture.resolution === 'void') return state;
  const finalRng = rng ?? createFixtureEventRandomGenerator(fixtureId, 91, state.rngState ?? 1, state.competitions[fixture.competitionId]?.season || 1, 'live-finish');
  const previousPlayers = state.players;

  const homeTeam = state.teams[fixture.homeTeamId];
  const awayTeam = state.teams[fixture.awayTeamId];
  const liveMatchState = state.liveMatches?.[fixtureId];
  const maxMatchMinutes = liveMatchState?.extraTimeStarted ? LIVE_MATCH_EXTRA_TIME_MINUTES : LIVE_MATCH_MINUTES;
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
    : buildStarterMinuteMap(homeTeamStarters, sentOffMinutes, maxMatchMinutes);
  const awayMinuteMap = liveMatchState?.awayMinuteMap
    ? { ...liveMatchState.awayMinuteMap }
    : buildStarterMinuteMap(awayTeamStarters, sentOffMinutes, maxMatchMinutes);

  const extendActiveIdsToEnd = (
    activeIds: string[] | undefined,
    minuteMap: Record<string, number>,
    entryMinutes?: Record<string, number>
  ) => {
    (activeIds || []).forEach(playerId => {
      if (sentOffPlayers.has(playerId)) return;
      const entryMinute = entryMinutes?.[playerId] ?? 0;
      minuteMap[playerId] = Math.max(minuteMap[playerId] || 0, maxMatchMinutes - entryMinute);
    });
  };
  extendActiveIdsToEnd(liveMatchState?.currentHomePlayerIds || homeTeamStarters.map(player => player.id), homeMinuteMap, liveMatchState?.homeSubEntryMinutes);
  extendActiveIdsToEnd(liveMatchState?.currentAwayPlayerIds || awayTeamStarters.map(player => player.id), awayMinuteMap, liveMatchState?.awaySubEntryMinutes);

  if (!liveMatchState?.homeMinuteMap && state.userTeamId !== homeTeam.id) {
    applySubstitutions(homeTeamStarters, homeBench, sentOffPlayers, homeMinuteMap, homeTeam, hScore, aScore, finalRng);
  }
  if (!liveMatchState?.awayMinuteMap && state.userTeamId !== awayTeam.id) {
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
    maxMatchMinutes,
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
    maxMatchMinutes,
  });
  const injuryEvents = [
    ...applyMatchInjuries(homeParticipants, homeMinuteMap, updatedPlayers, fixture.week, finalRng),
    ...applyMatchInjuries(awayParticipants, awayMinuteMap, updatedPlayers, fixture.week, finalRng),
  ];

  let winnerTeamId: string | undefined;
  let resolution: Fixture['resolution'] | undefined;
  let penaltyShootout: Fixture['penaltyShootout'] | undefined;
  const regulationHomeScore = liveMatchState?.regulationHomeScore ?? hScore;
  const regulationAwayScore = liveMatchState?.regulationAwayScore ?? aScore;
  if (fixture.isKnockout) {
    if (hScore === aScore) {
      const homePenaltyPlayers = liveMatchState?.currentHomePlayerIds
        ? getPlayersByIds(updatedPlayers, liveMatchState.currentHomePlayerIds).filter(player => !sentOffPlayers.has(player.id))
        : homeTeamStarters.filter(player => !sentOffPlayers.has(player.id));
      const awayPenaltyPlayers = liveMatchState?.currentAwayPlayerIds
        ? getPlayersByIds(updatedPlayers, liveMatchState.currentAwayPlayerIds).filter(player => !sentOffPlayers.has(player.id))
        : awayTeamStarters.filter(player => !sentOffPlayers.has(player.id));
      penaltyShootout = simulatePenaltyShootout(
        homeTeam,
        awayTeam,
        homePenaltyPlayers,
        awayPenaltyPlayers,
        finalRng,
        ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE
      );
      winnerTeamId = penaltyShootout.winnerTeamId;
      resolution = 'penalties';
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
  const matchSummary = state.userTeamId && (fixture.homeTeamId === state.userTeamId || fixture.awayTeamId === state.userTeamId)
    ? buildMatchSummary({
        fixture: updatedFixture,
        homeTeam,
        awayTeam,
        players: updatedPlayers,
        homeParticipants,
        awayParticipants,
        homeStarterIds: new Set(homeTeamStarters.map(player => player.id)),
        awayStarterIds: new Set(awayTeamStarters.map(player => player.id)),
        homeMinuteMap,
        awayMinuteMap,
        matchContributions: liveMatchState?.matchContributions,
        homeShots: liveMatchState?.homeShots || 0,
        awayShots: liveMatchState?.awayShots || 0,
        homeShotsOnTarget: liveMatchState?.homeShotsOnTarget || 0,
        awayShotsOnTarget: liveMatchState?.awayShotsOnTarget || 0,
        maxMatchMinutes,
      })
    : undefined;
  const fixtureWithSummary = matchSummary ? { ...updatedFixture, matchSummary } : updatedFixture;
  const includeTableStats = fixture.competitionType === 'league' && fixture.round === 'league';
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
  const suspensionServedPlayers = applyFixtureSuspensionService(updatedPlayers, fixtureWithSummary);
  const nextFixtures = { ...state.fixtures, [fixtureId]: fixtureWithSummary };
  const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, updatedTeams);

  return appendFixtureResultToState(state, {
    fixture: fixtureWithSummary,
    players: suspensionServedPlayers,
    teams: updatedTeams,
    previousPlayers,
    competitionResult: competitionProgression,
  });
};

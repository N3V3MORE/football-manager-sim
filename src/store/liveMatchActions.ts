import { ENGINE_CONFIG } from '../config/engineConfig';
import { Fixture, GameState, Player } from '../models/types';
import {
  buildTeamShapeProfile,
  getFormModifier,
  getMoraleModifier,
  selectPossessionAttacker,
  simulatePossession,
} from '../core/matchEngine';
import { addPlayerStat, scaleLineupForMatch } from '../core/matchUtils';
import { RandomGenerator, defaultRandomGenerator } from '../core/random';
import { applySubstitutions } from '../core/substitutionEngine';
import { buildStarterBenchMinuteMap, buildStarterMinuteMap } from '../core/minuteMapUtils';
import { applySharedPostMatchAccounting, PlayerMatchContribution } from '../core/postMatchAccounting';
import { applyMatchInjuries } from '../core/injuryEngine';
import { getTeamMatchBench } from '../core/lineupEngine';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { resolveCompetitionProgression } from '../core/competitionEngine';
import { removePlayerFromTeamSelections } from '../core/formationMapUtils';
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

export const processLiveMatchMinuteState = (
  state: LiveMatchActionState,
  fixtureId: string,
  minute: number,
  rng: RandomGenerator = defaultRandomGenerator
): { patch: LiveMatchActionPatch; event: string | null } => {
  let eventMsg: string | null = null;
  const random = rng.next;
  const fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return { patch: state, event: eventMsg };

  const storedLiveState = state.liveMatches?.[fixtureId];
  const processedMinutes = new Set(storedLiveState?.processedMinutes || []);
  if (processedMinutes.has(minute)) return { patch: state, event: eventMsg };

  const updatedPlayers = { ...state.players };
  const updatedFixture = { ...fixture };
  if (updatedFixture.homeScore === null) updatedFixture.homeScore = 0;
  if (updatedFixture.awayScore === null) updatedFixture.awayScore = 0;

  const homeTeam = state.teams[fixture.homeTeamId];
  const awayTeam = state.teams[fixture.awayTeamId];
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

  if (homeStarters.length === 0 || awayStarters.length === 0) {
    return { patch: state, event: eventMsg };
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
  const appliedSubstitutionCheckpoints = new Set(storedLiveState?.appliedSubstitutionCheckpoints || []);

  LIVE_SUBSTITUTION_CHECKPOINTS
    .filter(checkpoint => checkpoint <= minute && !appliedSubstitutionCheckpoints.has(checkpoint))
    .forEach(checkpoint => {
      applySubstitutions(homeStarters, availableHomeBench, sentOffPlayers, homeMinuteMap, homeTeam, updatedFixture.homeScore!, updatedFixture.awayScore!, rng, {
        maxSubsOverride: 1,
        minuteOverride: checkpoint,
        playerEntryMinutes: homeSubEntryMinutes,
        onSubstitution: (offPlayer, onPlayer) => {
          homeStarters = homeStarters.map(player => (player.id === offPlayer.id ? onPlayer : player));
          availableHomeBench = availableHomeBench.filter(player => player.id !== onPlayer.id);
        },
      });
      applySubstitutions(awayStarters, availableAwayBench, sentOffPlayers, awayMinuteMap, awayTeam, updatedFixture.awayScore!, updatedFixture.homeScore!, rng, {
        maxSubsOverride: 1,
        minuteOverride: checkpoint,
        playerEntryMinutes: awaySubEntryMinutes,
        onSubstitution: (offPlayer, onPlayer) => {
          awayStarters = awayStarters.map(player => (player.id === offPlayer.id ? onPlayer : player));
          availableAwayBench = availableAwayBench.filter(player => player.id !== onPlayer.id);
        },
      });
      appliedSubstitutionCheckpoints.add(checkpoint);
    });

  drainLiveMatchEnergy(updatedPlayers, [...homeStarters, ...awayStarters]);

  const possessionIndex = getPossessionIndexForMinute(minute);
  if (possessionIndex !== null) {
    const homeFormMult = getFormModifier(homeTeam.form);
    const awayFormMult = getFormModifier(awayTeam.form);
    const homeMoraleMult = getMoraleModifier(homeStarters);
    const awayMoraleMult = getMoraleModifier(awayStarters);
    const scaledHome = scaleLineupForMatch(
      homeStarters,
      homeFormMult,
      homeMoraleMult,
      ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE,
      homeTeam.clubClass
    );
    const scaledAway = scaleLineupForMatch(awayStarters, awayFormMult, awayMoraleMult, 1, awayTeam.clubClass);
    const homeShape = buildTeamShapeProfile(homeTeam, homeStarters);
    const awayShape = buildTeamShapeProfile(awayTeam, awayStarters);
    const isHomeAttacking = selectPossessionAttacker(
      homeTeam,
      awayTeam,
      scaledHome,
      scaledAway,
      homeShape,
      awayShape,
      rng
    );
    const attacker = isHomeAttacking ? homeTeam : awayTeam;
    const defender = isHomeAttacking ? awayTeam : homeTeam;
    const attPlayers = isHomeAttacking ? scaledHome : scaledAway;
    const defPlayers = isHomeAttacking ? scaledAway : scaledHome;
    const attShape = isHomeAttacking ? homeShape : awayShape;
    const defShape = isHomeAttacking ? awayShape : homeShape;

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
      if (homeMinuteMap[playerId] !== undefined) {
        const entryMinute = homeSubEntryMinutes[playerId];
        homeMinuteMap[playerId] = entryMinute !== undefined
          ? Math.max(0, minute - entryMinute)
          : Math.min(homeMinuteMap[playerId] || 90, minute);
        delete homeSubEntryMinutes[playerId];
        homeStarters = homeStarters.filter(starter => starter.id !== playerId);
      }
      if (awayMinuteMap[playerId] !== undefined) {
        const entryMinute = awaySubEntryMinutes[playerId];
        awayMinuteMap[playerId] = entryMinute !== undefined
          ? Math.max(0, minute - entryMinute)
          : Math.min(awayMinuteMap[playerId] || 90, minute);
        delete awaySubEntryMinutes[playerId];
        awayStarters = awayStarters.filter(starter => starter.id !== playerId);
      }
      eventMsg = message;
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
      rng
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
            if (random() < ENGINE_CONFIG.SECOND_YELLOW_RED_CHANCE) {
              addPlayerStat(updatedPlayers, playerId, 'yellowCards');
              addContribution(playerId, 'yellowCards');
              sendOffPlayer(playerId, `${res.foul.player.name} receives a second yellow and is sent off.`);
            } else {
              eventMsg = `${res.foul.player.name} avoids a second yellow after the foul.`;
            }
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
    appliedSubstitutionCheckpoints: Array.from(appliedSubstitutionCheckpoints),
    processedMinutes: [...processedMinutes, minute],
  };

  return {
    patch: {
      fixtures: { ...state.fixtures, [fixtureId]: updatedFixture },
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

export const finishLiveMatchState = (
  state: LiveMatchActionState,
  fixtureId: string,
  rng: RandomGenerator = defaultRandomGenerator
): LiveMatchActionPatch => {
  const fixture = state.fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return state;
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
    applySubstitutions(homeTeamStarters, homeBench, sentOffPlayers, homeMinuteMap, homeTeam, hScore, aScore, rng);
  }
  if (!liveMatchState?.awayMinuteMap) {
    applySubstitutions(awayTeamStarters, awayBench, sentOffPlayers, awayMinuteMap, awayTeam, aScore, hScore, rng);
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
    rng,
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
    rng,
    applyEnergyDrain: false,
    playerMatchContributions: liveMatchState?.matchContributions,
  });
  const injuryEvents = [
    ...applyMatchInjuries(homeParticipants, homeMinuteMap, updatedPlayers, fixture.week, rng),
    ...applyMatchInjuries(awayParticipants, awayMinuteMap, updatedPlayers, fixture.week, rng),
  ];

  let winnerTeamId: string | undefined;
  let resolution: Fixture['resolution'] | undefined;
  if (fixture.isKnockout) {
    if (hScore === aScore) {
      const homePenaltyEdge = homeTeamStarters.reduce((sum, player) => sum + player.overallRating, 0) + 25;
      const awayPenaltyEdge = awayTeamStarters.reduce((sum, player) => sum + player.overallRating, 0);
      const totalEdge = Math.max(1, homePenaltyEdge + awayPenaltyEdge);
      winnerTeamId = (rng.next() * totalEdge) < homePenaltyEdge ? homeTeam.id : awayTeam.id;
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

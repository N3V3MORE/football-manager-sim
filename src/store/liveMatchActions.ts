import { ENGINE_CONFIG } from '../config/engineConfig';
import { Fixture, GameState, Player } from '../models/types';
import {
  buildTeamShapeProfile,
  getFormModifier,
  getMoraleModifier,
  simulatePossession,
} from '../core/matchEngine';
import { addPlayerStat, scaleLineupForMatch } from '../core/matchUtils';
import { RandomGenerator, defaultRandomGenerator } from '../core/random';
import { applySubstitutions } from '../core/substitutionEngine';
import { buildStarterMinuteMap } from '../core/minuteMapUtils';
import { applySharedPostMatchAccounting, PlayerMatchContribution } from '../core/postMatchAccounting';
import { applyMatchInjuries } from '../core/injuryEngine';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { resolveCompetitionProgression } from '../core/competitionEngine';
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
  const firstAttackIsHome = storedLiveState?.firstAttackIsHome ?? (random() < 0.5);

  const homeStarters = ensureLiveTeamStarters(homeTeam.id, state.teams, updatedPlayers, sentOffPlayers, allowAutoAssign);
  const awayStarters = ensureLiveTeamStarters(awayTeam.id, state.teams, updatedPlayers, sentOffPlayers, allowAutoAssign);

  if (homeStarters.length === 0 || awayStarters.length === 0) {
    return { patch: state, event: eventMsg };
  }

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
    const isHomeAttacking = ((possessionIndex + (firstAttackIsHome ? 0 : 1)) % 2) === 0;
    const attacker = isHomeAttacking ? homeTeam : awayTeam;
    const defender = isHomeAttacking ? awayTeam : homeTeam;
    const attPlayers = isHomeAttacking ? scaledHome : scaledAway;
    const defPlayers = isHomeAttacking ? scaledAway : scaledHome;
    const homeShape = buildTeamShapeProfile(homeTeam, homeStarters);
    const awayShape = buildTeamShapeProfile(awayTeam, awayStarters);
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
    firstAttackIsHome,
    sentOffMinutes,
    homeGoalMinutes,
    awayGoalMinutes,
    matchContributions,
    homeStarterIds: storedLiveState?.homeStarterIds || homeStarters.map(player => player.id),
    awayStarterIds: storedLiveState?.awayStarterIds || awayStarters.map(player => player.id),
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
  const starterIds = new Set(starters.map(player => player.id));
  return Object.values(players).filter(player => (
    player.teamId === teamId &&
    player.isSub &&
    !isPlayerUnavailable(player) &&
    !starterIds.has(player.id)
  )).slice(0, 7);
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
  const homeBench = getLiveMatchBench(state.players, homeTeam.id, homeTeamStarters);
  const awayBench = getLiveMatchBench(state.players, awayTeam.id, awayTeamStarters);
  const homeMinuteMap = buildStarterMinuteMap(homeTeamStarters, sentOffMinutes);
  const awayMinuteMap = buildStarterMinuteMap(awayTeamStarters, sentOffMinutes);

  applySubstitutions(homeTeamStarters, homeBench, sentOffPlayers, homeMinuteMap, homeTeam, hScore, aScore, rng);
  applySubstitutions(awayTeamStarters, awayBench, sentOffPlayers, awayMinuteMap, awayTeam, aScore, hScore, rng);

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
  applyMatchInjuries(homeParticipants, homeMinuteMap, updatedPlayers, fixture.week, rng);
  applyMatchInjuries(awayParticipants, awayMinuteMap, updatedPlayers, fixture.week, rng);

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

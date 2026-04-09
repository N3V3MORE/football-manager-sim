import { StoreApi } from 'zustand';
import { ENGINE_CONFIG } from '../../config/engineConfig';
import {
  autoAssignLineup,
  buildMatchTeamContext,
  buildTeamShapeProfile,
  getFormModifier,
  getMoraleModifier,
  quickSimMatch,
  simulatePossession,
} from '../../core/matchEngine';
import { getFixtureCompetitionId, isLeagueCompetitionId } from '../../core/domainRegistry';
import { getFixtureStatScopeId, recordPlayerScopedMinutes, recordPlayerScopedStat } from '../../core/playerStats';
import { qualifiesForWindowedCleanSheet } from '../../core/postMatchAccounting';
import { getTeamEnergyDrainMultiplier } from '../../core/tacticalEffects';
import { Player, Team } from '../../models/types';
import { GameStore, LiveMatchState } from '../types';

type SetState = StoreApi<GameStore>['setState'];
type GetState = StoreApi<GameStore>['getState'];

const LIVE_MATCH_MINUTES = 90;

const getPossessionIndexForMinute = (minute: number) => {
  const current = Math.floor((minute * ENGINE_CONFIG.TOTAL_POSSESSIONS) / LIVE_MATCH_MINUTES);
  const previous = Math.floor(((minute - 1) * ENGINE_CONFIG.TOTAL_POSSESSIONS) / LIVE_MATCH_MINUTES);
  return current > previous ? current - 1 : null;
};

const getPlayersByIds = (players: Record<string, Player>, ids: string[]) => (
  ids.map(id => players[id]).filter((player): player is Player => Boolean(player))
);

const scaleMatchPlayers = (players: Player[], formMultiplier: number, moraleMultiplier: number, homeAdvantage = 1) => (
  players.map(player => ({
    ...player,
    stats: {
      ...player.stats,
      passing: player.stats.passing * formMultiplier * moraleMultiplier * homeAdvantage,
      shooting: player.stats.shooting * formMultiplier * moraleMultiplier * homeAdvantage,
      defending: (player.stats.defending || 50) * formMultiplier * moraleMultiplier * homeAdvantage,
      dribbling: (player.stats.dribbling || 50) * formMultiplier * moraleMultiplier * homeAdvantage,
    },
  }))
);

const getEligibleStarters = (
  players: Record<string, Player>,
  teamId: string,
  sentOffPlayers: Set<string>
) => Object.values(players)
  .filter(player => (
    player.teamId === teamId &&
    player.isStarting &&
    player.matchesSuspended === 0 &&
    !sentOffPlayers.has(player.id)
  ));

const ensureLiveTeamStarters = (
  teamId: string,
  teams: Record<string, Team>,
  players: Record<string, Player>,
  sentOffPlayers: Set<string>,
  allowAutoAssign: boolean
) => {
  let starters = getEligibleStarters(players, teamId, sentOffPlayers);
  if (!allowAutoAssign || starters.length >= 11) return starters;

  const team = teams[teamId];
  const lineupUpdates = autoAssignLineup(teamId, players, team.activeFormation);
  Object.entries(lineupUpdates).forEach(([playerId, updates]) => {
    players[playerId] = { ...players[playerId], ...updates };
  });
  starters = getEligibleStarters(players, teamId, sentOffPlayers);
  return starters;
};

const drainLiveMatchEnergy = (players: Record<string, Player>, starters: Player[], multiplier = 1) => {
  starters.forEach(player => {
    players[player.id] = {
      ...players[player.id],
      energy: Math.max(0, players[player.id].energy - (ENGINE_CONFIG.ENERGY_DRAIN_PER_MINUTE * multiplier)),
    };
  });
};

const removeLiveMatchFixture = (
  liveMatches: Record<string, LiveMatchState>,
  fixtureId: string
) => {
  const nextLiveMatches = { ...liveMatches };
  delete nextLiveMatches[fixtureId];
  return nextLiveMatches;
};

const applyLivePostMatchStats = (
  players: Record<string, Player>,
  teamStarters: Player[],
  minuteMap: Record<string, number>,
  concededGoalMinutes: number[],
  oppGoals: number,
  isWin: boolean,
  isDraw: boolean,
  statScopeId: string
) => {
  teamStarters.forEach(player => {
    const minutes = Math.max(0, Math.min(90, minuteMap[player.id] ?? 90));
    if (minutes <= 0) return;
    let rating = 6.0 + (Math.random() * 1.2 - 0.4);
    if (isWin) rating += 0.8;
    if (isDraw) rating += 0.2;
    if (!isWin && !isDraw) rating -= 0.6;

    let cleanSheetBonus = 0;
    if (
      (player.position === 'DEF' || player.position === 'GK') &&
      qualifiesForWindowedCleanSheet(concededGoalMinutes, 0, minutes, oppGoals)
    ) {
      cleanSheetBonus = 1;
      rating += 1.0;
    }

    rating += (player.impactCoefficient - 1.0);
    if (minutes < 30) rating -= 0.3;
    rating = Math.max(1.0, Math.min(10.0, Math.round(rating * 10) / 10));

    if (cleanSheetBonus > 0) {
      recordPlayerScopedStat(players, player.id, statScopeId, 'cleanSheets', cleanSheetBonus);
    }
    recordPlayerScopedMinutes(players, player.id, statScopeId, minutes);
    players[player.id] = {
      ...players[player.id],
      matchRatingHistory: [...(players[player.id].matchRatingHistory || []), rating],
    };
  });
};

const updateTeamStats = (team: Team, goalsFor: number, goalsAgainst: number) => {
  let points = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  if (goalsFor > goalsAgainst) { points = 3; wins = 1; }
  else if (goalsFor === goalsAgainst) { points = 1; draws = 1; }
  else { losses = 1; }

  const formToken = wins ? 'W' : draws ? 'D' : 'L';
  return {
    ...team,
    points: team.points + points,
    goalsFor: team.goalsFor + goalsFor,
    goalsAgainst: team.goalsAgainst + goalsAgainst,
    wins: team.wins + wins,
    draws: team.draws + draws,
    losses: team.losses + losses,
    played: team.played + 1,
    form: [...(team.form || []), formToken].slice(-5),
  };
};

export const createMatchActions = (set: SetState, get: GetState): Pick<GameStore, 'playMatch' | 'processMatchMinute' | 'finishLiveMatch'> => ({
  playMatch: (fixtureId: string) => {
    set((state) => {
      const { players, teams, fixture } = quickSimMatch(fixtureId, state.players, state.teams, state.fixtures, state.userTeamId);
      const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);

      return {
        players,
        teams,
        fixtures: { ...state.fixtures, [fixtureId]: fixture },
        liveMatches,
      };
    });
  },

  processMatchMinute: (fixtureId: string, minute: number) => {
    let eventMsg: string | null = null;
    set((state) => {
      const fixture = state.fixtures[fixtureId];
      if (!fixture || fixture.isPlayed) return state;

      const updatedPlayers = { ...state.players };
      const updatedFixture = { ...fixture };
      const statScopeId = getFixtureStatScopeId(fixture);
      if (updatedFixture.homeScore === null) updatedFixture.homeScore = 0;
      if (updatedFixture.awayScore === null) updatedFixture.awayScore = 0;

      const homeTeam = state.teams[fixture.homeTeamId];
      const awayTeam = state.teams[fixture.awayTeamId];
      const storedLiveState = state.liveMatches?.[fixtureId];
      const sentOffPlayers = new Set(storedLiveState?.sentOffPlayerIds || []);
      const sentOffMinutes = { ...(storedLiveState?.sentOffMinutes || {}) };
      const homeGoalMinutes = [...(storedLiveState?.homeGoalMinutes || [])];
      const awayGoalMinutes = [...(storedLiveState?.awayGoalMinutes || [])];
      const matchYellowCards = new Set(storedLiveState?.yellowCardPlayerIds || []);
      const allowAutoAssign = !storedLiveState?.initialized;

      const homeStarters = ensureLiveTeamStarters(homeTeam.id, state.teams, updatedPlayers, sentOffPlayers, allowAutoAssign);
      const awayStarters = ensureLiveTeamStarters(awayTeam.id, state.teams, updatedPlayers, sentOffPlayers, allowAutoAssign);

      if (homeStarters.length === 0 || awayStarters.length === 0) return state;

      const competitionEnergyMultiplier = isLeagueCompetitionId(getFixtureCompetitionId(fixture)) ? 1 : 0.5;
      drainLiveMatchEnergy(
        updatedPlayers,
        homeStarters,
        competitionEnergyMultiplier * getTeamEnergyDrainMultiplier(homeTeam, homeStarters)
      );
      drainLiveMatchEnergy(
        updatedPlayers,
        awayStarters,
        competitionEnergyMultiplier * getTeamEnergyDrainMultiplier(awayTeam, awayStarters)
      );

      const possessionIndex = getPossessionIndexForMinute(minute);
      if (possessionIndex !== null) {
        const homeFormMult = getFormModifier(homeTeam.form);
        const awayFormMult = getFormModifier(awayTeam.form);
        const homeMoraleMult = getMoraleModifier(homeStarters);
        const awayMoraleMult = getMoraleModifier(awayStarters);
        const scaledHome = scaleMatchPlayers(homeStarters, homeFormMult, homeMoraleMult, ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE);
        const scaledAway = scaleMatchPlayers(awayStarters, awayFormMult, awayMoraleMult);
        const isHomeAttacking = possessionIndex % 2 === 0;
        const attacker = isHomeAttacking ? homeTeam : awayTeam;
        const defender = isHomeAttacking ? awayTeam : homeTeam;
        const attPlayers = isHomeAttacking ? scaledHome : scaledAway;
        const defPlayers = isHomeAttacking ? scaledAway : scaledHome;
        const homeShape = buildTeamShapeProfile(homeTeam, homeStarters);
        const awayShape = buildTeamShapeProfile(awayTeam, awayStarters);
        const homeContext = buildMatchTeamContext(homeTeam, scaledHome, homeShape);
        const awayContext = buildMatchTeamContext(awayTeam, scaledAway, awayShape);
        const attShape = isHomeAttacking ? homeShape : awayShape;
        const defShape = isHomeAttacking ? awayShape : homeShape;
        const attContext = isHomeAttacking ? homeContext : awayContext;
        const defContext = isHomeAttacking ? awayContext : homeContext;

        const sendOffPlayer = (playerId: string, message: string) => {
          const player = updatedPlayers[playerId];
          if (!player || sentOffPlayers.has(playerId)) return;
          updatedPlayers[playerId] = {
            ...player,
            matchesSuspended: 3,
          };
          recordPlayerScopedStat(updatedPlayers, playerId, statScopeId, 'redCards');
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
          attContext,
          defContext
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
          if (res.scorer) recordPlayerScopedStat(updatedPlayers, res.scorer.id, statScopeId, 'goals');
          if (res.assister) recordPlayerScopedStat(updatedPlayers, res.assister.id, statScopeId, 'assists');
        }
        if (res.foul) {
          if (!isLeagueCompetitionId(getFixtureCompetitionId(fixture))) {
            // Cup discipline stays local to the match for now.
          } else {
            const playerId = res.foul.player.id;
            if (!sentOffPlayers.has(playerId)) {
              if (res.foul.type === 'Y') {
                if (matchYellowCards.has(playerId)) {
                  if (Math.random() < ENGINE_CONFIG.SECOND_YELLOW_RED_CHANCE) {
                    recordPlayerScopedStat(updatedPlayers, playerId, statScopeId, 'yellowCards');
                    sendOffPlayer(playerId, `${res.foul.player.name} receives a second yellow and is sent off.`);
                  } else {
                    eventMsg = `${res.foul.player.name} avoids a second yellow after the foul.`;
                  }
                } else {
                  recordPlayerScopedStat(updatedPlayers, playerId, statScopeId, 'yellowCards');
                  matchYellowCards.add(playerId);
                }
              } else {
                sendOffPlayer(playerId, `${res.foul.player.name} is shown a straight red card.`);
              }
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
        sentOffMinutes,
        homeGoalMinutes,
        awayGoalMinutes,
        homeStarterIds: storedLiveState?.homeStarterIds || homeStarters.map(p => p.id),
        awayStarterIds: storedLiveState?.awayStarterIds || awayStarters.map(p => p.id),
      };

      return {
        fixtures: { ...state.fixtures, [fixtureId]: updatedFixture },
        players: updatedPlayers,
        liveMatches: { ...(state.liveMatches || {}), [fixtureId]: liveMatchState },
      };
    });
    return { event: eventMsg };
  },

  finishLiveMatch: (fixtureId: string) => {
    set((state) => {
      const fixture = state.fixtures[fixtureId];
      if (!fixture || fixture.isPlayed) return state;

      const homeTeam = state.teams[fixture.homeTeamId];
      const awayTeam = state.teams[fixture.awayTeamId];
      const liveMatchState = state.liveMatches?.[fixtureId];
      const sentOffMinutes = liveMatchState?.sentOffMinutes || {};
      const homeGoalMinutes = liveMatchState?.homeGoalMinutes || [];
      const awayGoalMinutes = liveMatchState?.awayGoalMinutes || [];
      const homeTeamPlayers = liveMatchState
        ? getPlayersByIds(state.players, liveMatchState.homeStarterIds)
        : Object.values(state.players).filter(p => p.teamId === homeTeam.id && p.isStarting && p.matchesSuspended === 0);
      const awayTeamPlayers = liveMatchState
        ? getPlayersByIds(state.players, liveMatchState.awayStarterIds)
        : Object.values(state.players).filter(p => p.teamId === awayTeam.id && p.isStarting && p.matchesSuspended === 0);
      const buildMinuteMap = (teamPlayers: Player[]) => (
        Object.fromEntries(teamPlayers.map(player => [
          player.id,
          Math.max(0, Math.min(90, sentOffMinutes[player.id] ?? 90)),
        ]))
      );

      const updatedPlayers = { ...state.players };
      const statScopeId = getFixtureStatScopeId(fixture);

      const hScore = fixture.homeScore || 0;
      const aScore = fixture.awayScore || 0;
      const homeMinuteMap = buildMinuteMap(homeTeamPlayers);
      const awayMinuteMap = buildMinuteMap(awayTeamPlayers);

      applyLivePostMatchStats(
        updatedPlayers,
        homeTeamPlayers,
        homeMinuteMap,
        awayGoalMinutes,
        aScore,
        hScore > aScore,
        hScore === aScore,
        statScopeId
      );
      applyLivePostMatchStats(
        updatedPlayers,
        awayTeamPlayers,
        awayMinuteMap,
        homeGoalMinutes,
        hScore,
        aScore > hScore,
        aScore === hScore,
        statScopeId
      );

      const updatedFixture = { ...fixture, isPlayed: true };
      const winnerTeamId = isLeagueCompetitionId(getFixtureCompetitionId(fixture))
        ? undefined
        : (hScore > aScore ? homeTeam.id : aScore > hScore ? awayTeam.id : (Math.random() < 0.5 ? homeTeam.id : awayTeam.id));
      if (winnerTeamId) {
        updatedFixture.winnerTeamId = winnerTeamId;
        if (hScore === aScore) updatedFixture.decidedBy = 'PEN';
      }

      const updatedTeams = isLeagueCompetitionId(getFixtureCompetitionId(fixture))
        ? {
          ...state.teams,
          [homeTeam.id]: { ...updateTeamStats(homeTeam, hScore, aScore), lastStartingXI: homeTeamPlayers.map(p => p.id) },
          [awayTeam.id]: { ...updateTeamStats(awayTeam, aScore, hScore), lastStartingXI: awayTeamPlayers.map(p => p.id) },
        }
        : {
          ...state.teams,
          [homeTeam.id]: { ...homeTeam, lastStartingXI: homeTeamPlayers.map(p => p.id) },
          [awayTeam.id]: { ...awayTeam, lastStartingXI: awayTeamPlayers.map(p => p.id) },
        };
      const liveMatches = removeLiveMatchFixture(state.liveMatches || {}, fixtureId);

      return {
        fixtures: { ...state.fixtures, [fixtureId]: updatedFixture },
        teams: updatedTeams,
        players: updatedPlayers,
        liveMatches,
      };
    });
  },
});

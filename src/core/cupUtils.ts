import { CompetitionId, CupCompetition, CupState, Fixture, Team } from '../models/types';
import {
  ACTIVE_CUP_COMPETITION_IDS,
  getCompetitionDefinition,
  getCompetitionRoundName,
  getFixtureCompetitionId,
} from './domainRegistry';
import { sortTeamsByDivisionAndName } from './leagueUtils';
import { resolveCupWinnerTeamId } from './competitionUtils';

export const CUP_COMPETITIONS: CupCompetition[] = [...ACTIVE_CUP_COMPETITION_IDS];

const getCompetitionEntrants = (
  teams: Record<string, Team>,
  competitionId: CompetitionId
) => {
  const definition = getCompetitionDefinition(competitionId);
  const countryScope = definition.countryScope;
  return sortTeamsByDivisionAndName(
    Object.values(teams).filter(team => !countryScope || countryScope === 'europe' || team.countryId === countryScope)
  ).map(team => team.id);
};

const buildCupRoundFixtures = (
  competitionId: CupCompetition,
  roundNumber: number,
  scheduledWeek: number,
  entrants: string[],
  fixtureCounterStart: number
) => {
  const fixtures: Record<string, Fixture> = {};
  const participants = [...entrants];
  const byeTeamId = participants.length % 2 === 1 ? participants.pop() : undefined;
  let fixtureCounter = fixtureCounterStart;

  for (let index = 0; index < participants.length; index += 2) {
    const homeTeamId = participants[index];
    const awayTeamId = participants[index + 1];
    if (!homeTeamId || !awayTeamId) continue;

    const fixtureId = `F${fixtureCounter++}`;
    fixtures[fixtureId] = {
      id: fixtureId,
      week: scheduledWeek,
      competitionId,
      competition: competitionId,
      roundNumber,
      roundName: getCompetitionRoundName(competitionId, roundNumber),
      homeTeamId,
      awayTeamId,
      homeScore: null,
      awayScore: null,
      isPlayed: false,
    };
  }

  return {
    fixtures,
    nextCounter: fixtureCounter,
    byeTeamId,
    roundName: getCompetitionRoundName(competitionId, roundNumber),
  };
};

export const buildInitialCupStates = (teams: Record<string, Team>) => (
  CUP_COMPETITIONS.reduce<Record<string, CupState>>((acc, competitionId) => {
    const definition = getCompetitionDefinition(competitionId);
    acc[competitionId] = {
      competitionId,
      competition: competitionId,
      roundNumber: 1,
      roundName: getCompetitionRoundName(competitionId, 1),
      entrants: getCompetitionEntrants(teams, competitionId),
      scheduledWeek: definition.startWeek,
      completed: false,
    };
    return acc;
  }, {})
);

export const buildInitialCupFixtures = (
  teams: Record<string, Team>,
  fixtureCounterStart = 1
) => {
  const cupStates = buildInitialCupStates(teams);
  let fixtures: Record<string, Fixture> = {};
  let fixtureCounter = fixtureCounterStart;

  CUP_COMPETITIONS.forEach(competitionId => {
    const cupState = cupStates[competitionId];
    const built = buildCupRoundFixtures(
      competitionId,
      cupState.roundNumber,
      cupState.scheduledWeek,
      cupState.entrants,
      fixtureCounter
    );
    fixtures = { ...fixtures, ...built.fixtures };
    fixtureCounter = built.nextCounter;
    cupState.currentRoundByeTeamId = built.byeTeamId;
  });

  return { fixtures, cupStates, nextCounter: fixtureCounter };
};

export const advanceCupCompetitions = (
  fixtures: Record<string, Fixture>,
  cupStates: Record<string, CupState>,
  currentWeek: number,
  fixtureCounterStart = 1
) => {
  let nextFixtures = { ...fixtures };
  let nextCupStates = { ...cupStates };
  let fixtureCounter = fixtureCounterStart;

  CUP_COMPETITIONS.forEach(competitionId => {
    const state = nextCupStates[competitionId];
    if (!state || state.completed) return;

    const activeRoundFixtures = Object.values(nextFixtures).filter(
      fixture => getFixtureCompetitionId(fixture) === competitionId && fixture.roundNumber === state.roundNumber
    );

    if (activeRoundFixtures.length === 0) {
      if (state.entrants.length <= 1) {
        nextCupStates[competitionId] = { ...state, completed: true };
        return;
      }

      const scheduledWeek = Math.max(currentWeek + 1, state.scheduledWeek);
      const built = buildCupRoundFixtures(
        competitionId,
        state.roundNumber,
        scheduledWeek,
        state.entrants,
        fixtureCounter
      );
      nextFixtures = { ...nextFixtures, ...built.fixtures };
      fixtureCounter = built.nextCounter;
      nextCupStates[competitionId] = {
        ...state,
        roundName: built.roundName,
        scheduledWeek,
        currentRoundByeTeamId: built.byeTeamId,
      };
      return;
    }

    if (activeRoundFixtures.some(fixture => !fixture.isPlayed)) return;

    const winners = activeRoundFixtures
      .map(fixture => resolveCupWinnerTeamId(fixture, fixture.homeScore ?? 0, fixture.awayScore ?? 0))
      .filter((teamId): teamId is string => Boolean(teamId));

    const nextEntrants = [...winners, ...(state.currentRoundByeTeamId ? [state.currentRoundByeTeamId] : [])];
    if (nextEntrants.length <= 1) {
      nextCupStates[competitionId] = {
        ...state,
        entrants: nextEntrants,
        completed: true,
      };
      return;
    }

    const nextRoundNumber = state.roundNumber + 1;
    const scheduledWeek = currentWeek + getCompetitionDefinition(competitionId).spacingWeeks;
    const built = buildCupRoundFixtures(
      competitionId,
      nextRoundNumber,
      scheduledWeek,
      nextEntrants,
      fixtureCounter
    );
    nextFixtures = { ...nextFixtures, ...built.fixtures };
    fixtureCounter = built.nextCounter;

    nextCupStates[competitionId] = {
      competitionId,
      competition: competitionId,
      roundNumber: nextRoundNumber,
      roundName: built.roundName,
      entrants: nextEntrants,
      scheduledWeek,
      currentRoundByeTeamId: built.byeTeamId,
      completed: false,
    };
  });

  return { fixtures: nextFixtures, cupStates: nextCupStates, nextCounter: fixtureCounter };
};

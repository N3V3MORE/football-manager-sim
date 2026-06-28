import { resolveCompetitionProgression } from '../core/competitionEngine';
import { quickSimMatch } from '../core/matchEngine';
import { createFixtureEventRandomGenerator } from '../core/random';
import { appendFixtureResultToState, WeeklyLifecycleState } from './fixtureResolution';

export const playMatchState = (
  state: WeeklyLifecycleState,
  fixtureId: string
): Partial<WeeklyLifecycleState> => {
  const previousPlayers = state.players;
  const seedFixture = state.fixtures[fixtureId];
  const season = seedFixture ? state.competitions[seedFixture.competitionId]?.season || 1 : 1;
  const rng = createFixtureEventRandomGenerator(fixtureId, 0, state.rngState ?? 1, season, 'quick');
  const { players, teams, fixture } = quickSimMatch(fixtureId, state.players, state.teams, state.fixtures, state.userTeamId, { rng });
  const nextFixtures = { ...state.fixtures, [fixtureId]: fixture };
  const competitionProgression = resolveCompetitionProgression(nextFixtures, state.competitions, teams);

  return appendFixtureResultToState(state, {
    fixture,
    players,
    teams,
    previousPlayers,
    competitionResult: competitionProgression,
  });
};

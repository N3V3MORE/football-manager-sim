import { appendFixtureResultToState } from '../../src/store/fixtureResolution';
import { assert, createSeededRandom, initGameData, quickSimMatch } from './shared';

export const checkAppendFixtureResultToStatePreservesPostMatchPatch = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  if (!userTeam) throw new Error('Expected Arsenal to exist in seeded teams');
  const fixture = Object.values(data.fixtures).find(item => (
    item.homeTeamId === userTeam.id || item.awayTeamId === userTeam.id
  ));
  if (!fixture) throw new Error('Expected a seeded Arsenal fixture');

  const rng = { next: createSeededRandom(2026062807) };
  const played = quickSimMatch(fixture.id, data.players, data.teams, data.fixtures, userTeam.id, { rng });
  const competitionResult = {
    fixtures: { ...data.fixtures, [fixture.id]: played.fixture },
    competitions: data.competitions,
    generatedNews: ['FA Cup draw complete'],
  };
  const state = {
    ...data,
    currentWeek: fixture.week,
    userTeamId: userTeam.id,
    inboxMessages: [],
    news: ['Existing headline'],
    liveMatches: { [fixture.id]: { fixtureId: fixture.id } },
  } as any;

  const patch = appendFixtureResultToState(state, {
    fixture: played.fixture,
    players: played.players,
    teams: played.teams,
    previousPlayers: data.players,
    competitionResult,
  });

  assert(patch.players === played.players, 'Append helper should preserve resolved player map');
  assert(patch.teams === played.teams, 'Append helper should preserve resolved team map');
  assert(patch.fixtures === competitionResult.fixtures, 'Append helper should use competition fixtures when provided');
  assert(patch.competitions === competitionResult.competitions, 'Append helper should use competition state when provided');
  assert(!patch.liveMatches?.[fixture.id], 'Append helper should clear completed live match state');
  assert(patch.news?.[0] === 'FA Cup draw complete', 'Append helper should prepend generated news');
  assert(patch.news?.includes('Existing headline'), 'Append helper should keep existing news');
  assert((patch.inboxMessages?.length || 0) >= 2, 'Append helper should merge post-match and system inbox messages');
};

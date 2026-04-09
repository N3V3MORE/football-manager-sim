import {
  CompetitionDefinition,
  CompetitionId,
  Fixture,
  GameState,
  LeagueDefinition,
  LeagueId,
  Player,
  Team,
} from '../models/types';
import {
  COMPETITION_DEFINITIONS,
  LEAGUE_DEFINITIONS,
  getFixtureCompetitionId,
  getTeamLeagueId,
} from './domainRegistry';

type RuntimeInput = Pick<GameState, 'fixtures' | 'players' | 'teams'>;

export type SimulationRuntime = {
  fixturesByWeek: Record<number, string[]>;
  teamPlayerIds: Record<string, string[]>;
  teamsByLeague: Record<LeagueId, string[]>;
  fixturesByCompetition: Record<CompetitionId, string[]>;
  leagueDefinitionsById: Record<LeagueId, LeagueDefinition>;
  competitionDefinitionsById: Record<CompetitionId, CompetitionDefinition>;
  random: () => number;
};

const buildFixturesByWeek = (fixtures: Record<string, Fixture>) => {
  const fixturesByWeek: Record<number, string[]> = {};
  Object.values(fixtures).forEach(fixture => {
    if (!fixturesByWeek[fixture.week]) {
      fixturesByWeek[fixture.week] = [];
    }
    fixturesByWeek[fixture.week].push(fixture.id);
  });
  return fixturesByWeek;
};

const buildTeamPlayerIds = (players: Record<string, Player>) => {
  const teamPlayerIds: Record<string, string[]> = {};
  Object.values(players).forEach(player => {
    if (!teamPlayerIds[player.teamId]) {
      teamPlayerIds[player.teamId] = [];
    }
    teamPlayerIds[player.teamId].push(player.id);
  });
  return teamPlayerIds;
};

const buildTeamsByLeague = (teams: Record<string, Team>) => {
  const teamsByLeague: Record<LeagueId, string[]> = {};
  Object.values(teams).forEach(team => {
    const leagueId = getTeamLeagueId(team);
    if (!teamsByLeague[leagueId]) {
      teamsByLeague[leagueId] = [];
    }
    teamsByLeague[leagueId].push(team.id);
  });
  return teamsByLeague;
};

const buildFixturesByCompetition = (fixtures: Record<string, Fixture>) => {
  const fixturesByCompetition: Record<CompetitionId, string[]> = {};
  Object.values(fixtures).forEach(fixture => {
    const competitionId = getFixtureCompetitionId(fixture);
    if (!fixturesByCompetition[competitionId]) {
      fixturesByCompetition[competitionId] = [];
    }
    fixturesByCompetition[competitionId].push(fixture.id);
  });
  return fixturesByCompetition;
};

export const buildSimulationRuntime = (
  input: RuntimeInput,
  random: () => number = Math.random
): SimulationRuntime => ({
  fixturesByWeek: buildFixturesByWeek(input.fixtures),
  teamPlayerIds: buildTeamPlayerIds(input.players),
  teamsByLeague: buildTeamsByLeague(input.teams),
  fixturesByCompetition: buildFixturesByCompetition(input.fixtures),
  leagueDefinitionsById: { ...LEAGUE_DEFINITIONS },
  competitionDefinitionsById: { ...COMPETITION_DEFINITIONS },
  random,
});

export const getRuntimeFixturesForWeek = (
  runtime: SimulationRuntime,
  fixtures: Record<string, Fixture>,
  currentWeek: number
) => (
  (runtime.fixturesByWeek[currentWeek] || [])
    .map(fixtureId => fixtures[fixtureId])
    .filter((fixture): fixture is Fixture => Boolean(fixture))
);

export const getRuntimeTeamsForLeague = (
  runtime: SimulationRuntime,
  teams: Record<string, Team>,
  leagueId: LeagueId
) => (
  (runtime.teamsByLeague[leagueId] || [])
    .map(teamId => teams[teamId])
    .filter((team): team is Team => Boolean(team))
);

export const appendRuntimeFixtures = (
  runtime: SimulationRuntime,
  previousFixtures: Record<string, Fixture>,
  nextFixtures: Record<string, Fixture>
) => {
  Object.entries(nextFixtures).forEach(([fixtureId, fixture]) => {
    if (previousFixtures[fixtureId]) return;
    if (!runtime.fixturesByWeek[fixture.week]) {
      runtime.fixturesByWeek[fixture.week] = [];
    }
    runtime.fixturesByWeek[fixture.week].push(fixtureId);

    const competitionId = getFixtureCompetitionId(fixture);
    if (!runtime.fixturesByCompetition[competitionId]) {
      runtime.fixturesByCompetition[competitionId] = [];
    }
    runtime.fixturesByCompetition[competitionId].push(fixtureId);
  });

  return runtime;
};

export const refreshRuntimeTeamPlayerIds = (
  runtime: SimulationRuntime,
  players: Record<string, Player>
) => {
  runtime.teamPlayerIds = buildTeamPlayerIds(players);
  return runtime;
};

export const refreshRuntimeTeamsByLeague = (
  runtime: SimulationRuntime,
  teams: Record<string, Team>
) => {
  runtime.teamsByLeague = buildTeamsByLeague(teams);
  return runtime;
};

export const rebuildRuntimeFixtures = (
  runtime: SimulationRuntime,
  fixtures: Record<string, Fixture>
) => {
  runtime.fixturesByWeek = buildFixturesByWeek(fixtures);
  runtime.fixturesByCompetition = buildFixturesByCompetition(fixtures);
  return runtime;
};

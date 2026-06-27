import { Fixture, Player, Team } from '../models/types';
import { applyFixtureSuspensionService, buildVoidFixture, getAdministrativeFixtureOutcome } from './fixtureLifecycle';
import { applyMatchResult } from './teamUtils';

export type FinalizeFixtureResult = {
  fixture: Fixture;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  isVoid: boolean;
};

const buildForfeitFixture = (
  fixture: Fixture,
  homeScore: number,
  awayScore: number,
  winnerTeamId: string | undefined
): Fixture => ({
  ...fixture,
  homeScore,
  awayScore,
  isPlayed: true,
  winnerTeamId,
  resolution: 'forfeit',
});

export const resolveAdministrativeFixture = (
  fixture: Fixture,
  homeCanPlay: boolean,
  awayCanPlay: boolean,
  teams: Record<string, Team>,
  players: Record<string, Player>,
  homeStarterIds: string[],
  awayStarterIds: string[]
): FinalizeFixtureResult => {
  const outcome = getAdministrativeFixtureOutcome(fixture, homeCanPlay, awayCanPlay);
  if (outcome.resolution === 'void') {
    return {
      fixture: buildVoidFixture(fixture),
      teams,
      players,
      isVoid: true,
    };
  }

  const homeTeam = teams[fixture.homeTeamId];
  const awayTeam = teams[fixture.awayTeamId];
  const updatedFixture = buildForfeitFixture(
    fixture,
    outcome.homeScore,
    outcome.awayScore,
    outcome.winnerTeamId
  );
  const updatedTeams = {
    ...teams,
    [homeTeam.id]: {
      ...(outcome.includeTableStats
        ? applyMatchResult(homeTeam, outcome.homeScore, outcome.awayScore, true)
        : homeTeam),
      lastStartingXI: homeCanPlay ? homeStarterIds : [],
    },
    [awayTeam.id]: {
      ...(outcome.includeTableStats
        ? applyMatchResult(awayTeam, outcome.awayScore, outcome.homeScore, true)
        : awayTeam),
      lastStartingXI: awayCanPlay ? awayStarterIds : [],
    },
  };

  return {
    fixture: updatedFixture,
    teams: updatedTeams,
    players: applyFixtureSuspensionService(players, updatedFixture),
    isVoid: false,
  };
};

export const applyFixtureTeamResults = (
  fixture: Fixture,
  homeScore: number,
  awayScore: number,
  resolution: Fixture['resolution'],
  teams: Record<string, Team>,
  homeStarterIds: string[],
  awayStarterIds: string[],
  includeTableStats: boolean
): Record<string, Team> => {
  if (resolution === 'void') return teams;

  const homeTeam = teams[fixture.homeTeamId];
  const awayTeam = teams[fixture.awayTeamId];

  return {
    ...teams,
    [homeTeam.id]: {
      ...(includeTableStats ? applyMatchResult(homeTeam, homeScore, awayScore, true) : homeTeam),
      lastStartingXI: homeStarterIds,
    },
    [awayTeam.id]: {
      ...(includeTableStats ? applyMatchResult(awayTeam, awayScore, homeScore, true) : awayTeam),
      lastStartingXI: awayStarterIds,
    },
  };
};

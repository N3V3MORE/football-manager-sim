import { Fixture, Player } from '../models/types';
import { weekToDateOrdinal } from '../utils/calendar';

const COMPETITION_CHRONOLOGY: Record<string, number> = {
  europe: 0,
  'carabao-cup': 1,
  'fa-cup': 2,
  'premier-league': 3,
  championship: 3,
  'league-one': 3,
  'league-two': 3,
};

export const getFixtureDateOrdinal = (fixture: Pick<Fixture, 'week' | 'dateOrdinal'>) => (
  fixture.dateOrdinal ?? weekToDateOrdinal(fixture.week)
);

export const compareFixturesChronologically = (
  left: Pick<Fixture, 'week' | 'dateOrdinal' | 'competitionId' | 'id'>,
  right: Pick<Fixture, 'week' | 'dateOrdinal' | 'competitionId' | 'id'>
) => {
  const dateDelta = getFixtureDateOrdinal(left) - getFixtureDateOrdinal(right);
  if (dateDelta !== 0) return dateDelta;
  if (left.week !== right.week) return left.week - right.week;
  const competitionDelta = (COMPETITION_CHRONOLOGY[left.competitionId] ?? 99) - (COMPETITION_CHRONOLOGY[right.competitionId] ?? 99);
  if (competitionDelta !== 0) return competitionDelta;
  return left.id.localeCompare(right.id, undefined, { numeric: true });
};

export const getTeamFixturesChronologically = (
  fixtures: Record<string, Fixture>,
  teamId: string
) => Object.values(fixtures)
  .filter(fixture => fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
  .sort(compareFixturesChronologically);

export const getNextDueFixture = (
  fixtures: Record<string, Fixture>,
  teamId: string | null | undefined,
  currentWeek: number
) => {
  if (!teamId) return null;
  return getTeamFixturesChronologically(fixtures, teamId)
    .find(fixture => !fixture.isPlayed && fixture.week <= currentWeek) || null;
};

export const getNextFixtureForTeam = (
  fixtures: Record<string, Fixture>,
  teamId: string | null | undefined,
  currentWeek = 1
) => {
  if (!teamId) return null;
  return getTeamFixturesChronologically(fixtures, teamId)
    .find(fixture => !fixture.isPlayed && fixture.week >= currentWeek) || null;
};

export const getFixtureRestViolations = (
  fixtures: Fixture[],
  minimumRestDays: number
) => {
  const fixturesByTeam = new Map<string, Fixture[]>();
  fixtures.forEach(fixture => {
    [fixture.homeTeamId, fixture.awayTeamId].forEach(teamId => {
      fixturesByTeam.set(teamId, [...(fixturesByTeam.get(teamId) || []), fixture]);
    });
  });

  const violations: { teamId: string; previousFixtureId: string; fixtureId: string; restDays: number }[] = [];
  fixturesByTeam.forEach((teamFixtures, teamId) => {
    const sorted = [...teamFixtures].sort(compareFixturesChronologically);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const fixture = sorted[index];
      const restDays = getFixtureDateOrdinal(fixture) - getFixtureDateOrdinal(previous);
      if (restDays < minimumRestDays) {
        violations.push({ teamId, previousFixtureId: previous.id, fixtureId: fixture.id, restDays });
      }
    }
  });
  return violations;
};

type AdministrativeFixtureOutcome =
  | {
      homeScore: null;
      awayScore: null;
      winnerTeamId: undefined;
      resolution: 'void';
      includeTableStats: false;
    }
  | {
      homeScore: number;
      awayScore: number;
      winnerTeamId: string | undefined;
      resolution: 'forfeit';
      includeTableStats: boolean;
    };

export const getAdministrativeFixtureOutcome = (
  fixture: Fixture,
  homeCanPlay: boolean,
  awayCanPlay: boolean
): AdministrativeFixtureOutcome => {
  if (!homeCanPlay && !awayCanPlay) {
    return {
      homeScore: null,
      awayScore: null,
      winnerTeamId: undefined,
      resolution: 'void' as const,
      includeTableStats: false,
    };
  }

  const homeScore = homeCanPlay ? 3 : 0;
  const awayScore = awayCanPlay ? 3 : 0;
  return {
    homeScore,
    awayScore,
    winnerTeamId: fixture.isKnockout
      ? (homeCanPlay ? fixture.homeTeamId : fixture.awayTeamId)
      : undefined,
    resolution: 'forfeit' as const,
    includeTableStats: fixture.competitionType === 'league' && fixture.round === 'league',
  };
};

export const buildVoidFixture = (fixture: Fixture): Fixture => ({
  ...fixture,
  homeScore: null,
  awayScore: null,
  isPlayed: false,
  winnerTeamId: undefined,
  resolution: 'void',
});

export const applyFixtureSuspensionService = (
  players: Record<string, Player>,
  fixture: Fixture
): Record<string, Player> => {
  if (!fixture.isPlayed || fixture.resolution === 'void') return players;
  let changed = false;
  const teamIds = new Set([fixture.homeTeamId, fixture.awayTeamId]);
  const nextPlayers = { ...players };

  Object.values(players).forEach(player => {
    if (!teamIds.has(player.teamId)) return;
    if ((player.matchesSuspended || 0) <= 0) return;
    if (player.suspensionAppliedFixtureId === fixture.id) return;

    const nextSuspension = Math.max(0, player.matchesSuspended - 1);
    nextPlayers[player.id] = {
      ...player,
      matchesSuspended: nextSuspension,
      suspensionAppliedWeek: nextSuspension > 0 ? player.suspensionAppliedWeek : undefined,
      suspensionAppliedFixtureId: nextSuspension > 0 ? player.suspensionAppliedFixtureId : undefined,
    };
    changed = true;
  });

  return changed ? nextPlayers : players;
};

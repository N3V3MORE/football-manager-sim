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

export const getAdministrativeFixtureOutcome = (
  fixture: Fixture,
  homeCanPlay: boolean,
  awayCanPlay: boolean
) => {
  if (!homeCanPlay && !awayCanPlay) {
    return {
      homeScore: 0,
      awayScore: 0,
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
    includeTableStats: fixture.competitionType === 'league',
  };
};

export const applyFixtureSuspensionService = (
  players: Record<string, Player>,
  fixture: Fixture
): Record<string, Player> => {
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

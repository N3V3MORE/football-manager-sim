import { getSeasonWeekLimit, sortTeamsByTable } from '@/src/core/leagueUtils';
import { CupCompetition, CupState, Fixture, Player, Team } from '@/src/models/types';
import { getCompetitionSortRank, getFixtureCompetitionId } from '@/src/core/domainRegistry';
import { getCupWinnerTeamId } from '@/src/core/trophyUtils';

const SEASON_START = new Date(2024, 7, 10);

export type CupPaneStatus = {
  round: string;
  opponent: string;
};

export type MiniTableTeam = Team & { position: number };

export type UpcomingFixtureWeek = {
  week: number;
  matches: Fixture[];
};

export type DivisionSeasonLeaders = {
  topScorer?: Player;
  topAssister?: Player;
  topCleanSheetGKs: Player[];
};

export const weekToDate = (week: number): string => {
  const d = new Date(SEASON_START);
  d.setDate(d.getDate() + (week - 1) * 7);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

type CupPaneInput = {
  competition: CupCompetition;
  fixtures: Record<string, Fixture>;
  cups: Record<CupCompetition, CupState>;
  activeUserTeamId: string;
  teams: Record<string, Team>;
};

export const getCupPaneStatus = ({
  competition,
  fixtures,
  cups,
  activeUserTeamId,
  teams,
}: CupPaneInput): CupPaneStatus => {
  const nextCupFixture = Object.values(fixtures)
    .filter(
      fixture =>
        !fixture.isPlayed &&
        getFixtureCompetitionId(fixture) === competition &&
        (fixture.homeTeamId === activeUserTeamId || fixture.awayTeamId === activeUserTeamId)
    )
    .sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week;
      return (a.roundNumber || 0) - (b.roundNumber || 0);
    })[0];

  if (nextCupFixture) {
    const isHome = nextCupFixture.homeTeamId === activeUserTeamId;
    const opponentId = isHome ? nextCupFixture.awayTeamId : nextCupFixture.homeTeamId;
    return {
      round: nextCupFixture.roundName || `Round ${nextCupFixture.roundNumber || 1}`,
      opponent: `${isHome ? 'vs' : '@'} ${teams[opponentId]?.name || 'TBD'}`,
    };
  }

  const cupState = cups[competition];
  if (!cupState) return { round: 'Not Active', opponent: 'TBD' };
  if (cupState.completed) {
    const winnerTeamId = getCupWinnerTeamId(cups, competition);
    return {
      round: winnerTeamId === activeUserTeamId ? 'Winners' : 'Eliminated',
      opponent: '-',
    };
  }

  const stillInCup =
    cupState.entrants.includes(activeUserTeamId) || cupState.currentRoundByeTeamId === activeUserTeamId;
  if (!stillInCup) return { round: 'Eliminated', opponent: '-' };
  if (cupState.currentRoundByeTeamId === activeUserTeamId) {
    return { round: `${cupState.roundName} Bye`, opponent: 'Bye week' };
  }

  return {
    round: cupState.roundName || `Round ${cupState.roundNumber}`,
    opponent: 'TBD',
  };
};

export const getLatestNewsForLeague = (
  newsItems: string[],
  leagueTeams: Team[],
  maxItems = 3
) => {
  const filteredNews = newsItems.filter(item => {
    const text = item.toLowerCase();
    return leagueTeams.some(team => text.includes(team.name.toLowerCase()));
  });

  return filteredNews.slice(0, maxItems);
};

export const getMiniTableWindow = (
  teams: Team[],
  userTeamId: string | null,
  radius = 3
): MiniTableTeam[] => {
  const sortedTeams = sortTeamsByTable(teams);
  const myIndex = sortedTeams.findIndex(team => team.id === userTeamId);
  let startIdx = Math.max(0, myIndex - radius);
  let endIdx = Math.min(sortedTeams.length - 1, myIndex + radius);

  if (myIndex < radius) endIdx = Math.min(sortedTeams.length - 1, radius * 2);
  else if (myIndex > sortedTeams.length - (radius + 1)) startIdx = Math.max(0, sortedTeams.length - (radius * 2 + 1));

  return sortedTeams.slice(startIdx, endIdx + 1).map((team, index) => ({
    ...team,
    position: startIdx + index + 1,
  }));
};

export const getTeamPosition = (teams: Team[], userTeamId: string | null) => {
  const sortedTeams = sortTeamsByTable(teams);
  const teamIndex = sortedTeams.findIndex(team => team.id === userTeamId);
  return teamIndex >= 0 ? teamIndex + 1 : 0;
};

export const getUpcomingFixtures = (
  fixtures: Record<string, Fixture>,
  currentWeek: number,
  userTeamId: string | null,
  weeksAhead = 4
): UpcomingFixtureWeek[] => {
  const upcomingFixtures: UpcomingFixtureWeek[] = [];
  const seasonWeekLimit = getSeasonWeekLimit(fixtures);

  for (let week = currentWeek; week <= Math.min(currentWeek + weeksAhead, seasonWeekLimit); week += 1) {
    const matches = Object.values(fixtures)
      .filter(fixture => fixture.week === week && (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId))
      .sort((a, b) => {
        const aRank = getCompetitionSortRank(getFixtureCompetitionId(a));
        const bRank = getCompetitionSortRank(getFixtureCompetitionId(b));
        if (aRank !== bRank) return aRank - bRank;
        return (a.roundNumber || 0) - (b.roundNumber || 0);
      });

    upcomingFixtures.push({ week, matches });
  }

  return upcomingFixtures;
};

export const getDivisionSeasonLeaders = (players: Player[]): DivisionSeasonLeaders => {
  const topScorer = [...players].filter(player => player.goals > 0).sort((a, b) => b.goals - a.goals)[0];
  const topAssister = [...players].filter(player => player.assists > 0).sort((a, b) => b.assists - a.assists)[0];
  const topCleanSheetGKs = [...players]
    .filter(player => player.position === 'GK' && (player.cleanSheets || 0) > 0)
    .sort((a, b) => (b.cleanSheets || 0) - (a.cleanSheets || 0))
    .slice(0, 3);

  return {
    topScorer,
    topAssister,
    topCleanSheetGKs,
  };
};

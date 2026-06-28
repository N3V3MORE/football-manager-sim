import { ENGINE_CONFIG } from '../config/engineConfig';
import { Fixture, LeagueDivision, Team } from '../models/types';

export interface WeeklyRevenueBreakdown {
  tv: number;
  sponsor: number;
  matchday: number;
  total: number;
}

const getLeagueDivision = (team: Team): LeagueDivision | null => {
  if (
    team.division === 'Premier League' ||
    team.division === 'Championship' ||
    team.division === 'League One' ||
    team.division === 'League Two'
  ) {
    return team.division;
  }
  return null;
};

const getSponsorClass = (team: Team): keyof typeof ENGINE_CONFIG.FINANCE.SPONSOR_WEEKLY => {
  const value = team.clubClass || 'C';
  return value in ENGINE_CONFIG.FINANCE.SPONSOR_WEEKLY
    ? value as keyof typeof ENGINE_CONFIG.FINANCE.SPONSOR_WEEKLY
    : 'C';
};

const getFixtureMatchdayRevenue = (team: Team, fixture: Fixture) => {
  if (fixture.homeTeamId !== team.id) return 0;
  const division = getLeagueDivision(team);
  if (!division) return 0;

  const leagueRate = ENGINE_CONFIG.FINANCE.MATCHDAY[division];
  if (fixture.competitionType === 'league') return leagueRate;
  return leagueRate * ENGINE_CONFIG.FINANCE.CUP_MATCHDAY;
};

export const getWeeklyRevenueBreakdown = (
  team: Team,
  playedFixtures: Fixture[]
): WeeklyRevenueBreakdown => {
  const division = getLeagueDivision(team);
  const tv = division ? ENGINE_CONFIG.FINANCE.TV_WEEKLY[division] : 0;
  const sponsor = ENGINE_CONFIG.FINANCE.SPONSOR_WEEKLY[getSponsorClass(team)];
  const matchday = playedFixtures.reduce((sum, fixture) => sum + getFixtureMatchdayRevenue(team, fixture), 0);

  return {
    tv,
    sponsor,
    matchday,
    total: tv + sponsor + matchday,
  };
};

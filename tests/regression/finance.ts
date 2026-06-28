import {
  Fixture,
  Player,
  assert,
  buildTestPlayer,
  buildTestTeam,
  computeWeeklyProgression,
  createSeededRandom,
  initGameData,
} from './shared';
import { ENGINE_CONFIG } from '../../src/config/engineConfig';
import { getWeeklyRevenueBreakdown } from '../../src/core/financeEngine';

const closeTo = (actual: number, expected: number, message: string) => {
  assert(Math.abs(actual - expected) < 0.0001, `${message}: expected ${expected}, got ${actual}`);
};

export const checkWeeklyRevenueUsesDivisionAndSponsorRates = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  assert(templateTeam, 'Expected a team template for weekly revenue regression');

  const team = buildTestTeam(templateTeam!, 'finance-team', 'Finance Team', {
    division: 'Premier League',
    clubClass: 'A',
  });
  const fixtures: Fixture[] = [
    {
      id: 'finance-league-home',
      week: 4,
      division: 'Premier League',
      competitionId: 'premier-league',
      competitionType: 'league',
      round: 'league',
      isKnockout: false,
      homeTeamId: team.id,
      awayTeamId: 'away-one',
      homeScore: 2,
      awayScore: 1,
      isPlayed: true,
    },
    {
      id: 'finance-cup-home',
      week: 4,
      competitionId: 'fa-cup',
      competitionType: 'domestic_cup',
      round: 'round_3',
      isKnockout: true,
      homeTeamId: team.id,
      awayTeamId: 'away-two',
      homeScore: 1,
      awayScore: 0,
      isPlayed: true,
    },
    {
      id: 'finance-away',
      week: 4,
      division: 'Premier League',
      competitionId: 'premier-league',
      competitionType: 'league',
      round: 'league',
      isKnockout: false,
      homeTeamId: 'away-three',
      awayTeamId: team.id,
      homeScore: 0,
      awayScore: 0,
      isPlayed: true,
    },
  ];

  const revenue = getWeeklyRevenueBreakdown(team, fixtures);
  const matchday = ENGINE_CONFIG.FINANCE.MATCHDAY['Premier League'];
  const expectedMatchday = matchday + (matchday * ENGINE_CONFIG.FINANCE.CUP_MATCHDAY);

  closeTo(revenue.tv, ENGINE_CONFIG.FINANCE.TV_WEEKLY['Premier League'], 'Weekly TV revenue should follow division');
  closeTo(revenue.sponsor, ENGINE_CONFIG.FINANCE.SPONSOR_WEEKLY.A, 'Weekly sponsor revenue should follow club class');
  closeTo(revenue.matchday, expectedMatchday, 'Only home fixtures should add matchday revenue');
  closeTo(revenue.total, revenue.tv + revenue.sponsor + revenue.matchday, 'Weekly revenue total should sum the breakdown');
};

export const checkWeeklyProgressionAppliesRevenueBreakdown = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for weekly finance progression regression');

  const team = buildTestTeam(templateTeam!, 'finance-progression', 'Finance Progression', {
    division: 'Championship',
    clubClass: 'B',
    operatingBudget: 10,
  });
  const player = buildTestPlayer(templatePlayer!, 'finance-player', team.id, 'MID', 70, {
    wage: 500,
    playerTraits: [],
  } as Partial<Player>);
  const fixture: Fixture = {
    id: 'finance-progression-home',
    week: 6,
    division: 'Championship',
    competitionId: 'championship',
    competitionType: 'league',
    round: 'league',
    isKnockout: false,
    homeTeamId: team.id,
    awayTeamId: 'opponent',
    homeScore: 1,
    awayScore: 1,
    isPlayed: true,
  };

  const result = computeWeeklyProgression(
    6,
    { [player.id]: player },
    { [team.id]: team },
    { [fixture.id]: fixture },
    [],
    team.id,
    { next: createSeededRandom(99) },
    38
  );

  const expectedOperatingBudget = (
    10 -
    0.5 +
    ENGINE_CONFIG.FINANCE.TV_WEEKLY.Championship +
    ENGINE_CONFIG.FINANCE.SPONSOR_WEEKLY.B +
    ENGINE_CONFIG.FINANCE.MATCHDAY.Championship
  );

  closeTo(
    result.teams[team.id].operatingBudget || 0,
    expectedOperatingBudget,
    'Weekly progression should add TV, sponsor, and division-scaled home revenue after wages'
  );
};

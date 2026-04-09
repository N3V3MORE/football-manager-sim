import {
  CompetitionId,
  CountryId,
  CupState,
  Fixture,
  LeagueId,
  Player,
  SeasonResult,
  Team,
  TrophyCabinet,
} from '@/src/models/types';
import {
  COMPETITION_IDS,
  DEFAULT_COUNTRY_ID,
  getCompetitionDisplayName,
  getCompetitionSortRank,
  getCountryDisplayName,
  getCountryLeagues,
  getFixtureCompetitionId,
  getLeagueDisplayName,
  getTeamLeagueId,
  getTrackedCompetitionIds,
} from '@/src/core/domainRegistry';
import { sortTeamsByDivisionAndName, sortTeamsByTable } from '@/src/core/leagueUtils';
import { getCupWinnerTeamId } from '@/src/core/trophyUtils';

export type MarketSection = {
  countryId: CountryId;
  countryName: string;
  leagueId: LeagueId;
  leagueName: string;
  players: Player[];
};

export const getUserTeam = (teams: Record<string, Team>, userTeamId: string | null) => (
  userTeamId ? teams[userTeamId] || null : null
);

export const getUserLeagueId = (teams: Record<string, Team>, userTeamId: string | null) => (
  getUserTeam(teams, userTeamId)?.leagueId
);

export const getLeagueTeams = (teams: Record<string, Team>, leagueId?: LeagueId | null) => (
  sortTeamsByTable(Object.values(teams).filter(team => !leagueId || getTeamLeagueId(team) === leagueId))
);

export const getLeaguePlayers = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  leagueId?: LeagueId | null
) => {
  const leagueTeamIds = new Set(getLeagueTeams(teams, leagueId).map(team => team.id));
  return Object.values(players).filter(player => leagueTeamIds.has(player.teamId));
};

export const getTeamsGroupedByCountry = (teams: Record<string, Team>) => {
  const grouped = Object.values(teams).reduce<Record<string, Team[]>>((acc, team) => {
    const countryId = team.countryId || DEFAULT_COUNTRY_ID;
    if (!acc[countryId]) acc[countryId] = [];
    acc[countryId].push(team);
    return acc;
  }, {});

  return Object.fromEntries(
    Object.entries(grouped).map(([countryId, countryTeams]) => [countryId, sortTeamsByTable(countryTeams)])
  ) as Record<CountryId, Team[]>;
};

export const getCountryLeagueTableSections = (
  teams: Record<string, Team>,
  countryId: CountryId
) => {
  const countryTeams = getTeamsGroupedByCountry(teams)[countryId] || [];
  return getCountryLeagues(countryId).map(leagueId => ({
    leagueId,
    leagueName: getLeagueDisplayName(leagueId),
    teams: countryTeams.filter(team => getTeamLeagueId(team) === leagueId),
  }));
};

export const getUserFixtures = (
  fixtures: Record<string, Fixture>,
  userTeamId: string | null
) => (
  Object.values(fixtures)
    .filter(fixture => fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
    .sort((left, right) => {
      if (left.week !== right.week) return left.week - right.week;
      const competitionDelta = getCompetitionSortRank(getFixtureCompetitionId(left)) - getCompetitionSortRank(getFixtureCompetitionId(right));
      if (competitionDelta !== 0) return competitionDelta;
      return (left.roundNumber || 0) - (right.roundNumber || 0);
    })
);

export const getTrackedCompetitionEntries = () => (
  getTrackedCompetitionIds().map(competitionId => ({
    competitionId,
    label: getCompetitionDisplayName(competitionId),
  }))
);

export const getTrophyCabinetEntries = (trophyCabinet: TrophyCabinet) => (
  getTrackedCompetitionEntries().map(({ competitionId, label }) => ({
    competitionId,
    label,
    count: trophyCabinet[competitionId] || 0,
  }))
);

export const getCurrentCompetitionStatuses = ({
  competitions,
  fixtures,
  cups,
  userTeamId,
}: {
  competitions: CompetitionId[];
  fixtures: Record<string, Fixture>;
  cups: Record<string, CupState>;
  userTeamId: string;
}) => Object.fromEntries(
  competitions.map(competitionId => {
    const nextFixture = Object.values(fixtures)
      .filter(
        fixture =>
          !fixture.isPlayed &&
          getFixtureCompetitionId(fixture) === competitionId &&
          (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
      )
      .sort((left, right) => {
        if (left.week !== right.week) return left.week - right.week;
        return (left.roundNumber || 0) - (right.roundNumber || 0);
      })[0];

    if (nextFixture) {
      return [competitionId, `In ${nextFixture.roundName || `Round ${nextFixture.roundNumber || 1}`}`];
    }

    const cupState = cups[competitionId];
    if (!cupState) return [competitionId, 'Not active'];
    if (cupState.completed) {
      return [competitionId, cupState.entrants[0] === userTeamId ? 'Winners' : 'Eliminated'];
    }
    const stillInCup = cupState.entrants.includes(userTeamId) || cupState.currentRoundByeTeamId === userTeamId;
    return [competitionId, stillInCup ? `In ${cupState.roundName}` : 'Eliminated'];
  })
);

export const getLeagueResultLabel = (
  teams: Record<string, Team>,
  userTeamId: string,
  leagueId: LeagueId
) => {
  const table = getLeagueTeams(teams, leagueId);
  const position = table.findIndex(team => team.id === userTeamId) + 1;
  if (position <= 0) return `- (${getLeagueDisplayName(leagueId)})`;
  const mod100 = position % 100;
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : position % 10 === 1
      ? 'st'
      : position % 10 === 2
        ? 'nd'
        : position % 10 === 3
          ? 'rd'
          : 'th';
  return `${position}${suffix} (${getLeagueDisplayName(leagueId)})`;
};

export const getDisplaySeasonResults = (seasonResults: SeasonResult[]) => (
  seasonResults.map(result => ({
    ...result,
    competitionEntries: getTrackedCompetitionEntries().map(({ competitionId, label }) => ({
      competitionId,
      label,
      result: result.competitions[competitionId] || (competitionId === COMPETITION_IDS.UEFA_CHAMPIONS_LEAGUE ? 'Not active yet' : 'Did not participate'),
    })),
  }))
);

export const getMarketSections = (
  players: Record<string, Player>,
  teams: Record<string, Team>
) => {
  const marketPlayers = Object.values(players)
    .filter(player => player.isTransferListed)
    .sort((left, right) => {
      if (right.overallRating !== left.overallRating) return right.overallRating - left.overallRating;
      if (right.marketValue !== left.marketValue) return right.marketValue - left.marketValue;
      return left.name.localeCompare(right.name);
    });

  const sectionMap = new Map<CountryId, Map<LeagueId, Player[]>>();
  marketPlayers.forEach(player => {
    const team = teams[player.teamId];
    const countryId = (team?.countryId || DEFAULT_COUNTRY_ID) as CountryId;
    const leagueId = team?.leagueId;
    if (!leagueId) return;
    if (!sectionMap.has(countryId)) sectionMap.set(countryId, new Map<LeagueId, Player[]>());
    const leagueMap = sectionMap.get(countryId)!;
    if (!leagueMap.has(leagueId)) leagueMap.set(leagueId, []);
    leagueMap.get(leagueId)!.push(player);
  });

  return Array.from(sectionMap.entries())
    .sort(([leftCountryId], [rightCountryId]) => getCountryDisplayName(leftCountryId).localeCompare(getCountryDisplayName(rightCountryId)))
    .flatMap(([countryId, leagueMap]) => (
      Array.from(leagueMap.entries())
        .sort(([leftLeagueId], [rightLeagueId]) => {
          const leftIndex = getCountryLeagues(countryId).indexOf(leftLeagueId);
          const rightIndex = getCountryLeagues(countryId).indexOf(rightLeagueId);
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          return getLeagueDisplayName(leftLeagueId).localeCompare(getLeagueDisplayName(rightLeagueId));
        })
        .map(([leagueId, leaguePlayers]) => ({
          countryId,
          countryName: getCountryDisplayName(countryId),
          leagueId,
          leagueName: getLeagueDisplayName(leagueId),
          players: leaguePlayers,
        }))
    ));
};

export const getTransferLeagueOptionsForCountry = (sections: MarketSection[], countryId?: CountryId | null) => (
  sections.filter(section => section.countryId === countryId).map(section => section.leagueId)
);

export const getTopLeagueForCountry = (countryId: CountryId) => getCountryLeagues(countryId)[0] || null;

export const sortTeamsForSettings = (teams: Record<string, Team>) => sortTeamsByDivisionAndName(Object.values(teams));

export const getExtraordinaryNewsItems = (
  newsItems: string[],
  teams: Record<string, Team>,
  leagueId?: LeagueId | null
) => {
  const leagueTeams = getLeagueTeams(teams, leagueId);
  const lowerLeagueTeams = Object.values(teams).filter(team => leagueId && getTeamLeagueId(team) !== leagueId);
  return newsItems.filter(item => {
    const text = item.toLowerCase();
    const mentionsLeagueTeam = leagueTeams.some(team => text.includes(team.name.toLowerCase()));
    if (mentionsLeagueTeam) return true;
    return lowerLeagueTeams.some(team => text.includes(team.name.toLowerCase())) && /giant kill|promotion|relegation|record|administration|points deduction|cup upset/i.test(item);
  });
};

export const getCompetitionWinnerLabel = (
  cups: Record<string, CupState>,
  competitionId: CompetitionId,
  teams: Record<string, Team>
) => {
  const winnerTeamId = getCupWinnerTeamId(cups, competitionId);
  return winnerTeamId ? teams[winnerTeamId]?.name || getCompetitionDisplayName(competitionId) : null;
};

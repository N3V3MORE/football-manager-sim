import {
  BoardObjective,
  CompetitionId,
  CupState,
  Fixture,
  LeagueId,
  Player,
  Team,
  TrophyCabinet,
  TrophyHistoryEntry,
  SeasonResult,
} from '../models/types';
import {
  COMPETITION_IDS,
  DEFAULT_LEAGUE_ID,
  getCompetitionDisplayName,
  getFixtureCompetitionId,
  getLeagueDisplayName,
  getTeamLeagueId,
  TRACKED_TROPHY_COMPETITION_IDS,
} from './domainRegistry';
import {
  DIVISION_ORDER,
  getLeaguePromotionSlots,
  getLeagueRelegationSlots,
  sortTeamsByTable,
} from './leagueUtils';
import { generateBoardObjectives } from '../utils/initGame';
import { buildSeasonFixtures } from './seasonFixtureBuilder';
import { resetPlayerSeasonStats } from './playerStats';
import { ensureTrophyCabinetShape, getCupWinnerTeamId, recordTrophyWin } from './trophyUtils';

const resetTeamStats = (team: Team): Team => ({
  ...team,
  points: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  played: 0,
  form: [],
});

const getLeagueTeams = (teams: Record<string, Team>, leagueId: LeagueId) => (
  sortTeamsByTable(Object.values(teams).filter(team => getTeamLeagueId(team) === leagueId))
);

const formatTeamList = (teams: Team[]) => teams.map(team => team.name).join(', ');
const getOrdinalSuffix = (value: number) => {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
};

export const advanceSeason = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  cups: Record<string, CupState>,
  userTeamId: string | null,
  news: string[],
  season: number,
  trophyCabinet: TrophyCabinet,
  trophyHistory: TrophyHistoryEntry[],
  seasonResults: SeasonResult[]
): {
  players: Record<string, Player>;
  teams: Record<string, Team>;
  fixtures: Record<string, Fixture>;
  cups: Record<string, CupState>;
  season: number;
  trophyCabinet: TrophyCabinet;
  trophyHistory: TrophyHistoryEntry[];
  seasonResults: SeasonResult[];
  currentWeek: number;
  news: string[];
  boardObjectives: BoardObjective[];
} => {
  const nextPlayers = Object.fromEntries(
    Object.entries(players).map(([playerId, player]) => [
      playerId,
      resetPlayerSeasonStats(player),
    ])
  );

  const seasonNews: string[] = [];
  let nextTrophyCabinet = ensureTrophyCabinetShape(trophyCabinet);
  let nextTrophyHistory = [...(trophyHistory || [])];
  let nextSeasonResults = [...(seasonResults || [])];
  const userTeam = userTeamId ? teams[userTeamId] : undefined;

  if (userTeamId && userTeam) {
    const userLeagueId = getTeamLeagueId(userTeam);
    const divisionTable = getLeagueTeams(teams, userLeagueId);
    const leaguePosition = divisionTable.findIndex(team => team.id === userTeamId) + 1;
    const formatCupResult = (competitionId: CompetitionId) => {
      const winnerTeamId = getCupWinnerTeamId(cups, competitionId);
      if (winnerTeamId === userTeamId) return 'Winners';
      const userCupFixtures = Object.values(fixtures)
        .filter(fixture => getFixtureCompetitionId(fixture) === competitionId && (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId))
        .sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));
      const playedFixtures = userCupFixtures.filter(fixture => fixture.isPlayed);
      const lastPlayed = playedFixtures.length > 0 ? playedFixtures[playedFixtures.length - 1] : undefined;
      if (lastPlayed) {
        return `Eliminated in ${lastPlayed.roundName || `Round ${lastPlayed.roundNumber || 1}`}`;
      }
      return 'Did not participate';
    };
    const seasonResult: SeasonResult = {
      season,
      teamId: userTeamId,
      teamName: userTeam.name,
      leagueId: userLeagueId,
      leagueResult: leaguePosition > 0
        ? `${getOrdinalSuffix(leaguePosition)} (${getLeagueDisplayName(userLeagueId)})`
        : `- (${getLeagueDisplayName(userLeagueId)})`,
      competitions: {
        [COMPETITION_IDS.CARABAO_CUP]: formatCupResult(COMPETITION_IDS.CARABAO_CUP),
        [COMPETITION_IDS.FA_CUP]: formatCupResult(COMPETITION_IDS.FA_CUP),
        [COMPETITION_IDS.UEFA_CHAMPIONS_LEAGUE]: 'Not active yet',
      },
    };
    nextSeasonResults = [seasonResult, ...nextSeasonResults].slice(0, 25);

    TRACKED_TROPHY_COMPETITION_IDS
      .filter(competitionId => competitionId !== COMPETITION_IDS.UEFA_CHAMPIONS_LEAGUE)
      .forEach(competitionId => {
      const winnerTeamId = getCupWinnerTeamId(cups, competitionId);
      if (winnerTeamId !== userTeamId) return;
      const recorded = recordTrophyWin(
        nextTrophyCabinet,
        nextTrophyHistory,
        competitionId,
        season,
        userTeam.id,
        userTeam.name
      );
      nextTrophyCabinet = recorded.trophyCabinet;
      nextTrophyHistory = recorded.trophyHistory;
      seasonNews.push(`${userTeam.name} lift the ${getCompetitionDisplayName(competitionId)}.`);
      });
  }
  const divisionTables = Object.fromEntries(
    DIVISION_ORDER.map(leagueId => [leagueId, getLeagueTeams(teams, leagueId)])
  ) as Record<LeagueId, Team[]>;
  const nextDivisionByTeamId: Record<string, LeagueId> = Object.fromEntries(
    Object.values(teams).map(team => [team.id, getTeamLeagueId(team)])
  ) as Record<string, LeagueId>;

  DIVISION_ORDER.forEach((leagueId, index) => {
    const divisionTeams = divisionTables[leagueId] || [];
    const upperDivision = DIVISION_ORDER[index - 1];
    const lowerDivision = DIVISION_ORDER[index + 1];

    if (upperDivision) {
      const promoted = divisionTeams.slice(0, getLeaguePromotionSlots(leagueId));
      promoted.forEach(team => {
        nextDivisionByTeamId[team.id] = upperDivision;
      });
      if (promoted.length > 0) seasonNews.push(`Promoted to ${getLeagueDisplayName(upperDivision)}: ${formatTeamList(promoted)}.`);
    }

    if (lowerDivision) {
      const relegated = divisionTeams.slice(-getLeagueRelegationSlots(leagueId));
      relegated.forEach(team => {
        nextDivisionByTeamId[team.id] = lowerDivision;
      });
      if (relegated.length > 0) seasonNews.push(`Relegated to ${getLeagueDisplayName(lowerDivision)}: ${formatTeamList(relegated)}.`);
    }
  });

  const resetTeams = Object.fromEntries(
    Object.entries(teams).map(([teamId, team]) => {
      const nextDivision = nextDivisionByTeamId[teamId] || getTeamLeagueId(team) || DEFAULT_LEAGUE_ID;
      return [
        teamId,
        resetTeamStats({ ...team, leagueId: nextDivision }),
      ];
    })
  );

  const seasonFixtures = buildSeasonFixtures(resetTeams);

  const boardObjectives = userTeamId && resetTeams[userTeamId]
    ? generateBoardObjectives(
        resetTeams[userTeamId].clubClass || 'C',
        getTeamLeagueId(resetTeams[userTeamId])
      )
    : [];

  return {
    players: nextPlayers,
    teams: resetTeams,
    fixtures: seasonFixtures.fixtures,
    cups: seasonFixtures.cups,
    season: season + 1,
    trophyCabinet: nextTrophyCabinet,
    trophyHistory: nextTrophyHistory,
    seasonResults: nextSeasonResults,
    currentWeek: 1,
    boardObjectives,
    news: [...seasonNews, 'A new season has begun.', ...news].slice(0, 20),
  };
};

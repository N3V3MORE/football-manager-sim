import { BoardObjective, Division, Fixture, Player, Team } from '../models/types';
import {
  buildRoundRobinFixtures,
  DIVISION_ORDER,
  PROMOTION_COUNT,
  RELEGATION_COUNT,
  sortTeamsByDivisionAndName,
  sortTeamsByTable,
} from './leagueUtils';
import { generateBoardObjectives } from '../utils/initGame';

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

const getDivisionTeams = (teams: Record<string, Team>, division: Division) => (
  sortTeamsByTable(Object.values(teams).filter(team => team.division === division))
);

const formatTeamList = (teams: Team[]) => teams.map(team => team.name).join(', ');

export const advanceSeason = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  userTeamId: string | null,
  news: string[]
): {
  players: Record<string, Player>;
  teams: Record<string, Team>;
  fixtures: Record<string, Fixture>;
  currentWeek: number;
  news: string[];
  boardObjectives: BoardObjective[];
} => {
  const nextPlayers = Object.fromEntries(
    Object.entries(players).map(([playerId, player]) => [
      playerId,
      { ...player, matchesSuspended: 0 },
    ])
  );

  const seasonNews: string[] = [];
  const divisionTables = Object.fromEntries(
    DIVISION_ORDER.map(division => [division, getDivisionTeams(teams, division)])
  ) as Record<Division, Team[]>;
  const nextDivisionByTeamId: Record<string, Division> = Object.fromEntries(
    Object.values(teams).map(team => [team.id, team.division])
  ) as Record<string, Division>;

  DIVISION_ORDER.forEach((division, index) => {
    const divisionTeams = divisionTables[division] || [];
    const upperDivision = DIVISION_ORDER[index - 1];
    const lowerDivision = DIVISION_ORDER[index + 1];

    if (upperDivision) {
      const promoted = divisionTeams.slice(0, PROMOTION_COUNT);
      promoted.forEach(team => {
        nextDivisionByTeamId[team.id] = upperDivision;
      });
      if (promoted.length > 0) seasonNews.push(`Promoted to ${upperDivision}: ${formatTeamList(promoted)}.`);
    }

    if (lowerDivision) {
      const relegated = divisionTeams.slice(-RELEGATION_COUNT);
      relegated.forEach(team => {
        nextDivisionByTeamId[team.id] = lowerDivision;
      });
      if (relegated.length > 0) seasonNews.push(`Relegated to ${lowerDivision}: ${formatTeamList(relegated)}.`);
    }
  });

  const resetTeams = Object.fromEntries(
    Object.entries(teams).map(([teamId, team]) => {
      const nextDivision = nextDivisionByTeamId[teamId] || team.division;
      return [
        teamId,
        resetTeamStats({ ...team, division: nextDivision }),
      ];
    })
  );

  const nextFixtures: Record<string, Fixture> = {};
  let fixtureCounter = 1;
  DIVISION_ORDER.forEach(division => {
    const divisionTeamIds = sortTeamsByDivisionAndName(
      Object.values(resetTeams).filter(team => team.division === division)
    ).map(team => team.id);
    const generated = buildRoundRobinFixtures(divisionTeamIds, division, fixtureCounter);
    Object.assign(nextFixtures, generated.fixtures);
    fixtureCounter = generated.nextCounter;
  });

  const boardObjectives = userTeamId && resetTeams[userTeamId]
    ? generateBoardObjectives(
        resetTeams[userTeamId].clubClass || 'C',
        resetTeams[userTeamId].name,
        resetTeams[userTeamId].division
      )
    : [];

  return {
    players: nextPlayers,
    teams: resetTeams,
    fixtures: nextFixtures,
    currentWeek: 1,
    boardObjectives,
    news: [...seasonNews, 'A new season has begun.', ...news].slice(0, 20),
  };
};

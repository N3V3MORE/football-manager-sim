import * as fs from 'fs';
import * as path from 'path';

import { resolveCompetitionProgression } from '../src/core/competitionEngine';
import { getSeasonWeekLimit, isLeagueDivision, sortTeamsByTable } from '../src/core/leagueUtils';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { createFixtureEventRandomGenerator, createSeededRandomGenerator } from '../src/core/random';
import { Player, Team } from '../src/models/types';
import { initGameData } from '../src/utils/initGame';

type PlayerSnapshot = {
  goals: number;
  yellowCards: number;
  redCards: number;
};

type TeamPossession = {
  possessionsFor: number;
  possessionsAgainst: number;
  matches: number;
};

type TeamAuditRow = {
  teamId: string;
  team: string;
  division: Team['division'];
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  pointsPerMatch: number;
  goalsForPerMatch: number;
  goalsAgainstPerMatch: number;
  averagePossession: number;
  flags: string[];
};

type PlayerAuditRow = {
  playerId: string;
  name: string;
  team: string;
  position: Player['position'];
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  minutesPlayed: number;
  goalsPer90: number;
};

const DEFAULT_SEASONS = 5;
const DEFAULT_SEED = 20260627;
const DEFAULT_OUTPUT_PATH = './v1_simulation_audit.json';

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const readNumberOption = (name: string, fallback: number) => {
  const arg = process.argv.slice(2).find(item => item.startsWith(`--${name}=`));
  const value = Number(arg?.split('=')[1] ?? process.env[`V1_AUDIT_${name.toUpperCase()}`] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

const snapshotPlayers = (players: Record<string, Player>) => (
  Object.fromEntries(Object.entries(players).map(([playerId, player]) => [
    playerId,
    {
      goals: player.goals,
      yellowCards: player.yellowCards,
      redCards: player.redCards,
    },
  ])) as Record<string, PlayerSnapshot>
);

const updateTeamPossession = (
  possessionByTeam: Record<string, TeamPossession>,
  teamId: string,
  possessionsFor: number,
  possessionsAgainst: number
) => {
  const current = possessionByTeam[teamId] || { possessionsFor: 0, possessionsAgainst: 0, matches: 0 };
  possessionByTeam[teamId] = {
    possessionsFor: current.possessionsFor + possessionsFor,
    possessionsAgainst: current.possessionsAgainst + possessionsAgainst,
    matches: current.matches + 1,
  };
};

const buildTeamRows = (
  teams: Record<string, Team>,
  possessionByTeam: Record<string, TeamPossession>
): TeamAuditRow[] => (
  sortTeamsByTable(Object.values(teams).filter(team => isLeagueDivision(team.division)))
    .map(team => {
      const possession = possessionByTeam[team.id] || { possessionsFor: 0, possessionsAgainst: 0, matches: 0 };
      const totalPossessions = possession.possessionsFor + possession.possessionsAgainst;
      const played = Math.max(1, team.played);
      const averagePossession = totalPossessions > 0 ? possession.possessionsFor / totalPossessions : 0.5;
      const row: TeamAuditRow = {
        teamId: team.id,
        team: team.name,
        division: team.division,
        played: team.played,
        points: team.points,
        goalsFor: team.goalsFor,
        goalsAgainst: team.goalsAgainst,
        goalDifference: team.goalsFor - team.goalsAgainst,
        pointsPerMatch: round(team.points / played, 2),
        goalsForPerMatch: round(team.goalsFor / played, 2),
        goalsAgainstPerMatch: round(team.goalsAgainst / played, 2),
        averagePossession: round(averagePossession, 3),
        flags: [],
      };

      if (row.goalsForPerMatch > 2.6) row.flags.push('high_scoring_team');
      if (row.goalsForPerMatch < 0.45) row.flags.push('low_scoring_team');
      if (row.goalsAgainstPerMatch > 2.6) row.flags.push('high_conceding_team');
      if (row.goalsAgainstPerMatch < 0.45) row.flags.push('low_conceding_team');
      if (row.pointsPerMatch > 2.45) row.flags.push('dominant_points_rate');
      if (row.pointsPerMatch < 0.45) row.flags.push('weak_points_rate');
      if (row.averagePossession > 0.68) row.flags.push('high_possession_team');
      if (row.averagePossession < 0.32) row.flags.push('low_possession_team');

      return row;
    })
);

const buildPlayerRows = (players: Record<string, Player>, teams: Record<string, Team>): PlayerAuditRow[] => (
  Object.values(players).map(player => ({
    playerId: player.id,
    name: player.name,
    team: teams[player.teamId]?.name || player.teamId,
    position: player.position,
    goals: player.goals,
    assists: player.assists,
    yellowCards: player.yellowCards,
    redCards: player.redCards,
    minutesPlayed: player.minutesPlayed,
    goalsPer90: player.minutesPlayed > 0 ? round((player.goals * 90) / player.minutesPlayed, 2) : 0,
  }))
);

const runSeason = (seasonIndex: number, seed: number) => {
  const mathRng = createSeededRandomGenerator(seed);
  Math.random = () => mathRng.next();

  const data = initGameData();
  let state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures,
    competitions: data.competitions,
    currentWeek: 1,
    news: [] as string[],
  };

  const possessionByTeam: Record<string, TeamPossession> = {};
  const matchFlags: { fixtureId: string; week: number; label: string; flags: string[] }[] = [];
  let matches = 0;
  let goals = 0;
  let yellowCards = 0;
  let redCards = 0;
  let scoreLogMismatches = 0;
  let highGoalMatches = 0;
  let bigMargins = 0;
  let singlePlayerHauls = 0;
  let administrativeFixtures = 0;
  let straightRedEvents = 0;
  let secondYellowRedEvents = 0;
  let lopsidedPossessionMatches = 0;
  const seasonWeeks = getSeasonWeekLimit(state.fixtures, state.competitions);

  for (let week = 1; week <= seasonWeeks; week += 1) {
    const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);

    for (const fixture of weekFixtures) {
      const playerSnapshot = snapshotPlayers(state.players);
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, null, {
        rng: createFixtureEventRandomGenerator(fixture.id, 0, seed, seasonIndex, 'v1-audit'),
      });
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;

      const homeScore = result.fixture.homeScore ?? 0;
      const awayScore = result.fixture.awayScore ?? 0;
      const totalGoals = homeScore + awayScore;
      const isAdministrativeScore = result.fixture.resolution === 'forfeit' || result.fixture.resolution === 'void';
      const flags: string[] = [];
      let loggedGoals = 0;
      let matchYellowCards = 0;
      let matchRedCards = 0;
      let topPlayerGoals = 0;

      Object.entries(state.players).forEach(([playerId, player]) => {
        const before = playerSnapshot[playerId];
        if (!before) return;
        const goalDelta = player.goals - before.goals;
        const yellowDelta = player.yellowCards - before.yellowCards;
        const redDelta = player.redCards - before.redCards;
        loggedGoals += goalDelta;
        matchYellowCards += yellowDelta;
        matchRedCards += redDelta;
        topPlayerGoals = Math.max(topPlayerGoals, goalDelta);
      });

      if (isAdministrativeScore) {
        administrativeFixtures += 1;
      }
      if (!isAdministrativeScore && loggedGoals !== totalGoals) {
        flags.push('score_log_mismatch');
        scoreLogMismatches += 1;
      }
      result.events.forEach(event => {
        if (/second yellow/i.test(event)) secondYellowRedEvents += 1;
        else if (/straight red|reaches for red|shown a red card|sees straight red/i.test(event)) straightRedEvents += 1;
      });
      if (totalGoals >= 7) {
        flags.push('high_goal_match');
        highGoalMatches += 1;
      }
      if (Math.abs(homeScore - awayScore) >= 5) {
        flags.push('big_margin');
        bigMargins += 1;
      }
      if (topPlayerGoals >= 4) {
        flags.push('single_player_4_plus_goals');
        singlePlayerHauls += 1;
      }
      if (result.matchStats.homePossessionShare >= 0.72 || result.matchStats.homePossessionShare <= 0.28) {
        flags.push('lopsided_possession');
        lopsidedPossessionMatches += 1;
      }

      updateTeamPossession(possessionByTeam, fixture.homeTeamId, result.matchStats.homePossessions, result.matchStats.awayPossessions);
      updateTeamPossession(possessionByTeam, fixture.awayTeamId, result.matchStats.awayPossessions, result.matchStats.homePossessions);
      if (flags.length > 0) {
        matchFlags.push({
          fixtureId: fixture.id,
          week,
          label: `${state.teams[fixture.homeTeamId]?.name || fixture.homeTeamId} ${homeScore}-${awayScore} ${state.teams[fixture.awayTeamId]?.name || fixture.awayTeamId}`,
          flags,
        });
      }

      matches += 1;
      goals += totalGoals;
      yellowCards += matchYellowCards;
      redCards += matchRedCards;
    }

    const competitionProgression = resolveCompetitionProgression(state.fixtures, state.competitions, state.teams);
    state.fixtures = competitionProgression.fixtures;
    state.competitions = competitionProgression.competitions;
    if (competitionProgression.generatedNews.length > 0) {
      state.news = [...competitionProgression.generatedNews, ...state.news].slice(0, 20);
    }

    const progression = computeWeeklyProgression(state.currentWeek, state.players, state.teams, state.fixtures, state.news);
    state.players = progression.players;
    state.teams = progression.teams;
    state.currentWeek = progression.currentWeek;
    state.news = progression.news;

    const transfers = computeWeeklyTransfers(state.players, state.teams, null, undefined, state.currentWeek);
    state.players = transfers.players;
    state.teams = transfers.teams;
  }

  const teamRows = buildTeamRows(state.teams, possessionByTeam);
  const playerRows = buildPlayerRows(state.players, state.teams);
  const tableIntegrityIssues = teamRows.filter(team => {
    const source = state.teams[team.teamId];
    return source.wins + source.draws + source.losses !== source.played ||
      source.wins * 3 + source.draws !== source.points;
  });
  const teamOutliers = teamRows.filter(team => team.flags.length > 0);
  const attackerOutliers = playerRows.filter(player => (
    (player.position === 'FWD' || player.position === 'MID') &&
    (player.goals >= 40 || (player.minutesPlayed >= 900 && player.goalsPer90 >= 1.25))
  ));
  const cardOutliers = playerRows.filter(player => player.yellowCards >= 15 || player.redCards >= 3);

  return {
    seasonIndex,
    seed,
    summary: {
      matches,
      goals,
      averageGoalsPerMatch: round(goals / matches, 2),
      yellowCards,
      yellowCardsPerMatch: round(yellowCards / matches, 2),
      redCards,
      redCardsPerMatch: round(redCards / matches, 3),
      scoreLogMismatches,
      highGoalMatches,
      bigMargins,
      singlePlayerHauls,
      administrativeFixtures,
      straightRedEvents,
      secondYellowRedEvents,
      lopsidedPossessionMatches,
      tableIntegrityIssues: tableIntegrityIssues.length,
      teamOutliers: teamOutliers.length,
      attackerOutliers: attackerOutliers.length,
      cardOutliers: cardOutliers.length,
    },
    leaders: {
      topScorers: [...playerRows].sort((a, b) => b.goals - a.goals).slice(0, 15),
      topAssists: [...playerRows].sort((a, b) => b.assists - a.assists).slice(0, 10),
      topCards: [...playerRows].sort((a, b) => (b.yellowCards + b.redCards * 2) - (a.yellowCards + a.redCards * 2)).slice(0, 10),
      topPossessionTeams: [...teamRows].sort((a, b) => b.averagePossession - a.averagePossession).slice(0, 10),
      lowPossessionTeams: [...teamRows].sort((a, b) => a.averagePossession - b.averagePossession).slice(0, 10),
    },
    outliers: {
      matches: matchFlags.slice(0, 40),
      teams: teamOutliers,
      attackers: attackerOutliers,
      cards: cardOutliers,
      tableIntegrityIssues,
    },
  };
};

const runAudit = () => {
  const originalRandom = Math.random;
  const seasons = Math.max(1, Math.min(20, Math.floor(readNumberOption('seasons', DEFAULT_SEASONS))));
  const seed = Math.floor(readNumberOption('seed', DEFAULT_SEED));
  const outputPath = path.resolve(process.cwd(), process.env.V1_AUDIT_OUT || DEFAULT_OUTPUT_PATH);

  try {
    const seasonReports = Array.from({ length: seasons }, (_, index) => runSeason(index + 1, seed + index));
    const aggregateMatches = seasonReports.reduce((sum, season) => sum + season.summary.matches, 0);
    const aggregateGoals = seasonReports.reduce((sum, season) => sum + season.summary.goals, 0);
    const aggregateYellows = seasonReports.reduce((sum, season) => sum + season.summary.yellowCards, 0);
    const aggregateReds = seasonReports.reduce((sum, season) => sum + season.summary.redCards, 0);
    const report = {
      generatedAt: new Date().toISOString(),
      options: { seasons, seed, outputPath },
      dataset: {
        grain: 'completed fixture, plus derived team-season and player-season rows',
        source: 'quickSimMatch over initialized game data with seeded fixture RNG',
      },
      aggregate: {
        seasons,
        matches: aggregateMatches,
        goals: aggregateGoals,
        averageGoalsPerMatch: round(aggregateGoals / aggregateMatches, 2),
        yellowCardsPerMatch: round(aggregateYellows / aggregateMatches, 2),
        redCardsPerMatch: round(aggregateReds / aggregateMatches, 3),
        scoreLogMismatches: seasonReports.reduce((sum, season) => sum + season.summary.scoreLogMismatches, 0),
        highGoalMatches: seasonReports.reduce((sum, season) => sum + season.summary.highGoalMatches, 0),
        bigMargins: seasonReports.reduce((sum, season) => sum + season.summary.bigMargins, 0),
        singlePlayerHauls: seasonReports.reduce((sum, season) => sum + season.summary.singlePlayerHauls, 0),
        administrativeFixtures: seasonReports.reduce((sum, season) => sum + season.summary.administrativeFixtures, 0),
        straightRedEvents: seasonReports.reduce((sum, season) => sum + season.summary.straightRedEvents, 0),
        secondYellowRedEvents: seasonReports.reduce((sum, season) => sum + season.summary.secondYellowRedEvents, 0),
        lopsidedPossessionMatches: seasonReports.reduce((sum, season) => sum + season.summary.lopsidedPossessionMatches, 0),
        tableIntegrityIssues: seasonReports.reduce((sum, season) => sum + season.summary.tableIntegrityIssues, 0),
        teamOutliers: seasonReports.reduce((sum, season) => sum + season.summary.teamOutliers, 0),
        attackerOutliers: seasonReports.reduce((sum, season) => sum + season.summary.attackerOutliers, 0),
        cardOutliers: seasonReports.reduce((sum, season) => sum + season.summary.cardOutliers, 0),
      },
      seasons: seasonReports,
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`V1 simulation audit complete. Wrote ${outputPath}`);
    console.log(JSON.stringify(report.aggregate, null, 2));
  } finally {
    Math.random = originalRandom;
  }
};

runAudit();

import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { ENGINE_CONFIG } from '../src/config/engineConfig';
import { Fixture, Player, Team } from '../src/models/types';
import { COMPETITION_IDS, getFixtureCompetitionId } from '../src/core/domainRegistry';
import * as fs from 'fs';
import * as path from 'path';

type PlayerStatSnapshot = {
  teamId: string;
  goals: number;
  assists: number;
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
  minutesPlayed: number;
  ratingCount: number;
};

type PlayerMatchDelta = {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  position: Player['position'];
  goals: number;
  assists: number;
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
  minutesPlayed: number;
  latestRating?: number;
};

type MatchReport = {
  fixtureId: string;
  week: number;
  competitionId: Fixture['competitionId'];
  roundName?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  totalGoals: number;
  playerDeltas: PlayerMatchDelta[];
  scorers: Array<{ playerId: string; name: string; teamName: string; goals: number }>;
  assisters: Array<{ playerId: string; name: string; teamName: string; assists: number }>;
  cards: Array<{ playerId: string; name: string; teamName: string; yellowCards: number; redCards: number }>;
  eventMessages: string[];
  auditFlags: string[];
};

type TransferSnapshot = {
  players: Record<string, { teamId: string; isTransferListed: boolean; askingPrice: number }>;
  budgets: Record<string, number>;
};

type TransferActivity = {
  moves: Array<{ playerId: string; name: string; fromTeam: string; toTeam: string; fee: number }>;
  newlyListed: Array<{ playerId: string; name: string; teamName: string; askingPrice: number }>;
  unlisted: Array<{ playerId: string; name: string; teamName: string }>;
  budgetDeltas: Array<{ teamId: string; teamName: string; delta: number; budget: number }>;
};

type TableRow = {
  position: number;
  teamId: string;
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string[];
  budget: number;
};

type TeamSetupSnapshot = {
  teamId: string;
  teamName: string;
  formation: string;
  tacticsKey: string;
};

type TacticalChange = {
  teamId: string;
  teamName: string;
  from: string;
  to: string;
};

const DEFAULT_TRACKER_SEED = 20260513;
const DEFAULT_OUTPUT_PATH = './season_tracking_report.json';

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;

  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const round = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const countByPlayerId = (items: Array<{ playerId: string; name: string; value: number }>) => {
  const counts = new Map<string, { playerId: string; name: string; value: number }>();
  items.forEach(item => {
    const existing = counts.get(item.playerId);
    if (existing) {
      existing.value += item.value;
      return;
    }
    counts.set(item.playerId, { ...item });
  });
  return Array.from(counts.values());
};

const snapshotPlayers = (players: Record<string, Player>): Record<string, PlayerStatSnapshot> => {
  const snapshot: Record<string, PlayerStatSnapshot> = {};
  Object.entries(players).forEach(([playerId, player]) => {
    snapshot[playerId] = {
      teamId: player.teamId,
      goals: player.goals,
      assists: player.assists,
      cleanSheets: player.cleanSheets,
      yellowCards: player.yellowCards,
      redCards: player.redCards,
      minutesPlayed: player.minutesPlayed,
      ratingCount: player.matchRatingHistory.length,
    };
  });
  return snapshot;
};

const getPlayerDeltas = (
  before: Record<string, PlayerStatSnapshot>,
  players: Record<string, Player>,
  teams: Record<string, Team>
): PlayerMatchDelta[] => (
  Object.entries(players).flatMap(([playerId, player]) => {
    const prev = before[playerId];
    if (!prev) return [];

    const ratingDelta = player.matchRatingHistory.length - prev.ratingCount;
    const latestRating = ratingDelta > 0
      ? player.matchRatingHistory[player.matchRatingHistory.length - 1]
      : undefined;
    const delta: PlayerMatchDelta = {
      playerId,
      name: player.name,
      teamId: player.teamId,
      teamName: teams[player.teamId]?.name || 'Unknown',
      position: player.position,
      goals: player.goals - prev.goals,
      assists: player.assists - prev.assists,
      cleanSheets: player.cleanSheets - prev.cleanSheets,
      yellowCards: player.yellowCards - prev.yellowCards,
      redCards: player.redCards - prev.redCards,
      minutesPlayed: player.minutesPlayed - prev.minutesPlayed,
      ...(latestRating !== undefined ? { latestRating } : {}),
    };

    const changed = delta.goals || delta.assists || delta.cleanSheets ||
      delta.yellowCards || delta.redCards || delta.minutesPlayed || latestRating !== undefined;
    return changed ? [delta] : [];
  })
);

const snapshotTransfers = (
  players: Record<string, Player>,
  teams: Record<string, Team>
): TransferSnapshot => ({
  players: Object.fromEntries(Object.entries(players).map(([playerId, player]) => [
    playerId,
    {
      teamId: player.teamId,
      isTransferListed: player.isTransferListed,
      askingPrice: player.askingPrice,
    },
  ])),
  budgets: Object.fromEntries(Object.entries(teams).map(([teamId, team]) => [teamId, team.budget])),
});

const getTransferActivity = (
  before: TransferSnapshot,
  players: Record<string, Player>,
  teams: Record<string, Team>
): TransferActivity => {
  const moves: TransferActivity['moves'] = [];
  const newlyListed: TransferActivity['newlyListed'] = [];
  const unlisted: TransferActivity['unlisted'] = [];
  const budgetDeltas: TransferActivity['budgetDeltas'] = [];

  Object.entries(players).forEach(([playerId, player]) => {
    const prev = before.players[playerId];
    if (!prev) return;

    if (prev.teamId !== player.teamId) {
      moves.push({
        playerId,
        name: player.name,
        fromTeam: teams[prev.teamId]?.name || prev.teamId,
        toTeam: teams[player.teamId]?.name || player.teamId,
        fee: prev.askingPrice,
      });
      return;
    }

    if (!prev.isTransferListed && player.isTransferListed) {
      newlyListed.push({
        playerId,
        name: player.name,
        teamName: teams[player.teamId]?.name || player.teamId,
        askingPrice: player.askingPrice,
      });
    }

    if (prev.isTransferListed && !player.isTransferListed) {
      unlisted.push({
        playerId,
        name: player.name,
        teamName: teams[player.teamId]?.name || player.teamId,
      });
    }
  });

  Object.entries(teams).forEach(([teamId, team]) => {
    const beforeBudget = before.budgets[teamId] ?? team.budget;
    const delta = round(team.budget - beforeBudget, 2);
    if (delta !== 0) {
      budgetDeltas.push({
        teamId,
        teamName: team.name,
        delta,
        budget: round(team.budget, 2),
      });
    }
  });

  return { moves, newlyListed, unlisted, budgetDeltas };
};

const buildTable = (teams: Record<string, Team>): TableRow[] => (
  Object.values(teams)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const gdA = a.goalsFor - a.goalsAgainst;
      const gdB = b.goalsFor - b.goalsAgainst;
      if (gdB !== gdA) return gdB - gdA;
      return b.goalsFor - a.goalsFor;
    })
    .map((team, index) => ({
      position: index + 1,
      teamId: team.id,
      team: team.name,
      played: team.played,
      wins: team.wins,
      draws: team.draws,
      losses: team.losses,
      goalsFor: team.goalsFor,
      goalsAgainst: team.goalsAgainst,
      goalDifference: team.goalsFor - team.goalsAgainst,
      points: team.points,
      form: team.form,
      budget: round(team.budget, 2),
    }))
);

const toTacticsKey = (team: Team) => (
  [
    team.tactics.mentality,
    team.tactics.passingStyle,
    team.tactics.tempo,
    team.tactics.defensiveLine,
    team.tactics.pressing,
  ].join('|')
);

const snapshotTeamSetups = (teams: Record<string, Team>): Record<string, TeamSetupSnapshot> => (
  Object.fromEntries(Object.values(teams).map(team => [
    team.id,
    {
      teamId: team.id,
      teamName: team.name,
      formation: team.activeFormation,
      tacticsKey: toTacticsKey(team),
    },
  ]))
);

const getFormationBucket = (formation: string): 'back3' | 'back4' | 'back5' | 'other' => {
  const firstToken = Number((formation || '').split('-')[0]);
  if (firstToken === 3) return 'back3';
  if (firstToken === 4) return 'back4';
  if (firstToken === 5) return 'back5';
  return 'other';
};

const buildLeaderboards = (players: Record<string, Player>, teams: Record<string, Team>) => {
  const rows = Object.values(players).map(player => {
    const ratingCount = player.matchRatingHistory.length;
    const averageRating = ratingCount > 0
      ? round(player.matchRatingHistory.reduce((sum, rating) => sum + rating, 0) / ratingCount, 2)
      : null;

    return {
      playerId: player.id,
      name: player.name,
      team: teams[player.teamId]?.name || player.teamId,
      position: player.position,
      overallRating: player.overallRating,
      goals: player.goals,
      assists: player.assists,
      cleanSheets: player.cleanSheets,
      yellowCards: player.yellowCards,
      redCards: player.redCards,
      minutesPlayed: player.minutesPlayed,
      averageRating,
    };
  });

  return {
    goals: [...rows].sort((a, b) => b.goals - a.goals || b.overallRating - a.overallRating).slice(0, 20),
    assists: [...rows].sort((a, b) => b.assists - a.assists || b.overallRating - a.overallRating).slice(0, 20),
    cleanSheets: [...rows].sort((a, b) => b.cleanSheets - a.cleanSheets || b.overallRating - a.overallRating).slice(0, 20),
    yellowCards: [...rows].sort((a, b) => b.yellowCards - a.yellowCards || b.overallRating - a.overallRating).slice(0, 20),
    redCards: [...rows].sort((a, b) => b.redCards - a.redCards || b.overallRating - a.overallRating).slice(0, 20),
    averageRating: [...rows]
      .filter(row => row.averageRating !== null && row.minutesPlayed >= 900)
      .sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0))
      .slice(0, 20),
  };
};

const createMatchReport = (
  fixture: Fixture,
  fixtureId: string,
  week: number,
  preMatchPlayers: Record<string, PlayerStatSnapshot>,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  homeScore: number,
  awayScore: number,
  eventMessages: string[]
): MatchReport => {
  const playerDeltas = getPlayerDeltas(preMatchPlayers, players, teams);
  const totalGoals = homeScore + awayScore;
  const scorers = playerDeltas
    .filter(delta => delta.goals > 0)
    .map(delta => ({ playerId: delta.playerId, name: delta.name, teamName: delta.teamName, goals: delta.goals }));
  const assisters = playerDeltas
    .filter(delta => delta.assists > 0)
    .map(delta => ({ playerId: delta.playerId, name: delta.name, teamName: delta.teamName, assists: delta.assists }));
  const cards = playerDeltas
    .filter(delta => delta.yellowCards > 0 || delta.redCards > 0)
    .map(delta => ({
      playerId: delta.playerId,
      name: delta.name,
      teamName: delta.teamName,
      yellowCards: delta.yellowCards,
      redCards: delta.redCards,
    }));
  const auditFlags: string[] = [];

  if (scorers.reduce((sum, scorer) => sum + scorer.goals, 0) !== totalGoals) auditFlags.push('score_log_mismatch');
  if (totalGoals >= 7) auditFlags.push('high_goal_match');
  if (Math.abs(homeScore - awayScore) >= 5) auditFlags.push('big_margin');
  if (scorers.some(scorer => scorer.goals >= 4)) auditFlags.push('single_player_4_plus_goals');
  if (cards.some(card => card.yellowCards > 1)) auditFlags.push('multiple_yellows_same_player');
  const redCardCount = cards.reduce((sum, card) => sum + card.redCards, 0);
  const redCardEventCount = eventMessages.filter(event => /red card|sent off/i.test(event)).length;
  if (redCardCount > 0 && redCardEventCount === 0) auditFlags.push('red_card_log_mismatch');

  return {
    competitionId: getFixtureCompetitionId(fixture),
    roundName: fixture.roundName,
    fixtureId,
    week,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    homeTeam: teams[fixture.homeTeamId]?.name || fixture.homeTeamId,
    awayTeam: teams[fixture.awayTeamId]?.name || fixture.awayTeamId,
    homeScore,
    awayScore,
    totalGoals,
    playerDeltas,
    scorers,
    assisters,
    cards,
    eventMessages,
    auditFlags,
  };
};

const runTrackedSeason = (seed: number, seasonIndex: number) => {
  Math.random = createSeededRandom(seed);
  const data = initGameData();
  let state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures,
    currentWeek: 1,
    news: [] as string[],
  };

  const weeks: Array<{
    week: number;
    matches: MatchReport[];
    transfers: TransferActivity;
    table: TableRow[];
    news: string[];
    tacticalChanges: TacticalChange[];
  }> = [];
  const allMatches: MatchReport[] = [];
  const tacticalChangeCounts: Record<string, number> = Object.fromEntries(
    Object.keys(state.teams).map(teamId => [teamId, 0])
  );
  const tacticalChangeLog: TacticalChange[] = [];
  const formationUsage = { back3: 0, back4: 0, back5: 0, other: 0 };
  const seasonWeeks = getSeasonWeekLimit(state.fixtures);

  for (let week = 1; week <= seasonWeeks; week++) {
    const weekMatches: MatchReport[] = [];
    const weekStartSetups = snapshotTeamSetups(state.teams);
    Object.values(weekStartSetups).forEach(setup => {
      formationUsage[getFormationBucket(setup.formation)] += 1;
    });
    const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);

    for (const fixture of weekFixtures) {
      const preMatchPlayers = snapshotPlayers(state.players);
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;

      const matchReport = createMatchReport(
        fixture,
        fixture.id,
        week,
        preMatchPlayers,
        state.players,
        state.teams,
        result.fixture.homeScore ?? 0,
        result.fixture.awayScore ?? 0,
        result.events
      );
      weekMatches.push(matchReport);
      allMatches.push(matchReport);
    }

    const progression = computeWeeklyProgression(state.currentWeek, state.players, state.teams, state.fixtures, state.news);
    state.players = progression.players;
    state.teams = progression.teams;
    state.currentWeek = progression.currentWeek;
    state.news = progression.news;

    const transferBefore = snapshotTransfers(state.players, state.teams);
    const transfers = computeWeeklyTransfers(state.players, state.teams, null);
    state.players = transfers.players;
    state.teams = transfers.teams;
    const weekEndSetups = snapshotTeamSetups(state.teams);
    const weeklyTacticalChanges: TacticalChange[] = [];
    Object.keys(weekEndSetups).forEach(teamId => {
      const before = weekStartSetups[teamId];
      const after = weekEndSetups[teamId];
      if (!before || !after) return;
      if (before.tacticsKey === after.tacticsKey && before.formation === after.formation) return;
      tacticalChangeCounts[teamId] = (tacticalChangeCounts[teamId] || 0) + 1;
      const change: TacticalChange = {
        teamId,
        teamName: after.teamName,
        from: `${before.formation}::${before.tacticsKey}`,
        to: `${after.formation}::${after.tacticsKey}`,
      };
      weeklyTacticalChanges.push(change);
      tacticalChangeLog.push(change);
    });

    weeks.push({
      week,
      matches: weekMatches,
      transfers: getTransferActivity(transferBefore, state.players, state.teams),
      table: buildTable(state.teams),
      news: state.news.slice(0, 5),
      tacticalChanges: weeklyTacticalChanges,
    });
  }

  const finalTable = buildTable(state.teams);
  const leagueMatches = allMatches.filter(match => match.competitionId === COMPETITION_IDS.LEAGUE);
  const totalGoals = leagueMatches.reduce((sum, match) => sum + match.totalGoals, 0);
  const yellowCards = leagueMatches.reduce((sum, match) => (
    sum + match.cards.reduce((cardSum, card) => cardSum + card.yellowCards, 0)
  ), 0);
  const redCards = leagueMatches.reduce((sum, match) => (
    sum + match.cards.reduce((cardSum, card) => cardSum + card.redCards, 0)
  ), 0);
  const lowScoringTeams = finalTable.filter(team => team.goalsFor < 20);
  const highScoringTeams = finalTable.filter(team => team.goalsFor > 90);
  const totalTacticalChanges = Object.values(tacticalChangeCounts).reduce((sum, count) => sum + count, 0);
  const teamsWithNoTacticalChanges = Object.values(tacticalChangeCounts).filter(count => count === 0).length;
  const teamsWithFrequentTacticalChanges = Object.values(tacticalChangeCounts).filter(count => count >= 8).length;
  const tableIntegrityIssues = finalTable.filter(team => (
    team.wins + team.draws + team.losses !== team.played ||
    team.wins * 3 + team.draws !== team.points
  ));
  const seasonGoalCounts = countByPlayerId(leagueMatches.flatMap(match => (
    match.scorers.map(scorer => ({
      playerId: scorer.playerId,
      name: scorer.name,
      value: scorer.goals,
    }))
  )));
  const singlePlayerHauls = leagueMatches.flatMap(match => (
    countByPlayerId(match.scorers.map(scorer => ({
      playerId: scorer.playerId,
      name: scorer.name,
      value: scorer.goals,
    })))
      .filter(scorer => scorer.value >= 4)
      .map(scorer => ({
        week: match.week,
        fixtureId: match.fixtureId,
        playerId: scorer.playerId,
        player: scorer.name,
        goals: scorer.value,
      }))
  ));

  return {
    seasonIndex,
    seed,
    summary: {
      matches: leagueMatches.length,
      totalGoals,
      averageGoalsPerMatch: round(totalGoals / leagueMatches.length, 2),
      yellowCards,
      redCards,
      topSinglePlayerGoalCount: Math.max(0, ...seasonGoalCounts.map(scorer => scorer.value)),
      auditCounts: {
        scoreLogMismatches: leagueMatches.filter(match => match.auditFlags.includes('score_log_mismatch')).length,
        highGoalMatches: leagueMatches.filter(match => match.auditFlags.includes('high_goal_match')).length,
        bigMargins: leagueMatches.filter(match => match.auditFlags.includes('big_margin')).length,
        singlePlayerHauls: singlePlayerHauls.length,
        multiYellowMatches: leagueMatches.filter(match => match.auditFlags.includes('multiple_yellows_same_player')).length,
        redCardLogMismatches: leagueMatches.filter(match => match.auditFlags.includes('red_card_log_mismatch')).length,
        lowScoringTeams: lowScoringTeams.length,
        highScoringTeams: highScoringTeams.length,
        tableIntegrityIssues: tableIntegrityIssues.length,
      },
      transferCounts: {
        moves: weeks.reduce((sum, week) => sum + week.transfers.moves.length, 0),
        newlyListed: weeks.reduce((sum, week) => sum + week.transfers.newlyListed.length, 0),
        unlisted: weeks.reduce((sum, week) => sum + week.transfers.unlisted.length, 0),
      },
      tacticalCounts: {
        totalChanges: totalTacticalChanges,
        teamsWithNoChanges: teamsWithNoTacticalChanges,
        teamsWithFrequentChanges: teamsWithFrequentTacticalChanges,
        formationUsage,
      },
    },
    finalTable,
    leaderboards: buildLeaderboards(state.players, state.teams),
    auditDetails: {
      highGoalMatches: leagueMatches.filter(match => match.auditFlags.includes('high_goal_match')),
      bigMargins: leagueMatches.filter(match => match.auditFlags.includes('big_margin')),
      singlePlayerHauls,
      lowScoringTeams,
      highScoringTeams,
      tableIntegrityIssues,
      tacticalChangesByTeam: Object.entries(tacticalChangeCounts).map(([teamId, changes]) => ({
        teamId,
        teamName: state.teams[teamId]?.name || teamId,
        changes,
      })),
      tacticalChangeLog,
      highTacticalVolatilityTeams: Object.entries(tacticalChangeCounts)
        .filter(([, changes]) => changes >= 8)
        .map(([teamId, changes]) => ({ teamId, teamName: state.teams[teamId]?.name || teamId, changes })),
    },
    weeks,
  };
};

const runSeasonTracker = () => {
  const originalRandom = Math.random;
  const baseSeed = Number(process.env.SEASON_TRACKER_SEED ?? DEFAULT_TRACKER_SEED);
  const seasons = Math.max(1, Number(process.env.SEASON_TRACKER_SEASONS ?? 1));
  const outputPath = path.resolve(process.cwd(), process.env.SEASON_TRACKER_OUT ?? DEFAULT_OUTPUT_PATH);

  if (!Number.isFinite(baseSeed) || !Number.isFinite(seasons)) {
    throw new Error('SEASON_TRACKER_SEED and SEASON_TRACKER_SEASONS must be numeric.');
  }

  try {
    const seasonReports = Array.from({ length: seasons }, (_, index) => (
      runTrackedSeason(baseSeed + index, index + 1)
    ));
    const aggregateGoals = seasonReports.reduce((sum, season) => sum + season.summary.totalGoals, 0);
    const aggregateMatches = seasonReports.reduce((sum, season) => sum + season.summary.matches, 0);
    const report = {
      generatedAt: new Date().toISOString(),
      options: {
        baseSeed,
        seasons,
        outputPath,
      },
      engineConfig: { ...ENGINE_CONFIG },
      aggregate: {
        matches: aggregateMatches,
        totalGoals: aggregateGoals,
        averageGoalsPerMatch: round(aggregateGoals / aggregateMatches, 2),
        scoreLogMismatches: seasonReports.reduce((sum, season) => sum + season.summary.auditCounts.scoreLogMismatches, 0),
        multiYellowMatches: seasonReports.reduce((sum, season) => sum + season.summary.auditCounts.multiYellowMatches, 0),
        redCardLogMismatches: seasonReports.reduce((sum, season) => sum + season.summary.auditCounts.redCardLogMismatches, 0),
        lowScoringTeams: seasonReports.reduce((sum, season) => sum + season.summary.auditCounts.lowScoringTeams, 0),
        highScoringTeams: seasonReports.reduce((sum, season) => sum + season.summary.auditCounts.highScoringTeams, 0),
        tacticalChanges: seasonReports.reduce((sum, season) => sum + season.summary.tacticalCounts.totalChanges, 0),
        teamsWithNoTacticalChanges: seasonReports.reduce((sum, season) => sum + season.summary.tacticalCounts.teamsWithNoChanges, 0),
        teamsWithFrequentTacticalChanges: seasonReports.reduce((sum, season) => sum + season.summary.tacticalCounts.teamsWithFrequentChanges, 0),
        formationUsage: {
          back3: seasonReports.reduce((sum, season) => sum + season.summary.tacticalCounts.formationUsage.back3, 0),
          back4: seasonReports.reduce((sum, season) => sum + season.summary.tacticalCounts.formationUsage.back4, 0),
          back5: seasonReports.reduce((sum, season) => sum + season.summary.tacticalCounts.formationUsage.back5, 0),
          other: seasonReports.reduce((sum, season) => sum + season.summary.tacticalCounts.formationUsage.other, 0),
        },
      },
      seasons: seasonReports,
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Season tracking complete. Wrote ${outputPath}`);
    console.log(JSON.stringify(report.aggregate));
  } finally {
    Math.random = originalRandom;
  }
};

runSeasonTracker();

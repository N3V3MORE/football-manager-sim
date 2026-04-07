import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import * as fs from 'fs';

type StatSnapshot = {
  goals: number;
  yellowCards: number;
  redCards: number;
};

type MatchAudit = {
  week: number;
  label: string;
  homeScore: number;
  awayScore: number;
  scorers: string[];
  yellowCards: number;
  redCards: number;
  yellowedPlayers: string[];
  redCardLogMismatch: boolean;
};

const formatScore = (audit: MatchAudit) => audit.label;

const countByValue = (items: string[]) => {
  const counts = new Map<string, number>();
  items.forEach(item => counts.set(item, (counts.get(item) || 0) + 1));
  return counts;
};

const DEFAULT_ANALYSIS_SEED = 20260513;

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;

  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

async function runDetailedSim() {
  const originalRandom = Math.random;
  const seed = Number(process.env.SIM_SEED ?? DEFAULT_ANALYSIS_SEED);
  Math.random = createSeededRandom(Number.isFinite(seed) ? seed : DEFAULT_ANALYSIS_SEED);

  try {
    const data = initGameData();
    let state = {
      players: data.players,
      teams: data.teams,
      fixtures: data.fixtures,
      currentWeek: 1,
      news: [] as string[],
    };

  const outputLog: string[] = [];
  const matchAudits: MatchAudit[] = [];
  const scorerTotals = new Map<string, number>();

  outputLog.push('=== DETAILED SEASON SIMULATION START ===');
  outputLog.push(`Seed: ${seed}\n`);

  let totalGoals = 0;
  let teamCleanSheets = 0;
  let cleanSheetMatches = 0;
  let redCards = 0;
  let yellowCards = 0;
  let redCardLogMismatches = 0;

  for (let w = 1; w <= 38; w++) {
    outputLog.push(`\n--- WEEK ${w} ---`);
    const weekFixtures = Object.values(state.fixtures).filter(f => f.week === w);

    for (const fix of weekFixtures) {
      const home = state.teams[fix.homeTeamId];
      const away = state.teams[fix.awayTeamId];

      const preMatchPlayers: Record<string, StatSnapshot> = {};
      Object.entries(state.players).forEach(([id, player]) => {
        preMatchPlayers[id] = {
          goals: player.goals,
          yellowCards: player.yellowCards,
          redCards: player.redCards,
        };
      });

      const result = quickSimMatch(fix.id, state.players, state.teams, state.fixtures);
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fix.id] = result.fixture;

      const fixture = result.fixture;
      const homeScore = fixture.homeScore ?? 0;
      const awayScore = fixture.awayScore ?? 0;
      const matchGoals = homeScore + awayScore;
      totalGoals += matchGoals;

      if (homeScore === 0 || awayScore === 0) cleanSheetMatches++;
      if (awayScore === 0) teamCleanSheets++;
      if (homeScore === 0) teamCleanSheets++;

      const label = `${home.name} ${homeScore} - ${awayScore} ${away.name}`;
      outputLog.push(`[MATCH] ${label}`);

      const matchScorers: string[] = [];
      const matchCards: string[] = [];
      const yellowedPlayers: string[] = [];
      let matchYellowCards = 0;
      let matchRedCards = 0;

      Object.keys(state.players).forEach(pId => {
        const pNow = state.players[pId];
        const pBefore = preMatchPlayers[pId];
        if (!pBefore) return;

        const goalDelta = pNow.goals - pBefore.goals;
        for (let g = 0; g < goalDelta; g++) {
          matchScorers.push(pNow.name);
          scorerTotals.set(pNow.name, (scorerTotals.get(pNow.name) || 0) + 1);
          outputLog.push(`   [GOAL] ${pNow.name} (${pNow.position})`);
        }

        const yellowDelta = pNow.yellowCards - pBefore.yellowCards;
        for (let y = 0; y < yellowDelta; y++) {
          yellowCards++;
          matchYellowCards++;
          yellowedPlayers.push(pNow.name);
          matchCards.push(`   [YELLOW] ${pNow.name}`);
        }

        const redDelta = pNow.redCards - pBefore.redCards;
        for (let r = 0; r < redDelta; r++) {
          redCards++;
          matchRedCards++;
          matchCards.push(`   [RED] ${pNow.name}`);
        }
      });

      const redCardEventCount = result.events.filter(event => /red card|sent off/i.test(event)).length;
      const redCardLogMismatch = matchRedCards > 0 && redCardEventCount === 0;
      if (redCardLogMismatch) {
        redCardLogMismatches++;
        outputLog.push('   [AUDIT] Red card recorded in stats with no red-card event message.');
      }

      if (matchCards.length > 0) outputLog.push(matchCards.join('\n'));
      matchAudits.push({
        week: w,
        label,
        homeScore,
        awayScore,
        scorers: matchScorers,
        yellowCards: matchYellowCards,
        redCards: matchRedCards,
        yellowedPlayers,
        redCardLogMismatch,
      });
    }

    const prog = computeWeeklyProgression(state.currentWeek, state.players, state.teams, state.fixtures, state.news);
    state.players = prog.players;
    state.teams = prog.teams;
    state.currentWeek = prog.currentWeek;
    state.news = prog.news;

    const trans = computeWeeklyTransfers(state.players, state.teams, null);
    state.players = trans.players;
    state.teams = trans.teams;
  }

  outputLog.push('\n=== FINAL PREMIER LEAGUE TABLE ===');
  const sortedTeams = Object.values(state.teams).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdA = a.goalsFor - a.goalsAgainst;
    const gdB = b.goalsFor - b.goalsAgainst;
    if (gdB !== gdA) return gdB - gdA;
    return b.goalsFor - a.goalsFor;
  });

  outputLog.push('Pos | Team | Pld | W | D | L | GF | GA | GD | Pts');
  sortedTeams.forEach((t, i) => {
    const gd = t.goalsFor - t.goalsAgainst;
    outputLog.push(`${(i + 1).toString().padStart(2)} | ${t.name.padEnd(12)} | ${t.played} | ${t.wins} | ${t.draws} | ${t.losses} | ${t.goalsFor} | ${t.goalsAgainst} | ${gd.toString().padStart(2)} | ${t.points}`);
  });

  const avgGoals = totalGoals / matchAudits.length;
  outputLog.push('\n=== SEASON ANALYSIS ===');
  outputLog.push(`Matches: ${matchAudits.length}`);
  outputLog.push(`Total Goals: ${totalGoals}`);
  outputLog.push(`Average Goals per Match: ${avgGoals.toFixed(2)} (Target: 2.7 - 2.8)`);
  outputLog.push(`Team Clean Sheets: ${teamCleanSheets}`);
  outputLog.push(`Matches With At Least One Clean Sheet: ${cleanSheetMatches}`);
  outputLog.push(`Yellow Cards: ${yellowCards}`);
  outputLog.push(`Red Cards: ${redCards}`);

  const goalLogMismatches = matchAudits.filter(a => a.scorers.length !== a.homeScore + a.awayScore);
  const highGoalMatches = matchAudits.filter(a => a.homeScore + a.awayScore >= 7);
  const bigMargins = matchAudits.filter(a => Math.abs(a.homeScore - a.awayScore) >= 5);
  const multiYellowMatches = matchAudits.flatMap(a => (
    Array.from(countByValue(a.yellowedPlayers).entries())
      .filter(([, cards]) => cards > 1)
      .map(([player, cards]) => ({ match: a, player, cards }))
  ));
  const singlePlayerHauls = matchAudits.flatMap(a => (
    Array.from(countByValue(a.scorers).entries())
      .filter(([, goals]) => goals >= 4)
      .map(([player, goals]) => ({ match: a, player, goals }))
  ));
  const lowScoringTeams = sortedTeams.filter(t => t.goalsFor < 20);
  const highScoringTeams = sortedTeams.filter(t => t.goalsFor > 90);
  const tableIntegrityIssues = sortedTeams.filter(t => (
    t.wins + t.draws + t.losses !== t.played ||
    t.wins * 3 + t.draws !== t.points
  ));

  outputLog.push('\n=== MATCH AUDIT FLAGS ===');
  outputLog.push('Audit flags are outliers to inspect, not automatic bugs.');
  outputLog.push(`Score/log mismatches: ${goalLogMismatches.length}`);
  outputLog.push(`7+ goal matches: ${highGoalMatches.length}`);
  outputLog.push(`5+ goal margin matches: ${bigMargins.length}`);
  outputLog.push(`Single-player 4+ goal matches: ${singlePlayerHauls.length}`);
  outputLog.push(`Multiple yellows for same player: ${multiYellowMatches.length}`);
  outputLog.push(`Red-card log mismatches: ${redCardLogMismatches}`);
  outputLog.push(`Teams below 20 GF: ${lowScoringTeams.length}`);
  outputLog.push(`Teams above 90 GF: ${highScoringTeams.length}`);
  outputLog.push(`Table integrity issues: ${tableIntegrityIssues.length}`);

  if (highGoalMatches.length > 0) {
    outputLog.push('\nHigh-goal matches:');
    highGoalMatches.slice(0, 20).forEach(a => outputLog.push(`- W${a.week}: ${formatScore(a)}`));
  }

  if (singlePlayerHauls.length > 0) {
    outputLog.push('\nSingle-player 4+ goal matches:');
    singlePlayerHauls.slice(0, 20).forEach(({ match, player, goals }) => {
      outputLog.push(`- W${match.week}: ${player} scored ${goals} in ${formatScore(match)}`);
    });
  }

  if (multiYellowMatches.length > 0) {
    outputLog.push('\nMultiple yellow-card matches:');
    multiYellowMatches.slice(0, 20).forEach(({ match, player, cards }) => {
      outputLog.push(`- W${match.week}: ${player} received ${cards} yellows in ${formatScore(match)}`);
    });
  }

  if (lowScoringTeams.length > 0 || highScoringTeams.length > 0) {
    outputLog.push('\nTeam scoring outliers:');
    lowScoringTeams.forEach(t => outputLog.push(`- Low GF: ${t.name} scored ${t.goalsFor}`));
    highScoringTeams.forEach(t => outputLog.push(`- High GF: ${t.name} scored ${t.goalsFor}`));
  }

  const topScorers = Array.from(scorerTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  outputLog.push('\nTop scorers:');
  topScorers.forEach(([name, goals], index) => {
    outputLog.push(`${index + 1}. ${name}: ${goals}`);
  });

    fs.writeFileSync('./detailed_season_results.txt', outputLog.join('\n'), 'utf8');
    console.log('Detailed simulation complete. Analysis written to detailed_season_results.txt');
  } finally {
    Math.random = originalRandom;
  }
}

runDetailedSim().catch(error => {
  console.error(error);
  process.exit(1);
});

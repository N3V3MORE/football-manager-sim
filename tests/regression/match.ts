import { Player, applySharedPostMatchAccounting, applyWindowedCleanSheets, assert, createSeededRandom, didConcedeInWindow, initGameData, qualifiesForWindowedCleanSheet, quickSimMatch, readSource } from './shared';

export const checkCleanSheetWindows = () => {
  assert(!didConcedeInWindow([], 0, 90, 0), 'Empty conceded-minute list with 0 conceded should be clean');
  assert(!didConcedeInWindow([30], 0, 29, 1), 'Player subbed before concession should keep clean sheet');
  assert(didConcedeInWindow([30], 0, 90, 1), 'Player on pitch for concession should not keep clean sheet');
  assert(
    !qualifiesForWindowedCleanSheet([61], 0, 29, 1),
    'Short defensive cameo should not qualify for clean-sheet stat'
  );
  assert(
    qualifiesForWindowedCleanSheet([61], 0, 60, 1),
    'Starter subbed after 60 minutes before concession should qualify for clean-sheet stat'
  );

  const basePlayer = Object.values(initGameData().players).find(player => player.position === 'DEF');
  assert(basePlayer, 'Regression setup needs a defender fixture player');

  const shortSubbedBeforeGoal: Player = { ...basePlayer!, id: 'cs-short', cleanSheets: 0, position: 'DEF' };
  const qualifiedBeforeGoal: Player = { ...basePlayer!, id: 'cs-qualified', cleanSheets: 0, position: 'DEF' };
  const playedThroughGoal: Player = { ...basePlayer!, id: 'cs-through', cleanSheets: 0, position: 'DEF' };
  const updatedPlayers = {
    [shortSubbedBeforeGoal.id]: shortSubbedBeforeGoal,
    [qualifiedBeforeGoal.id]: qualifiedBeforeGoal,
    [playedThroughGoal.id]: playedThroughGoal,
  };

  applyWindowedCleanSheets(
    [shortSubbedBeforeGoal, qualifiedBeforeGoal, playedThroughGoal],
    new Set([shortSubbedBeforeGoal.id, qualifiedBeforeGoal.id, playedThroughGoal.id]),
    { [shortSubbedBeforeGoal.id]: 29, [qualifiedBeforeGoal.id]: 60, [playedThroughGoal.id]: 90 },
    [61],
    1,
    updatedPlayers
  );

  assert(updatedPlayers[shortSubbedBeforeGoal.id].cleanSheets === 0, 'Short subbed-off player should not get clean sheet');
  assert(updatedPlayers[qualifiedBeforeGoal.id].cleanSheets === 1, 'Qualified subbed-off player before concession should get clean sheet');
  assert(updatedPlayers[playedThroughGoal.id].cleanSheets === 0, 'Player on pitch for concession should not get clean sheet');
};

export const checkPossessionFlowIsNotStrictAlternation = () => {
  const matchEngine = readSource('src/core/matchEngine.ts');
  const liveMatchActions = readSource('src/store/liveMatchActions.ts');

  assert(
    !/const isHomeAttacking = \(\(i \+ \(firstAttackIsHome \? 0 : 1\)\) % 2\) === 0;/.test(matchEngine),
    'Quick sim should not use fixed home/away alternating attacks'
  );
  assert(
    !/const isHomeAttacking = \(\(possessionIndex \+ \(firstAttackIsHome \? 0 : 1\)\) % 2\) === 0;/.test(liveMatchActions),
    'Live sim should not use fixed home/away alternating attacks'
  );
};

export const checkBranchGuards = () => {
  const matchEngine = readSource('src/core/matchEngine.ts');
  const liveMatchActions = readSource('src/store/liveMatchActions.ts');

  assert(
    /if \(matchYellowCards\.has\(playerId\)\)[\s\S]*addPlayerStat\(updatedPlayers, playerId, 'yellowCards'\);[\s\S]*sendOffPlayer/.test(matchEngine),
    'Quick sim second-yellow branch must add yellow-card stat before red'
  );
  assert(
    /if \(matchYellowCards\.has\(playerId\)\)[\s\S]*addPlayerStat\(updatedPlayers, playerId, 'yellowCards'\);[\s\S]*sendOffPlayer/.test(liveMatchActions),
    'Live sim second-yellow branch must add yellow-card stat before red'
  );
  assert(
    /simulatePossession\([\s\S]*attShape,[\s\S]*defShape[\s\S]*\)/.test(matchEngine),
    'Quick sim must pass formation shape into simulatePossession'
  );
  assert(
    /buildLiveTeamOverlay\([\s\S]*buildCurrentMatchProfile\(liveHomeTeam, homeStarters[\s\S]*simulatePossession\([\s\S]*attShape,[\s\S]*defShape[\s\S]*\)/.test(liveMatchActions),
    'Live sim must build profiles from live formation overlays before simulatePossession'
  );
};

export const checkSanityMatchScores = () => {
  const data = initGameData();
  const state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures
  };
  
  let highScores = 0;
  const fixturesToPlay = Object.values(state.fixtures).slice(0, 100);
  
  fixturesToPlay.forEach(fixture => {
    const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
    state.players = result.players;
    state.teams = result.teams;
    state.fixtures[fixture.id] = result.fixture;
    
    const combinedGoals = result.fixture.homeScore! + result.fixture.awayScore!;
    assert(combinedGoals < 15, `Unrealistic scoreline detected: ${result.fixture.homeScore} - ${result.fixture.awayScore}`);
    
    if (combinedGoals >= 7) {
      highScores++;
    }
  });

  // Ensure high scoring games exist but are rare (less than 15%)
  assert(highScores <= 15, `Too many high scoring games (7+ goals) detected in 100 matches: ${highScores}%`);
};

export const checkQuickSimMatchSummaryIncludesStatsAndRatings = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for quick-sim match summary regression');
  const fixture = Object.values(data.fixtures).find(item => (
    item.week === 1 &&
    (item.homeTeamId === userTeam!.id || item.awayTeamId === userTeam!.id)
  ));
  assert(fixture, 'Expected user fixture for quick-sim match summary regression');

  const result = quickSimMatch(fixture!.id, data.players, data.teams, data.fixtures, userTeam!.id, {
    rng: { next: createSeededRandom(20260634) },
  });
  const summary = result.fixture.matchSummary!;

  assert(summary, 'Quick-sim user fixture should store a match summary');
  assert(summary.homeTeamStats.shots >= summary.homeTeamStats.shotsOnTarget, 'Home shots should be at least shots on target');
  assert(summary.awayTeamStats.shots >= summary.awayTeamStats.shotsOnTarget, 'Away shots should be at least shots on target');
  assert(summary.homeTeamStats.shotsOnTarget >= (result.fixture.homeScore || 0), 'Home SOT should cover home goals');
  assert(summary.awayTeamStats.shotsOnTarget >= (result.fixture.awayScore || 0), 'Away SOT should cover away goals');
  assert(summary.playerRows.length >= 22, 'Quick-sim match summary should include player rating rows for both teams');
  assert(summary.manOfTheMatchPlayerId, 'Quick-sim match summary should select a man of the match');

  const matchScreen = readSource('app/match.tsx');
  assert(
    /matchSummary/.test(matchScreen) && /Man of the Match/.test(matchScreen) && /Match Stats/.test(matchScreen),
    'Match result screen should render match summary stats, player ratings, and man of the match'
  );
  const hubScreen = readSource('app/(tabs)/index.tsx');
  assert(
    /playMatch\(myNextMatch\.id\)[\s\S]*router\.push\(\{ pathname: '\/match'/.test(hubScreen) &&
      !/playMatch\(myNextMatch\.id\);\s*advanceWeek\(\);/.test(hubScreen),
    'Hub Quick Sim should navigate to the match result screen instead of immediately advancing week'
  );
};

export const checkDisciplineRatesArePlausible = () => {
  const originalRandom = Math.random;
  Math.random = createSeededRandom(20260618);

  try {
    const data = initGameData();
    const state = {
      players: data.players,
      teams: data.teams,
      fixtures: data.fixtures,
    };
    const fixturesToPlay = Object.values(state.fixtures).slice(0, 900);
    let yellowCards = 0;
    let redCards = 0;
    let secondYellowReds = 0;

    fixturesToPlay.forEach(fixture => {
      const beforeCards = Object.values(state.players).reduce(
        (acc, player) => ({
          yellow: acc.yellow + player.yellowCards,
          red: acc.red + player.redCards,
        }),
        { yellow: 0, red: 0 }
      );
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
      secondYellowReds += result.events.filter(event => /second yellow/i.test(event)).length;
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;
      const afterCards = Object.values(state.players).reduce(
        (acc, player) => ({
          yellow: acc.yellow + player.yellowCards,
          red: acc.red + player.redCards,
        }),
        { yellow: 0, red: 0 }
      );
      yellowCards += afterCards.yellow - beforeCards.yellow;
      redCards += afterCards.red - beforeCards.red;
    });

    const yellowRate = yellowCards / fixturesToPlay.length;
    const redRate = redCards / fixturesToPlay.length;
    const secondYellowRate = secondYellowReds / fixturesToPlay.length;
    assert(
      yellowRate >= 1.8 && yellowRate <= 5.5,
      `Expected plausible yellow-card rate, got ${yellowRate.toFixed(2)} per match`
    );
    assert(
      redRate >= 0.04 && redRate <= 0.24,
      `Expected plausible red-card rate, got ${redRate.toFixed(2)} per match`
    );
    assert(
      secondYellowRate <= 0.14,
      `Expected second-yellow reds to be rare, got ${secondYellowRate.toFixed(2)} per match`
    );
  } finally {
    Math.random = originalRandom;
  }
};

export const checkMatchRatingsIncludeIndividualOutput = () => {
  const base = Object.values(initGameData().players).find(player => player.position === 'FWD');
  assert(base, 'Expected a forward for rating contribution regression');
  const scorer: Player = {
    ...base!,
    id: 'rating-scorer',
    name: 'Rating Scorer',
    goals: 1,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    matchRatingHistory: [],
  };
  const teammate: Player = {
    ...base!,
    id: 'rating-teammate',
    name: 'Rating Teammate',
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    matchRatingHistory: [],
  };
  const players = {
    [scorer.id]: scorer,
    [teammate.id]: teammate,
  };

  applySharedPostMatchAccounting({
    teamParticipants: [scorer, teammate],
    teamStarterIds: new Set([scorer.id, teammate.id]),
    minuteMap: { [scorer.id]: 90, [teammate.id]: 90 },
    concededGoalMinutes: [],
    concededGoalsTotal: 0,
    isWin: true,
    isDraw: false,
    teamTactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Normal',
      defensiveLine: 'Standard',
      pressing: 'Medium',
    },
    updatedPlayers: players,
    rng: { next: () => 0.5 },
    playerMatchContributions: {
      [scorer.id]: { goals: 1, assists: 0, yellowCards: 0, redCards: 0 },
    },
  });

  const scorerRating = players[scorer.id].matchRatingHistory.at(-1) || 0;
  const teammateRating = players[teammate.id].matchRatingHistory.at(-1) || 0;
  assert(scorerRating > teammateRating, 'A goalscorer should receive a better match rating than a similar teammate');
};

export const checkCleanSheetRatingsUsePlayerWindow = () => {
  const base = Object.values(initGameData().players).find(player => player.position === 'DEF');
  assert(base, 'Expected defender for clean-sheet rating regression');
  const defender: Player = {
    ...base!,
    id: 'rating-clean-window',
    cleanSheets: 0,
    matchRatingHistory: [],
  };
  const players = { [defender.id]: defender };

  applySharedPostMatchAccounting({
    teamParticipants: [defender],
    teamStarterIds: new Set([defender.id]),
    minuteMap: { [defender.id]: 60 },
    concededGoalMinutes: [80],
    concededGoalsTotal: 1,
    isWin: false,
    isDraw: true,
    teamTactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Normal',
      defensiveLine: 'Standard',
      pressing: 'Medium',
    },
    updatedPlayers: players,
    rng: { next: () => 0.5 },
  });

  assert(players[defender.id].cleanSheets === 1, 'Defender should receive windowed clean-sheet stat');
  assert(
    (players[defender.id].matchRatingHistory.at(-1) || 0) >= 7.0,
    'Windowed clean sheet should also contribute to defender match rating'
  );
};

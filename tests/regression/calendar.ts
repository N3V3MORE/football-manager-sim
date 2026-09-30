import { ENGINE_CONFIG } from '../../src/config/engineConfig';
import { buildVoidFixture } from '../../src/core/fixtureLifecycle';
import { getDecisiveTieScore } from '../../src/core/matchTieResolution';
import { playCurrentWeekFixtures } from '../../src/store/fixtureResolution';
import { FREE_AGENT_TEAM_ID, Player, advanceSeason, advanceWeekState, assert, computeMarketValue, computeWeeklyProgression, createFreeAgentTeam, createSeededRandom, finishLiveMatchState, getCompetitionPanelForTeam, getSeasonWeekLimit, getSquadPolicy, initGameData, processLiveMatchMinuteState, quickSimMatch, resolveCompetitionProgression, sanitizePersistedState, useGameStore } from './shared';

export const checkCompetitionPanelHandlesMissingTeam = () => {
  const data = initGameData('Arsenal');
  const team = Object.values(data.teams).find(item => item.name === 'Arsenal');
  assert(team, 'Expected Arsenal for competition panel missing-team regression');

  const panel = getCompetitionPanelForTeam(
    'fa-cup',
    {
      ...data.competitions,
      'fa-cup': {
        ...data.competitions['fa-cup'],
        championTeamId: team!.id,
      },
    },
    data.fixtures,
    {},
    team!.id,
    60
  );

  assert(panel.status === 'Winner', 'Missing-team panel should still report winner status');
  assert(panel.note === 'Your club lifted the trophy', 'Missing-team winner note should use fallback club name');
};

export const checkDivisionBootstrap = () => {
  const data = initGameData();
  const counts = Object.values(data.teams).reduce<Record<string, number>>((acc, team) => {
    acc[team.division] = (acc[team.division] || 0) + 1;
    return acc;
  }, {});

  assert(counts['Premier League'] === 20, `Expected 20 Premier League teams, got ${counts['Premier League'] || 0}`);
  assert(counts['Championship'] === 24, `Expected 24 Championship teams, got ${counts['Championship'] || 0}`);
  assert(counts['League One'] === 24, `Expected 24 League One teams, got ${counts['League One'] || 0}`);
  assert(counts['League Two'] === 24, `Expected 24 League Two teams, got ${counts['League Two'] || 0}`);
};

export const checkPromotionRelegation = () => {
  const data = initGameData();
  const teams = { ...data.teams };

  (['Premier League', 'Championship', 'League One', 'League Two'] as const).forEach(division => {
    const ordered = Object.values(teams)
      .filter(team => team.division === division)
      .sort((a, b) => a.name.localeCompare(b.name));

    ordered.forEach((team, index) => {
      teams[team.id] = {
        ...team,
        points: 1000 - index,
        goalsFor: 1000 - index,
        goalsAgainst: index,
        wins: 30 - index,
        draws: 0,
        losses: index,
        played: 38,
      };
    });
  });

  const championshipTable = Object.values(teams)
    .filter(team => team.division === 'Championship')
    .sort((a, b) => b.points - a.points || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name));
  const playoffWinner = championshipTable[5];
  const competitions = {
    ...data.competitions,
    championship: {
      ...data.competitions.championship,
      playoffWinnerTeamId: playoffWinner.id,
    },
  };

  const nextSeason = advanceSeason(data.players, teams, competitions, null, []);
  const nextCounts = Object.values(nextSeason.teams).reduce<Record<string, number>>((acc, team) => {
    acc[team.division] = (acc[team.division] || 0) + 1;
    return acc;
  }, {});

  assert(nextSeason.currentWeek === 1, 'Season rollover should reset the week to 1');
  assert(nextCounts['Premier League'] === 20, 'Premier League should keep 20 teams after promotion/relegation');
  assert(nextCounts['Championship'] === 24, 'Championship should keep 24 teams after promotion/relegation');
  assert(nextCounts['League One'] === 24, 'League One should keep 24 teams after promotion/relegation');
  assert(nextCounts['League Two'] === 24, 'League Two should keep 24 teams after promotion/relegation');

  const championshipAutoPromoted = championshipTable.slice(0, 2);
  const championshipThird = championshipTable[2];
  const premierBottom = Object.values(teams)
    .filter(team => team.division === 'Premier League')
    .sort((a, b) => a.points - b.points || a.goalsFor - b.goalsFor || a.name.localeCompare(b.name))
    .slice(0, 3);

  assert(championshipAutoPromoted.every(team => nextSeason.teams[team.id].division === 'Premier League'), 'Top two Championship teams should be promoted automatically');
  assert(nextSeason.teams[playoffWinner.id].division === 'Premier League', 'Championship play-off winner should be promoted');
  assert(nextSeason.teams[championshipThird.id].division === 'Championship', 'Third place should not be auto-promoted when play-offs produce a different winner');
  assert(premierBottom.every(team => nextSeason.teams[team.id].division === 'Championship'), 'Bottom Premier League teams should be relegated');
};

export const checkEflPlayoffsAreScheduledAfterRegularSeason = () => {
  const data = initGameData();
  const teams = { ...data.teams };
  const championshipTeams = Object.values(teams)
    .filter(team => team.division === 'Championship')
    .sort((a, b) => a.name.localeCompare(b.name));
  championshipTeams.forEach((team, index) => {
    teams[team.id] = {
      ...team,
      points: 1000 - index,
      goalsFor: 1000 - index,
      goalsAgainst: index,
      wins: 30 - index,
      draws: 0,
      losses: index,
      played: 46,
    };
  });
  const fixtures = Object.fromEntries(Object.entries(data.fixtures).map(([fixtureId, fixture]) => [
    fixtureId,
    fixture.competitionId === 'championship' && fixture.round === 'league'
      ? { ...fixture, isPlayed: true, homeScore: 1, awayScore: 0 }
      : fixture,
  ]));

  const progressed = resolveCompetitionProgression(fixtures, data.competitions, teams, { next: createSeededRandom(2026062804) });
  const semiFixtures = Object.values(progressed.fixtures).filter(fixture => (
    fixture.competitionId === 'championship' &&
    fixture.round === 'semi_final'
  ));
  const regularSeasonLimit = Math.max(
    ...Object.values(fixtures)
      .filter(fixture => fixture.competitionId === 'championship' && fixture.round === 'league')
      .map(fixture => fixture.week)
  );

  assert(semiFixtures.length === 4, `Championship play-offs should schedule four semi-final legs, got ${semiFixtures.length}`);
  assert(semiFixtures.every(fixture => !fixture.isKnockout), 'Play-off semi-final legs should not be standalone knockout fixtures');
  assert(semiFixtures.every(fixture => fixture.week > regularSeasonLimit), 'Play-off semi-finals should be after the regular season');
  assert(
    progressed.competitions.championship.rounds.some(round => round.key === 'semi_final' && round.fixtureIds.length === 4),
    'Championship competition state should include a semi-final play-off round'
  );
};

export const checkEflPlayoffSemiFinalsUseAggregateTiebreak = () => {
  const data = initGameData();
  const teams = { ...data.teams };
  const championshipTeams = Object.values(teams)
    .filter(team => team.division === 'Championship')
    .sort((a, b) => a.name.localeCompare(b.name));
  championshipTeams.forEach((team, index) => {
    teams[team.id] = {
      ...team,
      points: 1000 - index,
      goalsFor: 1000 - index,
      goalsAgainst: index,
      wins: 30 - index,
      draws: 0,
      losses: index,
      played: 46,
    };
  });
  const playedLeagueFixtures = Object.fromEntries(Object.entries(data.fixtures).map(([fixtureId, fixture]) => [
    fixtureId,
    fixture.competitionId === 'championship' && fixture.round === 'league'
      ? { ...fixture, isPlayed: true, homeScore: 1, awayScore: 0 }
      : fixture,
  ]));
  const withSemis = resolveCompetitionProgression(playedLeagueFixtures, data.competitions, teams, { next: createSeededRandom(2026062806) });
  const semiRound = withSemis.competitions.championship.rounds.find(round => round.key === 'semi_final');
  assert(semiRound?.fixtureIds.length === 4, 'Aggregate tiebreak regression needs four scheduled semi-final legs');
  const [firstAId, secondAId, firstBId, secondBId] = semiRound!.fixtureIds;
  const firstA = withSemis.fixtures[firstAId];
  const secondA = withSemis.fixtures[secondAId];
  const firstB = withSemis.fixtures[firstBId];
  const secondB = withSemis.fixtures[secondBId];
  assert(firstA && secondA && firstB && secondB, 'Aggregate tiebreak regression needs all semi-final fixtures');

  const playedSemiFixtures = {
    ...withSemis.fixtures,
    [firstAId]: { ...firstA, isPlayed: true, homeScore: 0, awayScore: 0 },
    [firstBId]: { ...firstB, isPlayed: true, homeScore: 0, awayScore: 1 },
    [secondBId]: { ...secondB, isPlayed: true, homeScore: 1, awayScore: 0 },
  };

  const originalChance = ENGINE_CONFIG.BIG_MOMENT_CHANCE;
  try {
    ENGINE_CONFIG.BIG_MOMENT_CHANCE = 0;
    const result = quickSimMatch(secondAId, data.players, teams, playedSemiFixtures, null, { rng: { next: () => 0.99 } });
    playedSemiFixtures[secondAId] = result.fixture;
    assert(result.fixture.penaltyShootout!.kicks.length > 0, 'Aggregate ties must record real penalty kicks after extra time');
    assert(result.fixture.scoreBreakdown?.extraTimeHomeScore === 0, 'Second-leg goals must remain separate from aggregate goals');
  } finally {
    ENGINE_CONFIG.BIG_MOMENT_CHANCE = originalChance;
  }

  const withFinal = resolveCompetitionProgression(playedSemiFixtures, withSemis.competitions, teams, { next: () => 0 });
  const finalRound = withFinal.competitions.championship.rounds.find(round => round.key === 'final');
  const finalFixture = finalRound?.fixtureIds[0] ? withFinal.fixtures[finalRound.fixtureIds[0]] : undefined;
  assert(finalFixture, 'Aggregate semi-final winners should schedule a play-off final');
  assert(
    withFinal.fixtures[secondAId].winnerTeamId === playedSemiFixtures[secondAId].penaltyShootout?.winnerTeamId,
    'Aggregate-tied semi-final should use aggregate tiebreak winner, not second-leg match winner'
  );
  assert(withFinal.fixtures[secondAId].resolution === 'penalties', 'Aggregate-tied semi-final should mark second leg as penalties');
  assert(
    finalFixture!.homeTeamId === playedSemiFixtures[secondAId].winnerTeamId || finalFixture!.awayTeamId === playedSemiFixtures[secondAId].winnerTeamId,
    'Play-off final should include aggregate tiebreak winner'
  );
  assert(
    finalFixture!.homeTeamId === secondB.homeTeamId || finalFixture!.awayTeamId === secondB.homeTeamId,
    'Play-off final should include clear aggregate winner from the other semi-final'
  );
  const voidSemi = resolveCompetitionProgression({ ...playedSemiFixtures,
    [firstAId]: { ...buildVoidFixture(firstA), isPlayed: false }, [secondAId]: secondA }, withSemis.competitions, teams);
  assert(voidSemi.fixtures[secondAId].resolution === 'void' && voidSemi.fixtures[secondAId].isPlayed, 'A void semifinal must cancel its remaining leg');
  const directVoid = quickSimMatch(secondAId, data.players, teams, { ...withSemis.fixtures, [firstAId]: buildVoidFixture(firstA) });
  assert(directVoid.fixture.resolution === 'void' && directVoid.fixture.isPlayed, 'Opening a legacy second leg directly must respect the void first leg');
  assert(voidSemi.competitions.championship.playoffWinnerTeamId === secondB.homeTeamId, 'A lone surviving semifinal winner must receive the final bye');
  const voidFinal = resolveCompetitionProgression({ ...withFinal.fixtures, [finalFixture!.id]: buildVoidFixture(finalFixture!) }, withFinal.competitions, teams);
  assert(!voidFinal.competitions.championship.playoffWinnerTeamId, 'A void playoff final must not award a promotion winner');
  assert(voidFinal.competitions.championship.rounds.find(round => round.key === 'final')!.completed, 'A void playoff final must finish the competition');
};

export const checkAggregateLiveAndVoidRecovery = () => {
  const snapshot = useGameStore.getState();
  const originalChance = ENGINE_CONFIG.BIG_MOMENT_CHANCE;
  try {
    useGameStore.getState().initializeGame('T1', 606);
    const initial = useGameStore.getState();
    const base = Object.values(initial.fixtures)[0];
    const first = { ...base, id: 'aggregate-first', week: 1, dateOrdinal: 0, round: 'semi_final' as const,
      isKnockout: false, isPlayed: true, homeScore: 2, awayScore: 0 };
    const second = { ...first, id: 'aggregate-second', week: 2, dateOrdinal: 7, isPlayed: false, homeScore: null, awayScore: null,
      homeTeamId: first.awayTeamId, awayTeamId: first.homeTeamId };
    let current: typeof initial = { ...initial, currentWeek: 2, userTeamId: null, fixtures: { [first.id]: first, [second.id]: second }, liveMatches: {} };
    ENGINE_CONFIG.BIG_MOMENT_CHANCE = 0;
    for (let minute = 1; minute <= 90; minute += 1) {
      current = { ...current, ...processLiveMatchMinuteState(current, second.id, minute, { next: () => 0.99 }).patch };
    }
    current.fixtures[second.id] = { ...current.fixtures[second.id], homeScore: 2, awayScore: 0 };
    const tied = getDecisiveTieScore(current.fixtures[second.id], current.fixtures);
    assert(tied.homeScore === 2 && tied.awayScore === 2, 'Reversed first-leg scores must be added in the correct orientation');
    const reloaded = { ...current, ...sanitizePersistedState(current) };
    const finished = finishLiveMatchState(reloaded, second.id, { next: () => 0.99 });
    const result = finished.fixtures![second.id];
    assert(result.resolution === 'penalties' && result.penaltyShootout!.kicks.length > 0, 'A 2-0 leg with tied aggregate must finish extra time and penalties after reload');
    assert(result.homeScore === 2 && result.awayScore === 0, 'Aggregate totals must never replace leg scores');
    const clear = getDecisiveTieScore({ ...second, homeScore: 0, awayScore: 0 }, { [first.id]: first, [second.id]: second });
    assert(clear.homeScore !== clear.awayScore, 'A drawn leg with a clear aggregate winner must not need extra time');
    const voidFixture = buildVoidFixture(base);
    const voidState = { ...initial, userTeamId: null, fixtures: { [base.id]: { ...voidFixture, isPlayed: false } }, liveMatches: {} };
    const next = advanceWeekState(voidState);
    assert(next.currentWeek === 2 && next.fixtures[base.id].isPlayed, 'An old unplayed void fixture must not block the week');
    assert(next.teams[base.homeTeamId].played === initial.teams[base.homeTeamId].played, 'Void matches must not affect league standings');
    const cup = initial.competitions['fa-cup'];
    const cupFixtures = Object.values(initial.fixtures).filter(fixture => fixture.competitionId === 'fa-cup').slice(0, 2);
    const [cupA, cupB] = cupFixtures;
    const semifinal = { ...cup.rounds[0], key: 'semi_final' as const, fixtureIds: cupFixtures.map(fixture => fixture.id),
      entrantTeamIds: cupFixtures.flatMap(fixture => [fixture.homeTeamId, fixture.awayTeamId]), byeTeamIds: [], winnerTeamIds: [], completed: false };
    const oldCupState = { ...initial, userTeamId: null, currentWeek: 40,
      fixtures: { [cupA.id]: { ...buildVoidFixture(cupA), isPlayed: false },
        [cupB.id]: { ...cupB, isPlayed: true, homeScore: 1, awayScore: 0, winnerTeamId: cupB.homeTeamId } },
      competitions: { [cup.id]: { ...cup, rounds: [semifinal], currentRound: 'semi_final' as const } }, liveMatches: {} };
    const recovered = playCurrentWeekFixtures({ ...oldCupState, ...sanitizePersistedState(oldCupState) });
    assert(recovered.competitions[cup.id].championTeamId === cupB.homeTeamId, 'Migration must finish an old void cup round even with no unplayed fixtures');
  } finally {
    ENGINE_CONFIG.BIG_MOMENT_CHANCE = originalChance;
    useGameStore.setState(snapshot);
  }
};

export const checkRolloverWaitsForPlayoffFinal = () => {
  const data = initGameData();
  const teams = { ...data.teams };
  const championshipTeams = Object.values(teams)
    .filter(team => team.division === 'Championship')
    .sort((a, b) => a.name.localeCompare(b.name));
  championshipTeams.forEach((team, index) => {
    teams[team.id] = {
      ...team,
      points: 1000 - index,
      goalsFor: 1000 - index,
      goalsAgainst: index,
      wins: 30 - index,
      draws: 0,
      losses: index,
      played: 46,
    };
  });
  const playedLeagueFixtures = Object.fromEntries(Object.entries(data.fixtures).map(([fixtureId, fixture]) => [
    fixtureId,
    fixture.competitionId === 'championship' && fixture.round === 'league'
      ? { ...fixture, isPlayed: true, homeScore: 1, awayScore: 0 }
      : fixture,
  ]));
  const progressed = resolveCompetitionProgression(playedLeagueFixtures, data.competitions, teams, { next: createSeededRandom(2026062805) });
  const seasonWeekLimit = getSeasonWeekLimit(progressed.fixtures, progressed.competitions);
  const oldSeasonWeekLimit = getSeasonWeekLimit(data.fixtures, data.competitions);

  assert(seasonWeekLimit > oldSeasonWeekLimit, 'Season week limit should extend while play-offs are unresolved');
};

export const checkSeasonEndProgressionUpdatesMatchAbility = () => {
  const data = initGameData();
  const seasonWeekLimit = getSeasonWeekLimit(data.fixtures, data.competitions);
  const player = Object.values(data.players).find(item => item.age <= 22 && item.position !== 'GK');
  assert(player, 'Expected a young outfield player for progression regression');

  const result = computeWeeklyProgression(
    seasonWeekLimit,
    {
      ...data.players,
      [player!.id]: {
        ...player!,
        overallRating: 70,
        marketValue: 1,
        age: 21,
        stats: {
          ...player!.stats,
          pace: 70,
          shooting: 70,
          passing: 70,
          dribbling: 70,
          defending: 70,
          physical: 70,
        },
      },
    },
    data.teams,
    data.fixtures,
    [],
    null,
    { next: () => 0 },
    seasonWeekLimit
  );
  const progressed = result.players[player!.id];

  const progressedStats = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical']
    .map(key => progressed.stats[key] || 0);
  assert(progressed.overallRating > 70, 'Young player should have a chance to gain overall at season end with seeded progression');
  assert(progressedStats.some(value => value > 70), 'Season-end progression should improve at least one detailed match stat');
  assert(progressedStats.some(value => value === 70), 'Season-end progression should not increase every attribute identically');
  assert(
    progressed.marketValue === computeMarketValue(progressed.overallRating, progressed.age),
    'Season-end progression should refresh market value from new rating and age'
  );
};

export const checkSeasonRolloverReplenishesMinimumSquadAndGoalkeepers = () => {
  const data = initGameData('Arsenal');
  const team = Object.values(data.teams).find(item => item.division === 'Premier League');
  assert(team, 'Expected a Premier League team for rollover replenishment regression');

  let keptOutfield = 0;
  const players = Object.fromEntries(Object.entries(data.players).map(([playerId, player]) => {
    if (player.teamId !== team!.id) return [playerId, player];
    if (player.position !== 'GK' && keptOutfield < 8) {
      keptOutfield += 1;
      return [playerId, { ...player, contractLeft: 2, isStarting: false, isSub: false }];
    }
    return [playerId, { ...player, teamId: FREE_AGENT_TEAM_ID, isStarting: false, isSub: false }];
  })) as Record<string, Player>;

  const rollover = advanceSeason(
    players,
    { ...data.teams, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() },
    data.competitions,
    null,
    [],
    undefined,
    { next: createSeededRandom(2026062201) }
  );
  for (const player of Object.values(rollover.players)) {
    if (players[player.id]) continue;
    assert(player.age >= 16 && player.age <= 18, 'Youth intake age must stay in its established range');
    assert(player.overallRating >= 40 && player.overallRating <= 55, 'Youth intake rating must stay in its established range');
  }
  const nextTeam = rollover.teams[team!.id];
  const policy = getSquadPolicy(nextTeam);
  const squad = Object.values(rollover.players).filter(player => player.teamId === nextTeam.id);
  const goalkeeperCount = squad.filter(player => player.position === 'GK').length;

  assert(
    squad.length >= policy.structuralMinimum,
    `Season rollover should replenish ${nextTeam.name} to structural minimum ${policy.structuralMinimum}, got ${squad.length}`
  );
  assert(
    goalkeeperCount >= policy.positionalMinimums.GK,
    `Season rollover should guarantee goalkeeper coverage ${policy.positionalMinimums.GK}, got ${goalkeeperCount}`
  );
};

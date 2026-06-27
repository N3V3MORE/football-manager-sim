import { FREE_AGENT_TEAM_ID, Player, advanceSeason, assert, computeMarketValue, computeWeeklyProgression, createFreeAgentTeam, createSeededRandom, getCompetitionPanelForTeam, getSeasonWeekLimit, getSquadPolicy, initGameData, readSource } from './shared';

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

  const nextSeason = advanceSeason(data.players, teams, data.competitions, null, []);
  const nextCounts = Object.values(nextSeason.teams).reduce<Record<string, number>>((acc, team) => {
    acc[team.division] = (acc[team.division] || 0) + 1;
    return acc;
  }, {});

  assert(nextSeason.currentWeek === 1, 'Season rollover should reset the week to 1');
  assert(nextCounts['Premier League'] === 20, 'Premier League should keep 20 teams after promotion/relegation');
  assert(nextCounts['Championship'] === 24, 'Championship should keep 24 teams after promotion/relegation');
  assert(nextCounts['League One'] === 24, 'League One should keep 24 teams after promotion/relegation');
  assert(nextCounts['League Two'] === 24, 'League Two should keep 24 teams after promotion/relegation');

  const championshipTop = Object.values(teams)
    .filter(team => team.division === 'Championship')
    .sort((a, b) => b.points - a.points || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name))
    .slice(0, 3);
  const premierBottom = Object.values(teams)
    .filter(team => team.division === 'Premier League')
    .sort((a, b) => a.points - b.points || a.goalsFor - b.goalsFor || a.name.localeCompare(b.name))
    .slice(0, 3);

  assert(championshipTop.every(team => nextSeason.teams[team.id].division === 'Premier League'), 'Top Championship teams should be promoted');
  assert(premierBottom.every(team => nextSeason.teams[team.id].division === 'Championship'), 'Bottom Premier League teams should be relegated');
};

export const checkSeasonReportsUseCompetitionLifecycleAndLeagueTables = () => {
  const detailedReport = readSource('scripts/detailed_season_sim.ts');
  const trackerReport = readSource('scripts/season_tracker.ts');

  [detailedReport, trackerReport].forEach((source, index) => {
    const label = index === 0 ? 'Detailed season report' : 'Season tracker';
    assert(
      /resolveCompetitionProgression/.test(source),
      `${label} should advance knockout competition rounds during season simulation`
    );
    assert(
      /getSeasonWeekLimit\(state\.fixtures,\s*state\.competitions\)/.test(source),
      `${label} should include competition state when calculating season length`
    );
  });

  assert(
    /Object\.values\(state\.teams\)\.filter\(.*division === 'Premier League'/.test(detailedReport.replace(/\s+/g, ' ')),
    'Detailed report should filter the Premier League table to Premier League clubs'
  );
  assert(
    /division:\s*team\.division/.test(trackerReport),
    'Season tracker table rows should include team division'
  );
  assert(
    /team\.played > 0[\s\S]*team\.goalsFor < 20/.test(trackerReport),
    'Season tracker low-scoring audit should ignore inactive external teams'
  );
  assert(
    /red card\|sent off\|straight red\|reaches for red/i.test(detailedReport),
    'Detailed report red-card audit should use the same event pattern as tracker and CI'
  );
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

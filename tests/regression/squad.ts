import { BASE_FORMATION_SLOTS, InboxMessage, Team, applyInboxActionState, applyTacticalAdaptation, assert, computeWeeklyProgression, computeWeeklyTransfers, createSeededRandom, getSeasonWeekLimit, getSlotsForFormation, initGameData, isPlayerUnavailable, markAsSubState, quickSimMatch, readSource, rebuildFormationMap, rebuildFormationSlotPlayers, toggleStartingState } from './shared';

export const checkFormationSlotLookupUsesExactFormation = () => {
  const threeFiveTwoSlots = getSlotsForFormation('3-5-2');
  assert(threeFiveTwoSlots === BASE_FORMATION_SLOTS['3-5-2'], '3-5-2 should use its exact slot definition');
  assert(threeFiveTwoSlots[0].length === 2, '3-5-2 should render two forwards');
  assert(threeFiveTwoSlots[2].length === 3, '3-5-2 should render a back three');
};

export const checkFormationMapRejectsWrongPositions = () => {
  const data = initGameData('Arsenal');
  const team = Object.values(data.teams).find(item => item.name === 'Arsenal');
  assert(team, 'Regression setup needs Arsenal');

  const squad = Object.values(data.players).filter(player => player.teamId === team!.id);
  const keeper = squad.find(player => player.position === 'GK');
  const striker = squad.find(player => player.subPosition === 'ST' || player.position === 'FWD');
  const midfielder = squad.find(player => player.position === 'MID');

  assert(keeper && striker && midfielder, 'Regression setup needs keeper, striker, and midfielder');

  const starters = squad.map(player => ({
    ...player,
    isStarting: [keeper!.id, striker!.id, midfielder!.id].includes(player.id) || player.overallRating >= 80,
  })).filter(player => player.isStarting).slice(0, 11);

  const slots = getSlotsForFormation('4-3-3');
  const corruptedMap = {
    '0-0': keeper!.id,
    '0-2': midfielder!.id,
    '3-0': striker!.id,
  };

  const rebuiltSlots = rebuildFormationSlotPlayers(slots, starters, corruptedMap);
  const rebuiltMap = rebuildFormationMap(slots, starters, corruptedMap);

  assert(rebuiltSlots[3][0]?.position === 'GK', 'Corrupted formation map should put a keeper back in GK');
  assert(rebuiltSlots[0].every(player => player?.position !== 'GK'), 'Corrupted formation map should not leave a keeper in the forward line');
  assert(rebuiltMap['3-0'] === rebuiltSlots[3][0]?.id, 'Rebuilt map should persist the corrected GK slot');
};

export const checkSeededFormationDiversity = () => {
    const originalRandom = Math.random;
    Math.random = createSeededRandom(20260513);
    const formationUsage = { back3: 0, back4: 0, back5: 0 };

  try {
    for (let season = 1; season <= 5; season++) {
      const data = initGameData();
      let state = {
        players: data.players,
        teams: data.teams,
        fixtures: data.fixtures,
        currentWeek: 1,
        news: [] as string[],
      };
      const seasonWeeks = getSeasonWeekLimit(state.fixtures);

      for (let week = 1; week <= seasonWeeks; week++) {
        const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
        weekFixtures.forEach(fixture => {
          const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
          state.players = result.players;
          state.teams = result.teams;
          state.fixtures[fixture.id] = result.fixture;
        });

        const progression = computeWeeklyProgression(state.currentWeek, state.players, state.teams, state.fixtures, state.news);
        state.players = progression.players;
        state.teams = progression.teams;
        state.currentWeek = progression.currentWeek;
        state.news = progression.news;

        const transfers = computeWeeklyTransfers(state.players, state.teams, null, undefined, state.currentWeek);
        state.players = transfers.players;
        state.teams = transfers.teams;

        Object.values(state.teams).forEach(team => {
          if (team.activeFormation.startsWith('3')) formationUsage.back3++;
          else if (team.activeFormation.startsWith('5')) formationUsage.back5++;
          else formationUsage.back4++;
        });
      }
    }
  } finally {
    Math.random = originalRandom;
  }

  assert(formationUsage.back3 > 0, `Seeded formation run produced no back-3 usage: ${JSON.stringify(formationUsage)}`);
  assert(formationUsage.back5 > 0, `Seeded formation run produced no back-5 usage: ${JSON.stringify(formationUsage)}`);
  console.log(`Formation usage: ${JSON.stringify(formationUsage)}`);
};

export const checkRosterSizeConstraints = () => {
  const data = initGameData();
  const teams = Object.values(data.teams);
  
  teams.forEach(team => {
    const squad = Object.values(data.players).filter(p => p.teamId === team.id);
    assert(squad.length >= 14, `Team ${team.name} has critically small squad (${squad.length})`);
    assert(squad.length <= 40, `Team ${team.name} has unrealistically large squad (${squad.length})`);
  });
};

export const checkUnavailableBenchPlayersCanBeRemoved = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  assert(userTeam, 'Expected a user team for unavailable bench regression');

  const benchPlayer = Object.values(data.players)
    .find(player => player.teamId === userTeam!.id && !player.isStarting);
  assert(benchPlayer, 'Expected a bench candidate for unavailable bench regression');

  const players = {
    ...data.players,
    [benchPlayer!.id]: {
      ...benchPlayer!,
      isStarting: false,
      isSub: true,
      injuryWeeks: 2,
    },
  };
  const result = markAsSubState(
    {
      players,
      teams: data.teams,
      userTeamId: userTeam!.id,
    },
    benchPlayer!.id
  );
  const resultingPlayers = result.players || players;
  const squadScreen = readSource('app/(tabs)/squad.tsx');

  assert(
    !resultingPlayers[benchPlayer!.id].isSub,
    'Unavailable bench player should be removable from the bench'
  );
  assert(
    /const bench\s*=\s*sortedSquad\.filter\([^)]*!isPlayerUnavailable/.test(squadScreen),
    'Squad screen bench capacity should ignore unavailable substitutes'
  );
};

export const checkRecoveredSelectedBenchDoesNotOverflow = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for recovered bench overflow regression');
  const squad = Object.values(data.players)
    .filter(player => player.teamId === userTeam!.id)
    .sort((a, b) => b.overallRating - a.overallRating);
  assert(squad.length >= 19, 'Recovered bench overflow regression needs a deep squad');

  const starterIds = new Set(squad.slice(0, 11).map(player => player.id));
  const activeSubIds = new Set(squad.slice(11, 18).map(player => player.id));
  const recoveringSub = squad[18];
  const seededPlayers = Object.fromEntries(
    Object.entries(data.players).map(([id, player]) => {
      if (starterIds.has(id)) return [id, { ...player, isStarting: true, isSub: false }];
      if (activeSubIds.has(id)) return [id, { ...player, isStarting: false, isSub: true }];
      if (id === recoveringSub.id) {
        return [id, {
          ...player,
          isStarting: false,
          isSub: true,
          injuryWeeks: 1,
          injuryType: 'ankle knock',
          injuryAppliedWeek: 3,
        }];
      }
      return [id, { ...player, isStarting: false, isSub: false }];
    })
  );

  const progressed = computeWeeklyProgression(
    5,
    seededPlayers,
    data.teams,
    data.fixtures,
    [],
    userTeam!.id,
    { next: createSeededRandom(20260618) }
  );
  const activeSubs = Object.values(progressed.players).filter(player => (
    player.teamId === userTeam!.id &&
    player.isSub &&
    !isPlayerUnavailable(player)
  ));

  assert(activeSubs.length <= 7, `Recovered selected substitute should not create ${activeSubs.length} active bench players`);
};

export const checkLineupActionsPreserveBenchLimit = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for bench limit regression');
  const teamPlayers = Object.values(data.players)
    .filter(player => player.teamId === userTeam!.id)
    .sort((a, b) => b.overallRating - a.overallRating);
  const starter = teamPlayers[0];
  assert(starter, 'Expected a starter candidate for bench limit regression');

  const players = Object.fromEntries(Object.entries(data.players).map(([playerId, player]) => {
    if (player.teamId !== userTeam!.id) return [playerId, player];
    const index = teamPlayers.findIndex(candidate => candidate.id === player.id);
    return [
      playerId,
      {
        ...player,
        isStarting: player.id === starter.id,
        isSub: index > 0 && index <= 7,
      },
    ];
  }));

  const result = toggleStartingState(
    { players, teams: data.teams, userTeamId: userTeam!.id },
    starter.id
  );
  const nextPlayers = 'players' in result && result.players ? result.players : players;
  const activeBench = Object.values(nextPlayers)
    .filter(player => player.teamId === userTeam!.id && player.isSub && !player.isStarting);

  assert(activeBench.length <= 7, 'Removing a starter should not create an eighth active substitute');
};

export const checkLineupInboxActionFiltersStaleFormationMap = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for stale lineup action regression');
  const teamPlayers = Object.values(data.players)
    .filter(player => player.teamId === userTeam!.id)
    .sort((a, b) => b.overallRating - a.overallRating);
  const startingIds = teamPlayers.slice(0, 11).map(player => player.id);
  const staleStarterId = startingIds[0];
  const subIds = teamPlayers.slice(11, 18).map(player => player.id);
  assert(staleStarterId && subIds.length > 0, 'Expected enough players for stale lineup action regression');

  const message: InboxMessage = {
    id: 'stale-lineup-action',
    week: 1,
    source: 'assistant',
    category: 'lineup_suggestion',
    title: 'Lineup',
    body: 'Lineup',
    isRead: false,
    teamId: userTeam!.id,
    action: {
      type: 'apply_lineup',
      payload: {
        teamId: userTeam!.id,
        startingIds,
        subIds,
        formationMap: Object.fromEntries(startingIds.map((playerId, index) => [`0-${index}`, playerId])),
      },
    },
  };

  const players = {
    ...data.players,
    [staleStarterId]: {
      ...data.players[staleStarterId],
      injuryWeeks: 2,
    },
  };
  const result = applyInboxActionState({
    currentWeek: 1,
    userTeamId: userTeam!.id,
    teams: data.teams,
    players,
    fixtures: data.fixtures,
    competitions: data.competitions,
    inboxMessages: [message],
    boardObjectives: [],
    careerRecord: {
      seasonsManaged: 0,
      totalWins: 0,
      totalDraws: 0,
      totalLosses: 0,
      totalGoalsFor: 0,
      totalGoalsAgainst: 0,
      reputation: 50,
      trophies: [],
      seasonHistory: [],
      consecutiveLowApprovalWeeks: 0,
    },
  }, message.id);
  const nextTeams = result.teams || data.teams;
  const nextPlayers = result.players || players;
  const mappedIds = Object.values(nextTeams[userTeam!.id].formationMap || {});

  assert(!nextPlayers[staleStarterId].isStarting, 'Unavailable stale lineup player should not be selected');
  assert(!mappedIds.includes(staleStarterId), 'Applied lineup map should not retain unavailable non-starters');
};

export const checkTacticalAdaptationRunsOncePerPlayedCount = () => {
  const data = initGameData();
  const team = Object.values(data.teams).find(candidate => candidate.id !== 'T1') as Team | undefined;
  assert(team, 'Expected an AI team for tactical adaptation regression');

  const teams: Record<string, Team> = {
    ...data.teams,
    [team!.id]: {
      ...team!,
      played: 4,
      goalsFor: 8,
      goalsAgainst: 12,
      losses: 4,
      form: ['L', 'L', 'L', 'L'],
      tactics: {
        mentality: 'Attacking',
        passingStyle: 'Direct',
        tempo: 'Fast',
        defensiveLine: 'High',
        pressing: 'High',
      },
      manager: {
        ...team!.manager,
        pressureScore: 75,
      },
    },
  };

  const rng = { next: () => 0 };
  applyTacticalAdaptation(data.players, teams, new Set(), rng);
  const afterFirst = JSON.stringify({
    formation: teams[team!.id].activeFormation,
    tactics: teams[team!.id].tactics,
  });
  applyTacticalAdaptation(data.players, teams, new Set(), rng);
  const afterSecond = JSON.stringify({
    formation: teams[team!.id].activeFormation,
    tactics: teams[team!.id].tactics,
  });

  assert(afterSecond === afterFirst, 'Tactical adaptation should not repeatedly react to the same played count');
};

export const checkTacticalAdaptationIgnoresUnavailablePlayers = () => {
  const data = initGameData();
  const team = Object.values(data.teams).find(candidate => (
    candidate.division === 'Premier League' &&
    candidate.id !== 'T1'
  ));
  assert(team, 'Expected AI team for unavailable tactical adaptation regression');
  const defenders = Object.values(data.players)
    .filter(player => player.teamId === team!.id && player.position === 'DEF')
    .sort((a, b) => b.overallRating - a.overallRating);
  assert(defenders.length >= 3, 'Expected defenders for unavailable tactical adaptation regression');

  const injuredIds = defenders.slice(0, Math.max(1, defenders.length - 2)).map(player => player.id);
  const players = {
    ...data.players,
    ...Object.fromEntries(injuredIds.map(playerId => [
      playerId,
      {
        ...data.players[playerId],
        injuryWeeks: 4,
      },
    ])),
  };
  const teams: Record<string, Team> = {
    ...data.teams,
    [team!.id]: {
      ...team!,
      played: 4,
      goalsFor: 7,
      goalsAgainst: 10,
      losses: 3,
      form: ['L', 'L', 'D', 'L'],
      activeFormation: '4-3-3',
      tactics: {
        mentality: 'Attacking',
        passingStyle: 'Direct',
        tempo: 'Fast',
        defensiveLine: 'High',
        pressing: 'High',
      },
      manager: {
        ...team!.manager,
        pressureScore: 80,
        preferredFormations: ['5-2-3'],
      },
    },
  };

  applyTacticalAdaptation(players, teams, new Set(), { next: () => 0 });
  assert(
    !teams[team!.id].activeFormation.startsWith('5'),
    'AI formation adaptation should not choose a back five using injured defensive depth'
  );
};

import { Team, applyInboxActionState, applySackingRisk, assert, buildBoardObjectives, buildBoardProfile, computeWeeklyProgression, createSeededRandom, hasReachedCompetitionRound, initGameData, readSource, useGameStore } from './shared';

export const checkUserTeamProgressionDoesNotAdaptFormation = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams)[0];
  const beforeFormation = userTeam.activeFormation;
  const beforeTactics = JSON.stringify(userTeam.tactics);

  const teams = {
    ...data.teams,
    [userTeam.id]: {
      ...userTeam,
      played: 6,
      goalsFor: 4,
      goalsAgainst: 14,
      form: ['L', 'L', 'L', 'L', 'L'],
    },
  };

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const result = computeWeeklyProgression(1, data.players, teams, data.fixtures, [], userTeam.id);
    assert(
      result.teams[userTeam.id].activeFormation === beforeFormation,
      'User team formation should not be changed by AI tactical adaptation'
    );
    assert(
      JSON.stringify(result.teams[userTeam.id].tactics) === beforeTactics,
      'User team tactics should not be changed by AI tactical adaptation'
    );
  } finally {
    Math.random = originalRandom;
  }
};

export const checkManagerProfilesLoaded = () => {
  const data = initGameData();
  const teams = Object.values(data.teams);
  assert(teams.every(team => team.manager && team.manager.teamId === team.id), 'Every team should have a linked manager profile');
  assert(teams.every(team => team.manager.preferredFormations.length > 0), 'Every manager should have at least one preferred formation');
};

export const checkActiveCupRoundCountsAsReached = () => {
  const data = initGameData();
  const teamId = Object.keys(data.teams)[0];
  const activeQuarterFinal = {
    id: 'fa-cup' as const,
    name: 'FA Cup',
    shortName: 'FA',
    type: 'domestic_cup' as const,
    season: 1,
    entrantTeamIds: [teamId],
    rounds: [{
      key: 'quarter_final' as const,
      label: 'Quarter-final',
      week: 10,
      entrantTeamIds: [teamId],
      fixtureIds: [],
      byeTeamIds: [],
      winnerTeamIds: [],
      completed: false,
    }],
    currentRound: 'quarter_final' as const,
    eliminatedTeamIds: [],
  };

  assert(
    hasReachedCompetitionRound(activeQuarterFinal, teamId, 'quarter_final'),
    'Active participation in a cup round should count as reaching that board objective round'
  );
};

export const checkBoardObjectiveIdsAreStable = () => {
  const profile = buildBoardProfile('A', 'Premier League');
  const first = buildBoardObjectives('A', 'Premier League', profile, ['fa-cup', 'europe']);
  const second = buildBoardObjectives('A', 'Premier League', profile, ['fa-cup', 'europe']);

  assert(
    JSON.stringify(first.map(objective => objective.id)) === JSON.stringify(second.map(objective => objective.id)),
    'Board objective IDs should be stable for the same team class, division, profile, and active competitions'
  );
};

export const checkMidSeasonSackingTerminatesImmediately = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for mid-season sacking regression');
  const userManager = {
    name: userTeam!.manager.name,
    nationality: userTeam!.manager.nationality,
    dateOfBirth: userTeam!.manager.dateOfBirth,
    preferredFormations: userTeam!.manager.preferredFormations,
    tacticalIdentity: userTeam!.manager.tacticalIdentity,
    transferIdentity: userTeam!.manager.transferIdentity,
  };
  const terminalTeam: Team = {
    ...userTeam!,
    boardApproval: 5,
    played: 8,
    wins: 1,
    draws: 1,
    losses: 6,
    goalsFor: 5,
    goalsAgainst: 18,
    manager: {
      ...userTeam!.manager,
      pressureScore: 95,
      replacementRisk: 95,
      jobSecurity: 5,
    },
  };
  const offerTeam = Object.values(data.teams).find(team => team.id !== terminalTeam.id && team.division === terminalTeam.division);
  assert(offerTeam, 'Expected a same-division job-offer candidate for mid-season sacking regression');
  const unstableOfferTeam: Team = {
    ...offerTeam!,
    boardApproval: 20,
    manager: {
      ...offerTeam!.manager,
      jobSecurity: 5,
      replacementRisk: 95,
      pressureScore: 90,
    },
  };
  const state = {
    currentWeek: 9,
    userTeamId: terminalTeam.id,
    teams: { ...data.teams, [terminalTeam.id]: terminalTeam, [unstableOfferTeam.id]: unstableOfferTeam },
    players: data.players,
    fixtures: data.fixtures,
    competitions: data.competitions,
    news: [],
    inboxMessages: [],
    boardObjectives: buildBoardObjectives(terminalTeam.clubClass || 'C', terminalTeam.division, terminalTeam.boardProfile, []),
    boardReviewAppliedWeek: 9,
    transfersAppliedWeek: 9,
    liveMatches: {},
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
      consecutiveLowApprovalWeeks: 3,
      userManager,
    },
  };

  const result = applySackingRisk(state as any, 9);
  const nextState = result.nextState as any;
  assert(nextState.userTeamId === null, 'Terminal mid-season sacking should immediately leave the user between jobs');
  assert(nextState.boardObjectives.length === 0, 'Terminal mid-season sacking should clear old club objectives');
  assert(nextState.careerRecord.seasonHistory.at(-1)?.outcome === 'sacked', 'Terminal mid-season sacking should record a sacked career summary');
  assert(nextState.teams[terminalTeam.id].manager.name !== userManager.name, 'Terminal mid-season sacking should replace the old club manager');
  assert(
    result.sackMessages.some(message => /sacked|dismissed/i.test(`${message.title} ${message.body}`)),
    'Terminal mid-season sacking should emit a dismissal message'
  );
  assert(
    nextState.inboxMessages.some((message: any) => message.category === 'career_job_offer' && /immediately/i.test(message.body)),
    'Terminal mid-season sacking should create job offers that can be accepted immediately'
  );
  const immediateOffer = nextState.inboxMessages.find((message: any) => message.category === 'career_job_offer' && message.action?.type === 'accept_job_offer');
  assert(immediateOffer, 'Terminal mid-season sacking should include an actionable job offer');
  const acceptedState = applyInboxActionState(nextState, immediateOffer.id) as any;
  assert(acceptedState.userTeamId === immediateOffer.teamId, 'Mid-season job offer should be accepted immediately from between jobs');
  assert(acceptedState.boardObjectives.length > 0, 'Accepting a mid-season job offer should build objectives for the new club');
};

export const checkNonTerminalSackingWarningDoesNotDismiss = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  assert(userTeam, 'Expected Arsenal for non-terminal sacking warning regression');
  const warningTeam: Team = {
    ...userTeam!,
    boardApproval: 10,
    manager: {
      ...userTeam!.manager,
      pressureScore: 85,
      replacementRisk: 85,
    },
  };
  const state = {
    currentWeek: 6,
    userTeamId: warningTeam.id,
    teams: { ...data.teams, [warningTeam.id]: warningTeam },
    players: data.players,
    fixtures: data.fixtures,
    competitions: data.competitions,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    boardReviewAppliedWeek: 6,
    transfersAppliedWeek: 6,
    liveMatches: {},
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
      consecutiveLowApprovalWeeks: 2,
    },
  };

  const result = applySackingRisk(state as any, 6);
  const nextState = result.nextState as any;
  assert(nextState.userTeamId === warningTeam.id, 'Non-terminal sacking risk should keep the current job');
  assert(nextState.careerRecord.seasonHistory.length === 0, 'Non-terminal sacking risk should not write a sacked summary');
  assert(result.sackMessages.length > 0, 'Non-terminal sacking risk should still warn the manager');
};

export const checkSeasonEndSackingUsesSharedThreshold = () => {
  const seasonRollover = readSource('src/store/seasonRollover.ts');
  assert(
    /getSackingImminentWeek/.test(seasonRollover) && !/consecutiveLowApprovalWeeks\s*>=\s*4/.test(seasonRollover),
    'Season-end sacking should use the shared patience-sensitive threshold helper'
  );
};

export const checkUiContractsMatchEngineState = () => {
  const statsScreen = readSource('app/stats.tsx');
  const hubScreen = readSource('app/(tabs)/index.tsx');
  const settingsScreen = readSource('app/(tabs)/settings.tsx');
  const calendarScreen = readSource('app/calendar.tsx');
  const calendarRow = readSource('components/calendar/calendar-fixture-row.tsx');
  const calendarUtils = readSource('src/utils/calendar.ts');
  const squadScreen = readSource('app/(tabs)/squad.tsx');
  const matchScreen = readSource('app/match.tsx');
  const contractWatchCard = readSource('components/settings/contract-watch-card.tsx');

  assert(
    /All-Competition Stats/.test(statsScreen) && /playerTeam\.division === userTeam\.division/.test(statsScreen),
    'Stats screen should honestly label aggregate all-competition leaderboards for the managed division'
  );
  assert(
    /position === 'GK'/.test(hubScreen),
    'Hub clean-sheet leader should use the same goalkeeper filter as Golden Glove stats'
  );
  assert(
    /filter\(team => !team\.isExternal\)/.test(settingsScreen),
    'Team picker should exclude external Continental clubs'
  );
  assert(
    !/2024\/25 Fixtures/.test(calendarScreen) && /formatSeasonLabel/.test(calendarScreen),
    'Calendar screen should render a dynamic season label'
  );
  assert(
    /formatSeasonLabel/.test(calendarUtils),
    'Calendar utilities should expose a season label helper'
  );
  assert(
    /competitionLabel/.test(calendarScreen) && /roundLabel/.test(calendarScreen) && /competitionLabel/.test(calendarRow),
    'Calendar rows should show competition context for cup and Europe fixtures'
  );
  assert(
    /Tap a reserve to designate as sub/.test(squadScreen),
    'Squad empty-bench instruction should match the tap interaction'
  );
  assert(
    !/Conserves 25%|35% more energy|astronomical energy drain|30% better tackling/.test(squadScreen)
      && !/Conserves 25%|35% more energy|astronomical energy drain|30% better tackling/.test(matchScreen),
    'Tactics copy should not claim effects the engine does not implement'
  );
  assert(
    /buildSquadPlan\(team,\s*allPlayers\)/.test(contractWatchCard) && /allPlayers=\{players\}/.test(settingsScreen),
    'Contract Watch should derive contract advice from the same buildSquadPlan inputs as the engine'
  );
  assert(
    /decisionByPlayerId\[b\.id\]\?\.priority/.test(contractWatchCard),
    'Contract Watch should sort expiring deals by squad-plan decision priority'
  );
};

export const checkInitialGameSetupCanBeSeeded = () => {
  const summarize = () => {
    const data = initGameData(undefined, { next: createSeededRandom(20260618) });
    return JSON.stringify({
      teamTactics: Object.values(data.teams).slice(0, 8).map(team => [team.id, team.tactics]),
      players: Object.values(data.players).slice(0, 30).map(player => [
        player.id,
        player.morale,
        player.energy,
        player.contractLeft,
      ]),
    });
  };

  assert(
    summarize() === summarize(),
    'Initial game data should be reproducible when supplied the same seeded random generator'
  );
};

export const checkStoreInitializesSelectedTeamDefaults = () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    useGameStore.getState().initializeGame('T1');
    const state = useGameStore.getState();
    const userTeam = state.teams[state.userTeamId!];
    const userPlayers = Object.values(state.players).filter(player => player.teamId === userTeam.id);

    assert(userTeam.name === 'Arsenal', 'Regression assumes T1 is Arsenal');
    assert(
      JSON.stringify(userTeam.tactics) === JSON.stringify({
        mentality: 'Balanced',
        passingStyle: 'Mixed',
        tempo: 'Normal',
        defensiveLine: 'Standard',
        pressing: 'Medium',
      }),
      'Selected team should receive user-team default tactics during initialization'
    );
    assert(
      userPlayers.every(player => !player.isStarting && !player.isSub),
      'Selected team players should stay unselected until the user picks a lineup'
    );
  } finally {
    Math.random = originalRandom;
  }
};

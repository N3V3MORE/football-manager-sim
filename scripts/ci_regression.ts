import assert from 'node:assert/strict';
import { generateBoardObjectives, initGameData } from '../src/utils/initGame';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { createSeededRandomGenerator } from '../src/core/random';
import {
  applySharedPostMatchAccounting,
  applyWindowedCleanSheets,
  didConcedeInWindow,
  qualifiesForWindowedCleanSheet,
} from '../src/core/postMatchAccounting';
import { applySubstitutions } from '../src/core/substitutionEngine';
import { advanceSeason } from '../src/core/seasonTransition';
import { Player } from '../src/models/types';
import { isPlayerUnavailable } from '../src/core/playerStatusUtils';
import { evaluateBoardObjectives } from '../src/store/boardObjectiveHelpers';
import { useGameStore } from '../src/store/gameStore';
import {
  generateAssistantWeekMessages,
  generatePostMatchReportMessage,
  generateSystemInboxMessages,
  MAX_INBOX_MESSAGES,
  mergeInboxMessages,
} from '../src/store/inboxHelpers';

const runInvariantChecks = () => {
  assert.equal(didConcedeInWindow([], 0, 90, 0), false);
  assert.equal(didConcedeInWindow([30], 0, 29, 1), false);
  assert.equal(didConcedeInWindow([30], 0, 90, 1), true);
  assert.equal(qualifiesForWindowedCleanSheet([61], 0, 29, 1), false);
  assert.equal(qualifiesForWindowedCleanSheet([61], 0, 60, 1), true);

  const basePlayer = Object.values(initGameData().players).find(player => player.position === 'DEF');
  assert.ok(basePlayer, 'Expected at least one defender');
  const shortCameo: Player = { ...basePlayer!, id: 'short-cameo', cleanSheets: 0, position: 'DEF' };
  const qualifiedCameo: Player = { ...basePlayer!, id: 'qualified-cameo', cleanSheets: 0, position: 'DEF' };
  const fullWindow: Player = { ...basePlayer!, id: 'full-window', cleanSheets: 0, position: 'DEF' };
  const players = {
    [shortCameo.id]: shortCameo,
    [qualifiedCameo.id]: qualifiedCameo,
    [fullWindow.id]: fullWindow,
  };
  applyWindowedCleanSheets(
    [shortCameo, qualifiedCameo, fullWindow],
    new Set([shortCameo.id, qualifiedCameo.id, fullWindow.id]),
    { [shortCameo.id]: 29, [qualifiedCameo.id]: 60, [fullWindow.id]: 90 },
    [61],
    1,
    players
  );
  assert.equal(players[shortCameo.id].cleanSheets, 0);
  assert.equal(players[qualifiedCameo.id].cleanSheets, 1);
  assert.equal(players[fullWindow.id].cleanSheets, 0);

  const energyProbe: Player = {
    ...basePlayer!,
    id: 'energy-probe',
    position: 'DEF',
    energy: 80,
    minutesPlayed: 0,
    matchRatingHistory: [],
  };
  const energyPlayers = { [energyProbe.id]: energyProbe };
  applySharedPostMatchAccounting({
    teamParticipants: [energyProbe],
    teamStarterIds: new Set([energyProbe.id]),
    minuteMap: { [energyProbe.id]: 90 },
    concededGoalMinutes: [],
    concededGoalsTotal: 1,
    isWin: false,
    isDraw: false,
    teamTactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Normal',
      defensiveLine: 'Standard',
      pressing: 'Medium',
    },
    updatedPlayers: energyPlayers,
    rng: { next: () => 0.5 },
    applyEnergyDrain: false,
  });
  assert.equal(energyPlayers[energyProbe.id].energy, 80);
  assert.equal(energyPlayers[energyProbe.id].minutesPlayed, 90);

  const starterA: Player = {
    ...basePlayer!,
    id: 'starter-a',
    name: 'Starter A',
    position: 'MID',
    subPosition: 'CM',
    altPositions: ['CM'],
    energy: 5,
    overallRating: 65,
  };
  const starterB: Player = {
    ...basePlayer!,
    id: 'starter-b',
    name: 'Starter B',
    position: 'MID',
    subPosition: 'CM',
    altPositions: ['CM'],
    energy: 95,
    overallRating: 75,
  };
  const benchC: Player = {
    ...basePlayer!,
    id: 'bench-c',
    name: 'Bench C',
    position: 'MID',
    subPosition: 'CM',
    altPositions: ['CM'],
    energy: 0,
    overallRating: 90,
  };
  const benchD: Player = {
    ...basePlayer!,
    id: 'bench-d',
    name: 'Bench D',
    position: 'MID',
    subPosition: 'CM',
    altPositions: ['CM'],
    energy: 10,
    overallRating: 30,
  };
  let starters = [starterA, starterB];
  let bench = [benchC, benchD];
  const minuteMap = {
    [starterA.id]: 90,
    [starterB.id]: 90,
    [benchC.id]: 0,
    [benchD.id]: 0,
  };
  const baseTeam = Object.values(initGameData().teams)[0];
  const mockTeam = {
    ...baseTeam,
    tactics: {
      mentality: 'Balanced' as const,
      passingStyle: 'Mixed' as const,
      tempo: 'Normal' as const,
      defensiveLine: 'Standard' as const,
      pressing: 'Medium' as const,
    },
  };
  applySubstitutions(starters, bench, new Set(), minuteMap, mockTeam, 0, 1, { next: () => 0.1 }, {
    maxSubsOverride: 1,
    minuteOverride: 60,
    onSubstitution: (off, on) => {
      starters = starters.map(player => player.id === off.id ? on : player);
      bench = bench.filter(player => player.id !== on.id);
    },
  });
  applySubstitutions(starters, bench, new Set(), minuteMap, mockTeam, 0, 1, { next: () => 0.1 }, {
    maxSubsOverride: 1,
    minuteOverride: 70,
    onSubstitution: (off, on) => {
      starters = starters.map(player => player.id === off.id ? on : player);
      bench = bench.filter(player => player.id !== on.id);
    },
  });
  assert.equal(minuteMap[starterA.id], 60);
  assert.equal(minuteMap[starterB.id], 90);
  assert.equal(minuteMap[benchC.id], 10);
  assert.equal(minuteMap[benchD.id], 20);

  const seededData = initGameData();
  const [leadTeam, otherTeam] = Object.values(seededData.teams).slice(0, 2);
  const syntheticTeams = {
    ...seededData.teams,
    [leadTeam.id]: {
      ...leadTeam,
      points: 99,
      wins: 38,
      played: 38,
      transferSpend: 999,
      goalsFor: 120,
      goalsAgainst: 20,
    },
    [otherTeam.id]: {
      ...otherTeam,
      points: 40,
      wins: 10,
      played: 38,
      transferSpend: 0,
      goalsFor: 50,
      goalsAgainst: 60,
    },
  };
  const syntheticObjectives = generateBoardObjectives('A', leadTeam.name, leadTeam.division);
  const inSeasonObjectiveResult = evaluateBoardObjectives(
    syntheticObjectives,
    syntheticTeams[leadTeam.id],
    syntheticTeams,
    { isSeasonComplete: false }
  );
  assert.equal(inSeasonObjectiveResult.updatedObjectives.find(objective => objective.type === 'position')?.met, false);

  const objectiveResult = evaluateBoardObjectives(
    syntheticObjectives,
    syntheticTeams[leadTeam.id],
    syntheticTeams,
    { isSeasonComplete: true }
  );
  assert.equal(objectiveResult.updatedObjectives.find(objective => objective.type === 'position')?.met, true);
  assert.equal(objectiveResult.updatedObjectives.find(objective => objective.type === 'wins')?.met, true);
  assert.equal(objectiveResult.updatedObjectives.find(objective => objective.type === 'spend')?.met, true);

  const repeatedPositionCheck = evaluateBoardObjectives(
    objectiveResult.updatedObjectives,
    syntheticTeams[leadTeam.id],
    syntheticTeams,
    { isSeasonComplete: true }
  );
  assert.equal(repeatedPositionCheck.approvalChange, 0);

  useGameStore.getState().initializeGame('T1');
  const liveState = useGameStore.getState();
  const liveFixture = Object.values(liveState.fixtures)
    .find(item => item.homeTeamId !== 'T1' && item.awayTeamId !== 'T1');
  assert.ok(liveFixture, 'Expected a non-user fixture for live energy regression check');

  const homeStarterIds = Object.values(liveState.players)
    .filter(player => player.teamId === liveFixture!.homeTeamId && player.isStarting)
    .map(player => player.id);
  const awayStarterIds = Object.values(liveState.players)
    .filter(player => player.teamId === liveFixture!.awayTeamId && player.isStarting)
    .map(player => player.id);
  const trackedStarterIds = [...homeStarterIds.slice(0, 2), ...awayStarterIds.slice(0, 2)];
  assert.equal(trackedStarterIds.length, 4, 'Expected tracked live-match starters for energy regression check');

  const playersWithKnownEnergy = Object.fromEntries(
    Object.entries(liveState.players).map(([id, player]) => [
      id,
      trackedStarterIds.includes(id) ? { ...player, energy: 50 } : player,
    ])
  );
  useGameStore.setState(prev => ({
    players: playersWithKnownEnergy,
    fixtures: {
      ...prev.fixtures,
      [liveFixture!.id]: {
        ...liveFixture!,
        homeScore: 0,
        awayScore: 0,
        isPlayed: false,
      },
    },
    liveMatches: {
      ...(prev.liveMatches || {}),
      [liveFixture!.id]: {
        initialized: true,
        yellowCardPlayerIds: [],
        sentOffPlayerIds: [],
        sentOffMinutes: {},
        homeGoalMinutes: [],
        awayGoalMinutes: [],
        homeStarterIds,
        awayStarterIds,
      },
    },
  }));
  useGameStore.getState().finishLiveMatch(liveFixture!.id);
  trackedStarterIds.forEach(playerId => {
    assert.equal(
      useGameStore.getState().players[playerId].energy,
      50,
      `finishLiveMatch should not apply a second energy drain to ${playerId}`
    );
  });

  const seededPlayers = Object.fromEntries(
    Object.entries(initGameData().players).map(([id, player]) => [
      id,
      {
        ...player,
        minutesPlayed: 500,
        goals: 8,
        assists: 6,
        cleanSheets: 4,
        yellowCards: 3,
        redCards: 1,
        matchRatingHistory: [6.5, 7.3, 8.0],
        matchesSuspended: 2,
      },
    ])
  );
  const nextSeason = advanceSeason(seededPlayers, initGameData().teams, null, []);
  Object.values(nextSeason.players).forEach(player => {
    assert.equal(player.matchesSuspended, 0);
    assert.equal(player.minutesPlayed, 0);
    assert.equal(player.goals, 0);
    assert.equal(player.assists, 0);
    assert.equal(player.cleanSheets, 0);
    assert.equal(player.yellowCards, 0);
    assert.equal(player.redCards, 0);
    assert.deepEqual(player.matchRatingHistory, []);
  });

  const migrate = useGameStore.persist.getOptions().migrate as (
    persistedState: unknown,
    version: number
  ) => { inboxMessages: { body: string }[] };
  const migratedState = migrate({
    currentWeek: 7,
    userTeamId: 'T1',
    teams: {},
    players: {},
    fixtures: {},
    news: ['Legacy headline'],
    boardObjectives: [],
  }, 3);
  assert.equal(migratedState.inboxMessages.length, 1);
  assert.equal(migratedState.inboxMessages[0].body, 'Legacy headline');

  const duplicateMessages = generateSystemInboxMessages(3, ['Duplicate headline']);
  const mergedMessages = mergeInboxMessages([], [...duplicateMessages, ...duplicateMessages]);
  assert.equal(mergedMessages.length, 1);
  const cappedMessages = mergeInboxMessages(
    [],
    Array.from({ length: MAX_INBOX_MESSAGES + 12 }, (_, index) => generateSystemInboxMessages(index + 1, [`Message ${index}`])[0]).reverse()
  );
  assert.equal(cappedMessages.length, MAX_INBOX_MESSAGES);
  assert.equal(cappedMessages[0].body, `Message ${MAX_INBOX_MESSAGES + 11}`);

  useGameStore.getState().initializeGame('T1');
  const inboxState = useGameStore.getState();
  const lineupSuggestion = inboxState.inboxMessages.find(message => message.category === 'lineup_suggestion');
  assert.ok(lineupSuggestion?.action && lineupSuggestion.action.type === 'apply_lineup', 'Expected an actionable lineup suggestion in the inbox');
  const regeneratedAssistantMessages = generateAssistantWeekMessages({
    currentWeek: inboxState.currentWeek,
    userTeamId: inboxState.userTeamId,
    teams: inboxState.teams,
    players: inboxState.players,
    fixtures: inboxState.fixtures,
  });
  const dedupedAssistantMessages = mergeInboxMessages(inboxState.inboxMessages, regeneratedAssistantMessages);
  assert.equal(dedupedAssistantMessages.length, inboxState.inboxMessages.length);

  useGameStore.getState().applyInboxAction(lineupSuggestion!.id);
  const lineupAppliedState = useGameStore.getState();
  const lineupPayload = lineupSuggestion!.action.payload;
  const actualStarters = Object.values(lineupAppliedState.players)
    .filter(player => player.teamId === lineupPayload.teamId && player.isStarting)
    .map(player => player.id)
    .sort();
  assert.deepEqual(actualStarters, [...lineupPayload.startingIds].sort());
  assert.deepEqual(lineupAppliedState.teams[lineupPayload.teamId].formationMap, lineupPayload.formationMap);
  assert.equal(lineupAppliedState.inboxMessages.find(message => message.id === lineupSuggestion!.id)?.isRead, true);
  assert.equal(lineupAppliedState.inboxMessages.find(message => message.id === lineupSuggestion!.id)?.action, undefined);

  const tacticData = initGameData();
  const controlledUserTeamId = Object.keys(tacticData.teams)[0];
  const tacticFixture = Object.values(tacticData.fixtures).find(fixture => (
    fixture.week === 1 &&
    (fixture.homeTeamId === controlledUserTeamId || fixture.awayTeamId === controlledUserTeamId)
  ));
  assert.ok(tacticFixture, 'Expected an opening-week fixture for inbox action checks');
  const controlledOpponentId = tacticFixture!.homeTeamId === controlledUserTeamId
    ? tacticFixture!.awayTeamId
    : tacticFixture!.homeTeamId;
  const controlledUserPlayers = Object.values(tacticData.players)
    .filter(player => player.teamId === controlledUserTeamId)
    .sort((a, b) => b.overallRating - a.overallRating);
  const controlledOpponentPlayers = Object.values(tacticData.players)
    .filter(player => player.teamId === controlledOpponentId)
    .sort((a, b) => b.overallRating - a.overallRating);
  const listedDefender = controlledOpponentPlayers.find(player => player.position === 'DEF');
  assert.ok(listedDefender, 'Expected a listed defender target for transfer advice checks');
  controlledUserPlayers.forEach((player, index) => {
    tacticData.players[player.id] = {
      ...player,
      overallRating: player.position === 'DEF' ? 54 : (index < 11 ? 62 : 56),
      energy: 40,
      isStarting: index < 11,
      isSub: index >= 11 && index < 18,
    };
  });
  controlledOpponentPlayers.forEach((player, index) => {
    tacticData.players[player.id] = {
      ...player,
      overallRating: index < 11 ? 88 : 80,
      isStarting: index < 11,
      isSub: index >= 11 && index < 18,
      isTransferListed: player.id === listedDefender!.id,
      askingPrice: player.id === listedDefender!.id ? 5 : player.askingPrice,
    };
  });
  tacticData.teams[controlledUserTeamId] = {
    ...tacticData.teams[controlledUserTeamId],
    tactics: {
      mentality: 'Balanced',
      passingStyle: 'Mixed',
      tempo: 'Fast',
      defensiveLine: 'High',
      pressing: 'High',
    },
  };
  const trackedTransferTargetId = listedDefender!.id;
  const trackedBudget = tacticData.teams[controlledUserTeamId].budget;
  const controlledMessages = generateAssistantWeekMessages({
    currentWeek: 1,
    userTeamId: controlledUserTeamId,
    teams: tacticData.teams,
    players: tacticData.players,
    fixtures: tacticData.fixtures,
  });
  const tacticSuggestion = controlledMessages.find(message => message.category === 'tactic_suggestion');
  assert.ok(tacticSuggestion?.action && tacticSuggestion.action.type === 'apply_tactics', 'Expected an actionable tactic suggestion');
  const transferSuggestion = controlledMessages.find(message => message.category === 'transfer_advice');
  assert.ok(transferSuggestion, 'Expected a transfer advice inbox item');
  assert.equal(transferSuggestion?.action, undefined);
  assert.equal(tacticData.teams[controlledUserTeamId].budget, trackedBudget);
  assert.equal(tacticData.players[trackedTransferTargetId].teamId, controlledOpponentId);

  useGameStore.setState({
    currentWeek: 1,
    userTeamId: controlledUserTeamId,
    teams: tacticData.teams,
    players: tacticData.players,
    fixtures: tacticData.fixtures,
    news: [],
    inboxMessages: [tacticSuggestion!],
    boardObjectives: [],
    liveMatches: {},
  });
  useGameStore.getState().applyInboxAction(tacticSuggestion!.id);
  const tacticAppliedTeam = useGameStore.getState().teams[controlledUserTeamId];
  Object.entries(tacticSuggestion!.action.payload.tactics).forEach(([key, value]) => {
    assert.equal(tacticAppliedTeam.tactics[key as keyof typeof tacticAppliedTeam.tactics], value);
  });

  const availabilityData = initGameData();
  const availabilityUserTeamId = Object.keys(availabilityData.teams)[0];
  const unavailablePlayer = Object.values(availabilityData.players)
    .find(player => player.teamId === availabilityUserTeamId && !player.isStarting && !player.isSub);
  assert.ok(unavailablePlayer, 'Expected a reserve player for availability checks');
  useGameStore.setState({
    currentWeek: 1,
    userTeamId: availabilityUserTeamId,
    teams: availabilityData.teams,
    players: {
      ...availabilityData.players,
      [unavailablePlayer!.id]: {
        ...unavailablePlayer!,
        injuryWeeks: 2,
        injuryType: 'hamstring strain',
      },
    },
    fixtures: availabilityData.fixtures,
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    liveMatches: {},
  });
  useGameStore.getState().toggleStarting(unavailablePlayer!.id);
  useGameStore.getState().markAsSub(unavailablePlayer!.id);
  const blockedSelectionPlayer = useGameStore.getState().players[unavailablePlayer!.id];
  assert.equal(blockedSelectionPlayer.isStarting, false);
  assert.equal(blockedSelectionPlayer.isSub, false);
  assert.equal(isPlayerUnavailable(blockedSelectionPlayer), true);

  const recoveryProbe = Object.values(availabilityData.players).find(player => player.teamId === availabilityUserTeamId);
  assert.ok(recoveryProbe, 'Expected a player for weekly recovery checks');
  const progressionWithRecovery = computeWeeklyProgression(
    5,
    {
      ...availabilityData.players,
      [recoveryProbe!.id]: {
        ...recoveryProbe!,
        injuryWeeks: 1,
        injuryType: 'ankle knock',
      },
    },
    availabilityData.teams,
    availabilityData.fixtures,
    [],
    availabilityUserTeamId,
    createSeededRandomGenerator(20260412)
  );
  assert.equal(progressionWithRecovery.players[recoveryProbe!.id].injuryWeeks, 0);
  assert.equal(progressionWithRecovery.players[recoveryProbe!.id].injuryType, undefined);
  const recoveryMessages = generateAssistantWeekMessages({
    currentWeek: progressionWithRecovery.currentWeek,
    userTeamId: availabilityUserTeamId,
    teams: progressionWithRecovery.teams,
    players: progressionWithRecovery.players,
    fixtures: availabilityData.fixtures,
    previousPlayers: {
      ...availabilityData.players,
      [recoveryProbe!.id]: {
        ...recoveryProbe!,
        injuryWeeks: 1,
        injuryType: 'ankle knock',
      },
    },
  });
  assert.ok(recoveryMessages.some(message => message.category === 'injury_update' && message.playerId === recoveryProbe!.id));

  const contractData = initGameData();
  const contractUserTeamId = Object.keys(contractData.teams)[0];
  const contractPlayer = Object.values(contractData.players)
    .find(player => player.teamId === contractUserTeamId && player.overallRating >= 78);
  assert.ok(contractPlayer, 'Expected a quality player for contract checks');
  const contractMessages = generateAssistantWeekMessages({
    currentWeek: 36,
    userTeamId: contractUserTeamId,
    teams: contractData.teams,
    players: {
      ...contractData.players,
      [contractPlayer!.id]: {
        ...contractPlayer!,
        contractLeft: 1,
      },
    },
    fixtures: contractData.fixtures,
    previousPlayers: contractData.players,
  });
  const contractWarning = contractMessages.find(message => message.category === 'contract_warning' && message.playerId === contractPlayer!.id);
  assert.ok(contractWarning?.action && contractWarning.action.type === 'renew_contract', 'Expected a contract renewal suggestion');
  useGameStore.setState({
    currentWeek: 36,
    userTeamId: contractUserTeamId,
    teams: contractData.teams,
    players: {
      ...contractData.players,
      [contractPlayer!.id]: {
        ...contractPlayer!,
        contractLeft: 1,
      },
    },
    fixtures: contractData.fixtures,
    news: [],
    inboxMessages: [contractWarning!],
    boardObjectives: [],
    liveMatches: {},
  });
  useGameStore.getState().applyInboxAction(contractWarning!.id);
  assert.equal(
    useGameStore.getState().players[contractPlayer!.id].contractLeft,
    contractWarning!.action.payload.years
  );
  assert.equal(
    useGameStore.getState().inboxMessages.find(message => message.id === contractWarning!.id)?.action,
    undefined
  );
  assert.equal(
    useGameStore.getState().inboxMessages.find(message => message.id === contractWarning!.id)?.isRead,
    true
  );

  const directRenewPlayer = Object.values(contractData.players)
    .find(player => player.teamId === contractUserTeamId && player.id !== contractPlayer!.id);
  assert.ok(directRenewPlayer, 'Expected a second player for direct contract renewal checks');
  const staleContractWarning = {
    ...contractWarning!,
    id: 'assistant-contract-warning-w35-stale-contract',
    week: 35,
    isRead: false,
  };
  useGameStore.setState({
    currentWeek: 36,
    userTeamId: contractUserTeamId,
    teams: contractData.teams,
    players: {
      ...contractData.players,
      [directRenewPlayer!.id]: {
        ...directRenewPlayer!,
        contractLeft: 1,
      },
    },
    fixtures: contractData.fixtures,
    news: [],
    inboxMessages: [
      {
        ...contractWarning!,
        id: 'assistant-contract-warning-w36-direct-renew',
        playerId: directRenewPlayer!.id,
        action: {
          type: 'renew_contract',
          payload: { playerId: directRenewPlayer!.id, years: 3, wage: 77 },
        },
      },
      {
        ...staleContractWarning,
        playerId: directRenewPlayer!.id,
        action: {
          type: 'renew_contract',
          payload: { playerId: directRenewPlayer!.id, years: 2, wage: 70 },
        },
      },
    ],
    boardObjectives: [],
    liveMatches: {},
  });
  const directRenewResult = useGameStore.getState().renewPlayerContract(directRenewPlayer!.id, 4, 88);
  assert.equal(directRenewResult.success, true);
  assert.equal(useGameStore.getState().players[directRenewPlayer!.id].contractLeft, 4);
  assert.equal(useGameStore.getState().players[directRenewPlayer!.id].wage, 88);
  const directRenewWarnings = useGameStore.getState().inboxMessages.filter(message => message.playerId === directRenewPlayer!.id);
  assert.ok(directRenewWarnings.length > 0, 'Expected retained inbox history for direct renewal');
  directRenewWarnings.forEach(message => {
    assert.equal(message.action, undefined);
    assert.equal(message.isRead, true);
  });

  const departureData = initGameData();
  const departureUserTeamId = Object.keys(departureData.teams)[0];
  const departingPlayer = Object.values(departureData.players).find(player => player.teamId === departureUserTeamId);
  assert.ok(departingPlayer, 'Expected a player for season contract rollover checks');
  const seasonAfterDeparture = advanceSeason(
    {
      ...departureData.players,
      [departingPlayer!.id]: {
        ...departingPlayer!,
        contractLeft: 0,
      },
    },
    departureData.teams,
    departureUserTeamId,
    []
  );
  assert.notEqual(seasonAfterDeparture.players[departingPlayer!.id].teamId, departureUserTeamId);
  assert.ok(seasonAfterDeparture.generatedNews.some(item => item.includes(`leaves ${departureData.teams[departureUserTeamId].name}`)));

  const reportData = initGameData();
  const reportUserTeamId = Object.keys(reportData.teams)[0];
  const reportFixture = Object.values(reportData.fixtures).find(fixture => (
    fixture.week === 1 &&
    (fixture.homeTeamId === reportUserTeamId || fixture.awayTeamId === reportUserTeamId)
  ));
  assert.ok(reportFixture, 'Expected a user fixture for post-match inbox checks');
  const previousReportPlayers = reportData.players;
  const reportResult = quickSimMatch(
    reportFixture!.id,
    reportData.players,
    reportData.teams,
    reportData.fixtures,
    reportUserTeamId,
    { rng: createSeededRandomGenerator(20260410) }
  );
  const postMatchReport = generatePostMatchReportMessage({
    currentWeek: 1,
    userTeamId: reportUserTeamId,
    fixture: reportResult.fixture,
    teams: reportResult.teams,
    players: reportResult.players,
    previousPlayers: previousReportPlayers,
  });
  assert.ok(postMatchReport, 'Expected a post-match report for the user fixture');

  const neutralFixture = Object.values(reportData.fixtures).find(fixture => (
    fixture.homeTeamId !== reportUserTeamId && fixture.awayTeamId !== reportUserTeamId
  ));
  assert.ok(neutralFixture, 'Expected a non-user fixture for post-match filtering');
  const neutralResult = quickSimMatch(
    neutralFixture!.id,
    reportData.players,
    reportData.teams,
    reportData.fixtures,
    null,
    { rng: createSeededRandomGenerator(20260411) }
  );
  assert.equal(
    generatePostMatchReportMessage({
      currentWeek: 1,
      userTeamId: reportUserTeamId,
      fixture: neutralResult.fixture,
      teams: neutralResult.teams,
      players: neutralResult.players,
      previousPlayers: reportData.players,
    }),
    null
  );
};

const runSeason = (seed: number) => {
  const rng = createSeededRandomGenerator(seed);
  const data = initGameData();
  let state = {
    players: data.players,
    teams: data.teams,
    fixtures: data.fixtures,
    currentWeek: 1,
    news: [] as string[],
  };

  let totalGoals = 0;
  let yellowCards = 0;
  let redCards = 0;
  const seasonWeekLimit = getSeasonWeekLimit(state.fixtures);
  const formationUsage = { back3: 0, back4: 0, back5: 0 };

  for (let week = 1; week <= seasonWeekLimit; week++) {
    const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
    for (const fixture of weekFixtures) {
      const beforeCards = Object.values(state.players).reduce(
        (acc, player) => ({ yellow: acc.yellow + player.yellowCards, red: acc.red + player.redCards }),
        { yellow: 0, red: 0 }
      );
      const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, null, { rng });
      state.players = result.players;
      state.teams = result.teams;
      state.fixtures[fixture.id] = result.fixture;
      totalGoals += (result.fixture.homeScore || 0) + (result.fixture.awayScore || 0);

      const afterCards = Object.values(state.players).reduce(
        (acc, player) => ({ yellow: acc.yellow + player.yellowCards, red: acc.red + player.redCards }),
        { yellow: 0, red: 0 }
      );
      yellowCards += (afterCards.yellow - beforeCards.yellow);
      redCards += (afterCards.red - beforeCards.red);
    }

    const progression = computeWeeklyProgression(
      state.currentWeek,
      state.players,
      state.teams,
      state.fixtures,
      state.news,
      null,
      rng
    );
    state.players = progression.players;
    state.teams = progression.teams;
    state.currentWeek = progression.currentWeek;
    state.news = progression.news;

    const transfers = computeWeeklyTransfers(state.players, state.teams, null, rng);
    state.players = transfers.players;
    state.teams = transfers.teams;

    Object.values(state.teams).forEach(team => {
      if (team.activeFormation.startsWith('3')) formationUsage.back3 += 1;
      else if (team.activeFormation.startsWith('5')) formationUsage.back5 += 1;
      else formationUsage.back4 += 1;
    });
  }

  const matches = Object.values(state.fixtures).length;
  return {
    avgGoalsPerMatch: totalGoals / Math.max(1, matches),
    yellowCards,
    redCards,
    formationUsage,
  };
};

const runThresholdChecks = () => {
  const seasons = [20260513, 20260514, 20260515].map(runSeason);
  const avgGoals = seasons.reduce((sum, season) => sum + season.avgGoalsPerMatch, 0) / seasons.length;
  const totalYellow = seasons.reduce((sum, season) => sum + season.yellowCards, 0);
  const totalRed = seasons.reduce((sum, season) => sum + season.redCards, 0);
  const formationUsage = seasons.reduce(
    (acc, season) => ({
      back3: acc.back3 + season.formationUsage.back3,
      back4: acc.back4 + season.formationUsage.back4,
      back5: acc.back5 + season.formationUsage.back5,
    }),
    { back3: 0, back4: 0, back5: 0 }
  );

  assert.ok(avgGoals >= 3.0 && avgGoals <= 4.8, `Expected avg goals between 3.0 and 4.8, got ${avgGoals.toFixed(2)}`);
  assert.ok(totalYellow > 0, 'Expected at least one yellow card across threshold runs');
  assert.ok(totalRed > 0, 'Expected at least one red card across threshold runs');
  assert.ok(formationUsage.back3 > 0, 'Expected some back-3 usage');
  assert.ok(formationUsage.back5 > 0, 'Expected some back-5 usage');
};

const runStateConsistencyStress = () => {
  const seeds = [20260521, 20260522];

  seeds.forEach(seed => {
    const rng = createSeededRandomGenerator(seed);
    const data = initGameData();
    let state = {
      players: data.players,
      teams: data.teams,
      fixtures: data.fixtures,
      currentWeek: 1,
      news: [] as string[],
      userTeamId: 'T1',
      inboxMessages: [] as ReturnType<typeof generateSystemInboxMessages>,
    };

    const seasonWeekLimit = getSeasonWeekLimit(state.fixtures);
    for (let week = 1; week <= seasonWeekLimit; week++) {
      const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
      for (const fixture of weekFixtures) {
        const previousPlayers = state.players;
        const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures, state.userTeamId, { rng });
        state.players = result.players;
        state.teams = result.teams;
        state.fixtures[fixture.id] = result.fixture;
        const postMatchReport = generatePostMatchReportMessage({
          currentWeek: state.currentWeek,
          userTeamId: state.userTeamId,
          fixture: result.fixture,
          teams: result.teams,
          players: result.players,
          previousPlayers,
        });
        if (postMatchReport) {
          state.inboxMessages = mergeInboxMessages(state.inboxMessages, [postMatchReport]);
        }
      }

      const progression = computeWeeklyProgression(
        state.currentWeek,
        state.players,
        state.teams,
        state.fixtures,
        state.news,
        null,
        rng
      );
      state.players = progression.players;
      state.teams = progression.teams;
      state.currentWeek = progression.currentWeek;
      state.news = progression.news;
      state.inboxMessages = mergeInboxMessages(
        state.inboxMessages,
        generateSystemInboxMessages(week, progression.generatedNews)
      );

      const transfers = computeWeeklyTransfers(state.players, state.teams, state.userTeamId, rng);
      state.players = transfers.players;
      state.teams = transfers.teams;
      state.inboxMessages = mergeInboxMessages(
        state.inboxMessages,
        generateAssistantWeekMessages({
          currentWeek: state.currentWeek,
          userTeamId: state.userTeamId,
          teams: state.teams,
          players: state.players,
          fixtures: state.fixtures,
        })
      );

      Object.values(state.players).forEach(player => {
        assert.ok(Number.isFinite(player.energy) && player.energy >= 0 && player.energy <= 100, `Invalid player energy for ${player.id} in seed ${seed}`);
        assert.ok(Number.isFinite(player.morale) && player.morale >= 0 && player.morale <= 100, `Invalid player morale for ${player.id} in seed ${seed}`);
        assert.ok(Number.isFinite(player.matchesSuspended) && player.matchesSuspended >= 0, `Invalid suspension count for ${player.id} in seed ${seed}`);
        assert.ok(Number.isFinite(player.injuryWeeks) && player.injuryWeeks >= 0, `Invalid injury weeks for ${player.id} in seed ${seed}`);
        if (player.injuryWeeks === 0) {
          assert.equal(player.injuryType, undefined, `Unexpected stale injury type for ${player.id} in seed ${seed}`);
        }
      });

      Object.values(state.teams).forEach(team => {
        assert.ok(Number.isFinite(team.budget) && team.budget >= 0, `Invalid team budget for ${team.id} in seed ${seed}`);
        assert.ok(Number.isFinite(team.transferSpend) && team.transferSpend >= 0, `Invalid team transfer spend for ${team.id} in seed ${seed}`);
        assert.ok(Number.isFinite(team.boardApproval) && team.boardApproval >= 0 && team.boardApproval <= 100, `Invalid board approval for ${team.id} in seed ${seed}`);
      });

      Object.values(state.fixtures)
        .filter(fixture => fixture.isPlayed)
        .forEach(fixture => {
          assert.ok(Number.isFinite(fixture.homeScore), `Played fixture ${fixture.id} missing home score in seed ${seed}`);
          assert.ok(Number.isFinite(fixture.awayScore), `Played fixture ${fixture.id} missing away score in seed ${seed}`);
        });

      assert.ok(state.inboxMessages.length <= MAX_INBOX_MESSAGES, `Inbox cap exceeded in seed ${seed}`);
      assert.equal(
        new Set(state.inboxMessages.map(message => message.id)).size,
        state.inboxMessages.length,
        `Inbox dedupe failed in seed ${seed}`
      );
    }
  });
};

const run = () => {
  console.log('--- CI REGRESSION CHECKS ---');
  runInvariantChecks();
  console.log('[OK] Invariant checks passed');
  runThresholdChecks();
  console.log('[OK] Seasonal threshold checks passed');
  runStateConsistencyStress();
  console.log('[OK] State consistency stress checks passed');
  console.log('--- CI REGRESSION COMPLETE ---');
};

run();

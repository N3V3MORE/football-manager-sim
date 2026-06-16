// 621-line monolithic file that should be split into command handlers, validators, and simulators.
import { Fixture, Formation, TeamTactics } from '../models/types';
import { getSeasonWeekLimit } from '../core/leagueUtils';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { useGameStore } from '../store/gameStore';
import { initGameData } from '../utils/initGame';

type AgentCommand =
  | 'help'
  | 'summary'
  | 'validate'
  | 'snapshot'
  | 'rawState'
  | 'initialize'
  | 'changeTeam'
  | 'applyAssistantActions'
  | 'applyInboxAction'
  | 'markInboxRead'
  | 'dismissInbox'
  | 'advanceWeek'
  | 'skipSeason'
  | 'quickSimNext'
  | 'liveSimNext'
  | 'processLiveMinute'
  | 'finishLiveMatch'
  | 'setFormation'
  | 'setTactics'
  | 'listPlayer'
  | 'unlistPlayer'
  | 'buyPlayer'
  | 'renewContract'
  | 'playSeason'
  | 'smokeCheck';

type AgentPayload = Record<string, unknown> | undefined;

type AgentCommandResult = {
  ok: boolean;
  command: AgentCommand | string;
  data?: unknown;
  error?: string;
  before?: AgentGameSummary;
  after?: AgentGameSummary;
};

type AgentIssueSeverity = 'error' | 'warning';

type AgentGameIssue = {
  severity: AgentIssueSeverity;
  message: string;
  entity?: string;
};

type AgentFixtureSummary = {
  id: string;
  week: number;
  homeTeam: string;
  awayTeam: string;
  score: string;
  isPlayed: boolean;
  competitionId: string;
  round: string;
};

type AgentGameSummary = {
  currentWeek: number;
  seasonWeekLimit: number;
  userTeamId: string | null;
  userTeamName?: string;
  userTeamRecord?: string;
  userTeamBudget?: number;
  boardApproval?: number;
  teams: number;
  players: number;
  fixtures: number;
  playedFixtures: number;
  inboxMessages: number;
  unreadInboxMessages: number;
  liveMatches: number;
  nextFixture?: AgentFixtureSummary;
};

type AgentValidationReport = {
  status: 'pass' | 'fail';
  errors: number;
  warnings: number;
  issues: AgentGameIssue[];
  summary: AgentGameSummary;
};

export type AgentGameHandler = {
  version: 1;
  help: () => ReturnType<typeof listAgentCommands>;
  summary: () => AgentGameSummary;
  validate: () => AgentValidationReport;
  snapshot: (payload?: AgentPayload) => unknown;
  run: (command: AgentCommand, payload?: AgentPayload) => AgentCommandResult;
};

declare global {
  var __FM_AGENT__: AgentGameHandler | undefined;
}

const state = () => useGameStore.getState();

const listAgentCommands = () => ([
  { command: 'summary', payload: null, description: 'Return compact live game state.' },
  { command: 'validate', payload: null, description: 'Find broken references, invalid fixtures, and lineup warnings.' },
  { command: 'snapshot', payload: { teamId: 'optional', limit: 20 }, description: 'Return focused data for inbox, squad, fixtures, and news.' },
  { command: 'rawState', payload: null, description: 'Return the full Zustand state for deep local inspection.' },
  { command: 'initialize', payload: { teamId: 'optional' }, description: 'Reset/initialize a save for a team.' },
  { command: 'changeTeam', payload: { teamId: 'T1' }, description: 'Switch managed team.' },
  { command: 'applyAssistantActions', payload: { types: ['apply_lineup', 'apply_tactics'] }, description: 'Apply assistant inbox setup actions.' },
  { command: 'applyInboxAction', payload: { messageId: 'message-id' }, description: 'Apply one inbox action.' },
  { command: 'advanceWeek', payload: { count: 1 }, description: 'Advance one or more weeks. Counts over 26 require allowLargeCount.' },
  { command: 'quickSimNext', payload: { fixtureId: 'optional' }, description: 'Quick sim a fixture, defaulting to the next managed-team fixture.' },
  { command: 'liveSimNext', payload: { fixtureId: 'optional', finish: true }, description: 'Run a full 90-minute live sim and optionally finish it.' },
  { command: 'processLiveMinute', payload: { fixtureId: 'fixture-id', minute: 15 }, description: 'Run a specific live-match minute.' },
  { command: 'finishLiveMatch', payload: { fixtureId: 'fixture-id' }, description: 'Finalize live match accounting.' },
  { command: 'setFormation', payload: { teamId: 'optional', formation: '4-3-3' }, description: 'Set a team formation through store action.' },
  { command: 'setTactics', payload: { teamId: 'optional', tactics: {} }, description: 'Patch team tactics through store action.' },
  { command: 'listPlayer', payload: { playerId: 'player-id', askingPrice: 10 }, description: 'Transfer-list a player.' },
  { command: 'unlistPlayer', payload: { playerId: 'player-id' }, description: 'Remove a player from the transfer list.' },
  { command: 'buyPlayer', payload: { playerId: 'player-id', fee: 10, wageOffered: 50 }, description: 'Attempt a transfer purchase.' },
  { command: 'renewContract', payload: { playerId: 'player-id', years: 3, wage: 50 }, description: 'Renew an owned player contract.' },
  { command: 'playSeason', payload: { reset: true, teamId: 'optional', applyAssistantActions: true }, description: 'Play through a full season with weekly validation and return a compact report.' },
  { command: 'smokeCheck', payload: null, description: 'Reset and run a live in-app smoke test across core game flows.' },
]);

const errorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
);

const readString = (payload: AgentPayload, key: string) => {
  const value = payload?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const readNumber = (payload: AgentPayload, key: string, fallback: number) => {
  const value = payload?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const readBoolean = (payload: AgentPayload, key: string, fallback: boolean) => {
  const value = payload?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

const getTeamName = (teamId: string) => state().teams[teamId]?.name || teamId;

const fixtureSummary = (fixture: Fixture): AgentFixtureSummary => ({
  id: fixture.id,
  week: fixture.week,
  homeTeam: getTeamName(fixture.homeTeamId),
  awayTeam: getTeamName(fixture.awayTeamId),
  score: fixture.homeScore === null || fixture.awayScore === null
    ? 'not played'
    : `${fixture.homeScore}-${fixture.awayScore}`,
  isPlayed: fixture.isPlayed,
  competitionId: fixture.competitionId,
  round: fixture.round,
});

const getNextFixture = (fixtureId?: string) => {
  const current = state();
  if (fixtureId) {
    const fixture = current.fixtures[fixtureId];
    if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);
    return fixture;
  }

  const userTeamId = current.userTeamId;
  const fixtures = Object.values(current.fixtures)
    .filter(fixture => (
      !fixture.isPlayed &&
      (!userTeamId || fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
    ))
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));

  const fixture = fixtures[0];
  if (!fixture) throw new Error('No unplayed fixture found');
  return fixture;
};

export const buildAgentGameSummary = (): AgentGameSummary => {
  const current = state();
  const userTeam = current.userTeamId ? current.teams[current.userTeamId] : undefined;
  const playedFixtures = Object.values(current.fixtures).filter(fixture => fixture.isPlayed).length;
  const nextFixture = Object.values(current.fixtures)
    .filter(fixture => (
      !fixture.isPlayed &&
      (!current.userTeamId || fixture.homeTeamId === current.userTeamId || fixture.awayTeamId === current.userTeamId)
    ))
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id))[0];

  return {
    currentWeek: current.currentWeek,
    seasonWeekLimit: getSeasonWeekLimit(current.fixtures, current.competitions),
    userTeamId: current.userTeamId,
    userTeamName: userTeam?.name,
    userTeamRecord: userTeam ? `${userTeam.wins}-${userTeam.draws}-${userTeam.losses}` : undefined,
    userTeamBudget: userTeam?.budget,
    boardApproval: userTeam?.boardApproval,
    teams: Object.keys(current.teams).length,
    players: Object.keys(current.players).length,
    fixtures: Object.keys(current.fixtures).length,
    playedFixtures,
    inboxMessages: current.inboxMessages.length,
    unreadInboxMessages: current.inboxMessages.filter(message => !message.isRead).length,
    liveMatches: Object.keys(current.liveMatches || {}).length,
    nextFixture: nextFixture ? fixtureSummary(nextFixture) : undefined,
  };
};

export const validateAgentGameState = (): AgentValidationReport => {
  const current = state();
  const issues: AgentGameIssue[] = [];
  const addIssue = (severity: AgentIssueSeverity, message: string, entity?: string) => {
    issues.push({ severity, message, entity });
  };

  if (Object.keys(current.teams).length === 0) addIssue('error', 'No teams loaded');
  if (Object.keys(current.players).length === 0) addIssue('error', 'No players loaded');
  if (Object.keys(current.fixtures).length === 0) addIssue('error', 'No fixtures loaded');

  Object.values(current.players).forEach(player => {
    if (!current.teams[player.teamId]) addIssue('error', `Player references missing team ${player.teamId}`, player.id);
    if (player.energy < 0 || player.energy > 100) addIssue('warning', `Player energy outside 0-100: ${player.energy}`, player.id);
    if (player.morale < 0 || player.morale > 100) addIssue('warning', `Player morale outside 0-100: ${player.morale}`, player.id);
  });

  Object.values(current.teams).forEach(team => {
    if (team.boardApproval < 0 || team.boardApproval > 100) {
      addIssue('warning', `Board approval outside 0-100: ${team.boardApproval}`, team.id);
    }

    const teamPlayers = Object.values(current.players).filter(player => player.teamId === team.id);
    const activeStarters = teamPlayers.filter(player => player.isStarting && !isPlayerUnavailable(player));
    const activeSubs = teamPlayers.filter(player => player.isSub && !isPlayerUnavailable(player));
    const unavailableSelected = teamPlayers.filter(player => (
      (player.isStarting || player.isSub) && isPlayerUnavailable(player)
    ));
    if (activeStarters.length > 11) addIssue('error', `Team has too many active starters: ${activeStarters.length}`, team.id);
    if (activeSubs.length > 7) addIssue('error', `Team has too many active substitutes: ${activeSubs.length}`, team.id);
    if (unavailableSelected.length > 0) {
      addIssue('warning', `Team has ${unavailableSelected.length} unavailable selected player(s)`, team.id);
    }

    const seenSlotPlayers = new Set<string>();
    Object.entries(team.formationMap || {}).forEach(([slotKey, playerId]) => {
      const player = current.players[playerId];
      if (!player) {
        addIssue('error', `Formation slot ${slotKey} references missing player ${playerId}`, team.id);
        return;
      }
      if (player.teamId !== team.id) {
        addIssue('error', `Formation slot ${slotKey} references player outside team`, team.id);
      }
      if (seenSlotPlayers.has(playerId)) {
        addIssue('error', `Formation map uses player ${playerId} more than once`, team.id);
      }
      seenSlotPlayers.add(playerId);
      if (!player.isStarting) {
        addIssue('warning', `Formation slot ${slotKey} player is not marked starting`, player.id);
      }
    });
  });

  Object.values(current.fixtures).forEach(fixture => {
    if (!current.teams[fixture.homeTeamId]) addIssue('error', 'Fixture references missing home team', fixture.id);
    if (!current.teams[fixture.awayTeamId]) addIssue('error', 'Fixture references missing away team', fixture.id);
    if (fixture.isPlayed) {
      if (typeof fixture.homeScore !== 'number') addIssue('error', 'Played fixture is missing home score', fixture.id);
      if (typeof fixture.awayScore !== 'number') addIssue('error', 'Played fixture is missing away score', fixture.id);
      if (fixture.isKnockout && !fixture.winnerTeamId) addIssue('error', 'Played knockout fixture is missing winner', fixture.id);
    }
  });

  Object.entries(current.liveMatches || {}).forEach(([fixtureId, liveMatch]) => {
    if (!current.fixtures[fixtureId]) addIssue('error', 'Live match references missing fixture', fixtureId);
    [...liveMatch.homeStarterIds, ...liveMatch.awayStarterIds].forEach(playerId => {
      if (!current.players[playerId]) addIssue('error', `Live match starter ${playerId} is missing`, fixtureId);
    });
  });

  if (!current.userTeamId) {
    addIssue('warning', 'No managed team selected');
  } else if (!current.teams[current.userTeamId]) {
    addIssue('error', 'Managed team id does not exist', current.userTeamId);
  } else {
    const userSquad = Object.values(current.players).filter(player => player.teamId === current.userTeamId);
    const activeStarters = userSquad.filter(player => player.isStarting && !isPlayerUnavailable(player));
    if (activeStarters.length === 0) addIssue('warning', 'Managed team has no active starters selected', current.userTeamId);
  }

  const errors = issues.filter(issue => issue.severity === 'error').length;
  const warnings = issues.filter(issue => issue.severity === 'warning').length;

  return {
    status: errors > 0 ? 'fail' : 'pass',
    errors,
    warnings,
    issues,
    summary: buildAgentGameSummary(),
  };
};

const buildSnapshot = (payload: AgentPayload = {}) => {
  const current = state();
  const limit = Math.max(1, Math.min(100, Math.floor(readNumber(payload, 'limit', 20))));
  const teamId = readString(payload, 'teamId') || current.userTeamId || Object.keys(current.teams)[0];
  const team = teamId ? current.teams[teamId] : undefined;
  const squad = teamId
    ? Object.values(current.players)
      .filter(player => player.teamId === teamId)
      .sort((a, b) => b.overallRating - a.overallRating)
      .slice(0, limit)
      .map(player => ({
        id: player.id,
        name: player.name,
        position: player.position,
        subPosition: player.subPosition,
        rating: player.overallRating,
        energy: player.energy,
        morale: player.morale,
        isStarting: player.isStarting,
        isSub: player.isSub,
        unavailable: isPlayerUnavailable(player),
        injuryWeeks: player.injuryWeeks,
        matchesSuspended: player.matchesSuspended,
        contractLeft: player.contractLeft,
        wage: player.wage,
      }))
    : [];
  const fixtures = Object.values(current.fixtures)
    .filter(fixture => !teamId || fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(fixtureSummary);

  return {
    summary: buildAgentGameSummary(),
    validation: validateAgentGameState(),
    team: team ? {
      id: team.id,
      name: team.name,
      division: team.division,
      formation: team.activeFormation,
      tactics: team.tactics,
      record: `${team.wins}-${team.draws}-${team.losses}`,
      points: team.points,
      budget: team.budget,
      boardApproval: team.boardApproval,
    } : null,
    squad,
    fixtures,
    inboxMessages: current.inboxMessages.slice(0, limit).map(message => ({
      id: message.id,
      week: message.week,
      source: message.source,
      category: message.category,
      title: message.title,
      isRead: message.isRead,
      actionType: message.action?.type,
      fixtureId: message.fixtureId,
      playerId: message.playerId,
      teamId: message.teamId,
    })),
    news: current.news.slice(0, limit),
  };
};

const getInitialTeamId = () => Object.keys(initGameData().teams)[0]!;

const applyAssistantActions = (payload: AgentPayload) => {
  const current = state();
  const userTeamId = current.userTeamId;
  const requestedTypes = Array.isArray(payload?.types)
    ? payload.types.filter((type): type is string => typeof type === 'string')
    : ['apply_lineup', 'apply_tactics'];
  const applied: string[] = [];

  current.inboxMessages.forEach(message => {
    if (!message.action || !requestedTypes.includes(message.action.type)) return;
    if (
      (message.action.type === 'apply_lineup' || message.action.type === 'apply_tactics') &&
      userTeamId &&
      message.action.payload.teamId !== userTeamId
    ) return;

    state().applyInboxAction(message.id);
    applied.push(message.id);
  });

  return { applied };
};

const quickSimNext = (payload: AgentPayload) => {
  const fixture = getNextFixture(readString(payload, 'fixtureId'));
  if (fixture.isPlayed) throw new Error(`Fixture ${fixture.id} is already played`);
  state().playMatch(fixture.id);
  return fixtureSummary(state().fixtures[fixture.id]!);
};

const liveSimNext = (payload: AgentPayload) => {
  const fixture = getNextFixture(readString(payload, 'fixtureId'));
  if (fixture.isPlayed) throw new Error(`Fixture ${fixture.id} is already played`);

  const events: { minute: number; event: string }[] = [];
  for (let minute = 1; minute <= 90; minute += 1) {
    const result = state().processMatchMinute(fixture.id, minute);
    if (result.event) events.push({ minute, event: result.event });
  }

  if (readBoolean(payload, 'finish', true)) {
    state().finishLiveMatch(fixture.id);
  }

  return {
    fixture: fixtureSummary(state().fixtures[fixture.id]!),
    events,
    liveMatchActive: Boolean(state().liveMatches[fixture.id]),
  };
};

const runSmokeCheck = () => {
  const steps: { name: string; status: 'pass' }[] = [];
  const record = (name: string, fn: () => void) => {
    fn();
    steps.push({ name, status: 'pass' });
  };

  record('initialize game', () => state().initializeGame(getInitialTeamId()));
  record('apply assistant actions', () => {
    const result = applyAssistantActions(undefined);
    if (result.applied.length === 0) throw new Error('No assistant actions applied');
  });
  record('transfer action', () => {
    const current = state();
    const userTeamId = current.userTeamId;
    if (!userTeamId) throw new Error('No managed team selected');
    const ownPlayer = Object.values(current.players).find(player => player.teamId === userTeamId);
    const targetPlayer = Object.values(current.players).find(player => player.teamId !== userTeamId);
    if (!ownPlayer || !targetPlayer) throw new Error('Missing transfer smoke-check players');
    state().listPlayerForSale(ownPlayer.id, 1);
    state().unlistPlayer(ownPlayer.id);
    state().buyPlayer(targetPlayer.id, 0, 1);
  });
  record('live sim', () => { liveSimNext(undefined); });
  record('quick sim', () => { quickSimNext(undefined); });
  record('advance week', () => state().advanceWeek());
  record('validate', () => {
    const validation = validateAgentGameState();
    if (validation.status === 'fail') throw new Error(`Validation failed with ${validation.errors} errors`);
  });

  return { status: 'pass', steps, validation: validateAgentGameState() };
};

const playSeason = (payload: AgentPayload) => {
  const reset = readBoolean(payload, 'reset', false);
  const applyAssistantBeforeWeeks = readBoolean(payload, 'applyAssistantActions', true);
  const continueOnError = readBoolean(payload, 'continueOnError', false);
  const requestedTeamId = readString(payload, 'teamId');
  const maxWeeks = Math.max(1, Math.min(100, Math.floor(readNumber(payload, 'maxWeeks', 80))));

  if (reset || Object.keys(state().teams).length === 0) {
    state().initializeGame(requestedTeamId || getInitialTeamId());
  } else if (requestedTeamId) {
    state().changeTeam(requestedTeamId);
  }

  const startedAt = buildAgentGameSummary();
  const startingManagedSeasons = state().careerRecord.seasonsManaged;
  const weeklyReports: {
    week: number;
    playedFixtures: number;
    errors: number;
    warnings: number;
    userTeamId: string | null;
    userTeamName?: string;
    boardApproval?: number;
  }[] = [];
  let weeksPlayed = 0;
  let completedSeason = false;
  let firstFailure: AgentValidationReport | null = null;

  while (weeksPlayed < maxWeeks) {
    if (applyAssistantBeforeWeeks) applyAssistantActions(undefined);

    const before = buildAgentGameSummary();
    state().advanceWeek();
    weeksPlayed += 1;

    const validation = validateAgentGameState();
    weeklyReports.push({
      week: before.currentWeek,
      playedFixtures: validation.summary.playedFixtures,
      errors: validation.errors,
      warnings: validation.warnings,
      userTeamId: validation.summary.userTeamId,
      userTeamName: validation.summary.userTeamName,
      boardApproval: validation.summary.boardApproval,
    });

    if (validation.status === 'fail') {
      firstFailure = validation;
      if (!continueOnError) break;
    }

    if (
      state().currentWeek === 1 ||
      state().careerRecord.seasonsManaged > startingManagedSeasons
    ) {
      completedSeason = true;
      break;
    }
  }

  const finalValidation = validateAgentGameState();

  return {
    status: firstFailure ? 'fail' : completedSeason ? 'pass' : 'incomplete',
    completedSeason,
    weeksPlayed,
    maxWeeks,
    startedAt,
    finishedAt: buildAgentGameSummary(),
    weeklyReports,
    firstFailure,
    finalValidation,
  };
};

const runAgentCommand = (command: AgentCommand, payload?: AgentPayload): AgentCommandResult => {
  const before = buildAgentGameSummary();
  try {
    let data: unknown;

    if (command === 'help') data = listAgentCommands();
    else if (command === 'summary') data = buildAgentGameSummary();
    else if (command === 'validate') data = validateAgentGameState();
    else if (command === 'snapshot') data = buildSnapshot(payload);
    else if (command === 'rawState') data = state();
    else if (command === 'initialize') state().initializeGame(readString(payload, 'teamId') ?? getInitialTeamId());
    else if (command === 'changeTeam') state().changeTeam(readString(payload, 'teamId') || '');
    else if (command === 'applyAssistantActions') data = applyAssistantActions(payload);
    else if (command === 'applyInboxAction') state().applyInboxAction(readString(payload, 'messageId') || '');
    else if (command === 'markInboxRead') state().markInboxMessageRead(readString(payload, 'messageId') || '');
    else if (command === 'dismissInbox') state().dismissInboxMessage(readString(payload, 'messageId') || '');
    else if (command === 'advanceWeek') {
      const count = Math.max(1, Math.floor(readNumber(payload, 'count', 1)));
      if (count > 26 && !readBoolean(payload, 'allowLargeCount', false)) {
        throw new Error('advanceWeek count over 26 requires allowLargeCount: true');
      }
      for (let i = 0; i < count; i += 1) state().advanceWeek();
      data = { advancedWeeks: count };
    } else if (command === 'skipSeason') state().skipToEndOfSeason();
    else if (command === 'quickSimNext') data = quickSimNext(payload);
    else if (command === 'liveSimNext') data = liveSimNext(payload);
    else if (command === 'processLiveMinute') {
      const fixtureId = readString(payload, 'fixtureId');
      if (!fixtureId) throw new Error('processLiveMinute requires fixtureId');
      data = state().processMatchMinute(fixtureId, readNumber(payload, 'minute', 1));
    } else if (command === 'finishLiveMatch') {
      const fixtureId = readString(payload, 'fixtureId');
      if (!fixtureId) throw new Error('finishLiveMatch requires fixtureId');
      state().finishLiveMatch(fixtureId);
    } else if (command === 'setFormation') {
      const teamId = readString(payload, 'teamId') || state().userTeamId;
      const formation = readString(payload, 'formation') as Formation | undefined;
      if (!teamId || !formation) throw new Error('setFormation requires a teamId or managed team and formation');
      state().setFormation(teamId, formation);
    } else if (command === 'setTactics') {
      const teamId = readString(payload, 'teamId') || state().userTeamId;
      const tactics = payload?.tactics as Partial<TeamTactics> | undefined;
      if (!teamId || !tactics || typeof tactics !== 'object') throw new Error('setTactics requires a teamId or managed team and tactics');
      state().setTactics(teamId, tactics);
    } else if (command === 'listPlayer') {
      const playerId = readString(payload, 'playerId');
      if (!playerId) throw new Error('listPlayer requires playerId');
      state().listPlayerForSale(playerId, readNumber(payload, 'askingPrice', 1));
    } else if (command === 'unlistPlayer') {
      const playerId = readString(payload, 'playerId');
      if (!playerId) throw new Error('unlistPlayer requires playerId');
      state().unlistPlayer(playerId);
    } else if (command === 'buyPlayer') {
      const playerId = readString(payload, 'playerId');
      if (!playerId) throw new Error('buyPlayer requires playerId');
      data = state().buyPlayer(playerId, readNumber(payload, 'fee', 0), readNumber(payload, 'wageOffered', 0));
    } else if (command === 'renewContract') {
      const playerId = readString(payload, 'playerId');
      if (!playerId) throw new Error('renewContract requires playerId');
      data = state().renewPlayerContract(playerId, readNumber(payload, 'years', 1), readNumber(payload, 'wage', 1));
    } else if (command === 'playSeason') data = playSeason(payload);
    else if (command === 'smokeCheck') data = runSmokeCheck();
    else throw new Error(`Unknown agent command ${command}`);

    return { ok: true, command, data, before, after: buildAgentGameSummary() };
  } catch (error) {
    return { ok: false, command, error: errorMessage(error), before, after: buildAgentGameSummary() };
  }
};

export const installAgentGameHandler = () => {
  const handler: AgentGameHandler = {
    version: 1,
    help: listAgentCommands,
    summary: buildAgentGameSummary,
    validate: validateAgentGameState,
    snapshot: buildSnapshot,
    run: runAgentCommand,
  };

  globalThis.__FM_AGENT__ = handler;

  return () => {
    if (globalThis.__FM_AGENT__ === handler) {
      globalThis.__FM_AGENT__ = undefined;
    }
  };
};

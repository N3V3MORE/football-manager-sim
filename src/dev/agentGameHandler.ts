import { Fixture, Formation, Player, PlayerRole, StatKey, Team, TeamTactics } from '../models/types';
import { BASE_FORMATION_SLOTS, getSlotsForFormation } from '../constants/formations';
import { getCompatiblePlayerRolesForSlot } from '../core/playerRoleEngine';
import { getDecisiveTieScore } from '../core/matchTieResolution';
import { getRenewalOffer } from '../core/contractUtils';
import { FREE_AGENT_TEAM_ID } from '../core/freeAgentPool';
import { compareFixturesChronologically, getNextDueFixture } from '../core/fixtureLifecycle';
import { getSeasonWeekLimit } from '../core/leagueUtils';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { createSeededRandomGenerator, hashStringToSeed } from '../core/random';
import { useGameStore } from '../store/gameStore';
import { initGameData } from '../utils/initGame';
import { getInboxSeason } from '../store/inboxCore';
import {
  AIPlayConfig,
  AIPlayReport,
  AIPolicyMode,
  AIPlayVerbosity,
  BalanceFlag,
  BugReport,
  AIPolicyGameState,
  runAiPostWeekPolicy,
  runAiPreWeekPolicy,
} from './aiPolicy';

type AgentCommand =
  | 'help'
  | 'summary'
  | 'validate'
  | 'snapshot'
  | 'rawState'
  | 'players'
  | 'teams'
  | 'initialize'
  | 'changeTeam'
  | 'applyAssistantActions'
  | 'applyInboxAction'
  | 'markInboxRead'
  | 'dismissInbox'
  | 'advanceWeek'
  | 'skipSeason'
  | 'clearStuckLiveMatch'
  | 'quickSimNext'
  | 'liveSimNext'
  | 'processLiveMinute'
  | 'finishLiveMatch'
  | 'setFormation'
  | 'setTactics'
  | 'toggleStarting'
  | 'markAsSub'
  | 'setTrainingFocus'
  | 'setPlayerRole'
  | 'swapPlayer'
  | 'swapStartingSlots'
  | 'approachPlayer'
  | 'submitTransferBid'
  | 'acceptTransferCounter'
  | 'withdrawTransferNegotiation'
  | 'signFreeAgent'
  | 'makeLiveSubstitutions'
  | 'setLiveMatchFormation'
  | 'listPlayer'
  | 'unlistPlayer'
  | 'buyPlayer'
  | 'renewContract'
  | 'playSeason'
  | 'playWithAI'
  | 'smokeCheck';

type AgentPayload = Record<string, unknown> | undefined;

type AgentCommandResult = {
  ok: boolean;
  command: AgentCommand | string;
  data?: unknown;
  error?: string;
  before?: AgentGameSummary;
  after?: AgentGameSummary;
  stateHash?: string;
  changed?: boolean;
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
  version: 2;
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
const VALID_FORMATIONS = new Set(Object.keys(BASE_FORMATION_SLOTS));
const VALID_TACTICS: Record<keyof TeamTactics, readonly string[]> = {
  mentality: ['Defensive', 'Balanced', 'Attacking'],
  passingStyle: ['Short', 'Mixed', 'Direct'],
  tempo: ['Slow', 'Normal', 'Fast'],
  defensiveLine: ['Deep', 'Standard', 'High'],
  pressing: ['None', 'Medium', 'High'],
};

const listAgentCommands = () => ([
  { command: 'summary', payload: null, description: 'Return compact live game state.' },
  { command: 'validate', payload: null, description: 'Find broken references, invalid fixtures, and lineup warnings.' },
  { command: 'snapshot', payload: { teamId: 'optional', fixtureId: 'optional', limit: 20, offset: 0 }, description: 'Detached squad, upcoming fixtures/results, live management, inbox actions, negotiations, board and career data.' },
  { command: 'rawState', payload: null, description: 'Return detached JSON game data. Store functions are excluded.' },
  { command: 'players', payload: { category: 'squad', search: '', position: 'optional', limit: 20, offset: 0 }, description: 'Page squad, market, external or free-agent players with IDs, attributes, training and contract offers.' },
  { command: 'teams', payload: { search: '', limit: 20, offset: 0 }, description: 'Page club IDs, divisions, budgets and league records.' },
  { command: 'initialize', payload: { teamId: 'optional', seed: 12091 }, description: 'Reset/initialize a save for a team and optional deterministic seed.' },
  { command: 'changeTeam', payload: { teamId: 'T1' }, description: 'Switch managed team.' },
  { command: 'applyAssistantActions', payload: { types: ['apply_lineup', 'apply_tactics'] }, description: 'Apply assistant inbox setup actions.' },
  { command: 'applyInboxAction', payload: { messageId: 'message-id' }, description: 'Apply one inbox action.' },
  { command: 'markInboxRead', payload: { messageId: 'message-id' }, description: 'Mark an existing inbox message read.' },
  { command: 'dismissInbox', payload: { messageId: 'message-id' }, description: 'Dismiss an existing inbox message.' },
  { command: 'advanceWeek', payload: { count: 1 }, description: 'Advance 1–100 weeks. Over 26 requires allowLargeCount; report actual progress and live-match blockers.' },
  { command: 'skipSeason', payload: null, description: 'Advance to season rollover with failure warning in development.' },
  { command: 'clearStuckLiveMatch', payload: null, description: 'Clear invalid persisted live-match recovery blockers.' },
  { command: 'quickSimNext', payload: { fixtureId: 'optional' }, description: 'Quick sim a fixture, defaulting to the next managed-team fixture.' },
  { command: 'liveSimNext', payload: { fixtureId: 'optional', finish: true }, description: 'Resume remaining live minutes through regulation/extra time, returning events; optionally finalize.' },
  { command: 'processLiveMinute', payload: { fixtureId: 'fixture-id', minute: 15 }, description: 'Run a specific live-match minute.' },
  { command: 'finishLiveMatch', payload: { fixtureId: 'fixture-id' }, description: 'Finalize live match accounting.' },
  { command: 'setFormation', payload: { teamId: 'optional', formation: '4-3-3' }, description: 'Set a team formation through store action.' },
  { command: 'setTactics', payload: { teamId: 'optional', tactics: {} }, description: 'Patch team tactics through store action.' },
  { command: 'toggleStarting', payload: { playerId: 'player-id' }, description: 'Toggle an owned player in the starting XI.' },
  { command: 'markAsSub', payload: { playerId: 'player-id' }, description: 'Toggle an owned player on the bench.' },
  { command: 'setTrainingFocus', payload: { playerId: 'player-id', focus: 'passing' }, description: 'Set pace/shooting/passing/dribbling/defending/physical, or null to clear training focus.' },
  { command: 'setPlayerRole', payload: { slotKey: '0-1', role: 'default' }, description: 'Set a compatible role for a managed formation slot; options appear in snapshot.' },
  { command: 'swapPlayer', payload: { removeId: 'optional', addId: 'player-id', slotKey: 'optional' }, description: 'Replace a starter with another owned player, using an optional formation slot.' },
  { command: 'swapStartingSlots', payload: { slotA: '0-0', slotB: '0-1' }, description: 'Swap two occupied, compatible managed formation slots.' },
  { command: 'approachPlayer', payload: { playerId: 'player-id' }, description: 'Open transfer negotiations for an external player.' },
  { command: 'submitTransferBid', payload: { negotiationId: 'negotiation-id', fee: 10, wageOffered: 50 }, description: 'Submit terms to an active negotiation.' },
  { command: 'acceptTransferCounter', payload: { negotiationId: 'negotiation-id' }, description: 'Accept an existing transfer counter offer.' },
  { command: 'withdrawTransferNegotiation', payload: { negotiationId: 'negotiation-id' }, description: 'Withdraw from an active negotiation.' },
  { command: 'signFreeAgent', payload: { playerId: 'player-id', wageOffered: 50 }, description: 'Offer wages to a free agent.' },
  { command: 'makeLiveSubstitutions', payload: { fixtureId: 'fixture-id', replacements: [{ offPlayerId: 'player-id', onPlayerId: 'player-id' }] }, description: 'Make managed live substitutions using normal eligibility and window rules.' },
  { command: 'setLiveMatchFormation', payload: { fixtureId: 'fixture-id', formation: '4-4-2' }, description: 'Change the managed live shape without changing the saved default formation.' },
  { command: 'listPlayer', payload: { playerId: 'player-id', askingPrice: 10 }, description: 'Transfer-list a player.' },
  { command: 'unlistPlayer', payload: { playerId: 'player-id' }, description: 'Remove a player from the transfer list.' },
  { command: 'buyPlayer', payload: { playerId: 'player-id', fee: 10, wageOffered: 50 }, description: 'Attempt a transfer purchase.' },
  { command: 'renewContract', payload: { playerId: 'player-id', years: 3, wage: 50 }, description: 'Renew an owned player contract.' },
  { command: 'playSeason', payload: { reset: true, teamId: 'optional', applyAssistantActions: true }, description: 'Play through a full season with weekly validation and return a compact report.' },
  { command: 'playWithAI', payload: { seasons: 3, seed: 12091, teamId: 'T1', policy: 'balanced', stopOnError: true, reportBalanceFlags: true, verbosity: 'summary' }, description: 'Run active AI autoplay with weekly decisions, validation, and balance reporting.' },
  { command: 'smokeCheck', payload: null, description: 'Reset and run a live in-app smoke test across core game flows.' },
]);

const errorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error)
);

const readString = (payload: AgentPayload, key: string) => {
  const value = payload?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a nonempty string`);
  return value;
};

const readNumber = (payload: AgentPayload, key: string, fallback: number) => {
  const value = payload?.[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
};

const readPositiveInteger = (payload: AgentPayload, key: string) => {
  const value = payload?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive safe integer`);
  return value;
};

const readBoolean = (payload: AgentPayload, key: string, fallback: boolean) => {
  const value = payload?.[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return value;
};

const getTeamName = (teamId: string) => state().teams[teamId]?.name || teamId;

const getStateHash = () => {
  const current = state();
  return hashStringToSeed(JSON.stringify(current)).toString(16).padStart(8, '0');
};

function assertManagedTeam(teamId?: string | null): asserts teamId is string {
  const userTeamId = state().userTeamId;
  if (!userTeamId) throw new Error('No managed team selected');
  if (!teamId || teamId !== userTeamId) throw new Error('Manager actions may only target the managed club.');
}

const assertManagedDueFixture = (fixture: Fixture) => {
  const current = state();
  const userTeamId = current.userTeamId;
  assertManagedTeam(userTeamId);
  if (fixture.homeTeamId !== userTeamId && fixture.awayTeamId !== userTeamId) {
    throw new Error('Manager actions may only target the managed club fixture.');
  }
  if (fixture.week > current.currentWeek) throw new Error(`Fixture ${fixture.id} is not due yet.`);
  if (fixture.isPlayed) throw new Error(`Fixture ${fixture.id} is already played.`);
};

const readFormation = (payload: AgentPayload) => {
  const formation = readString(payload, 'formation');
  if (!formation || !VALID_FORMATIONS.has(formation)) throw new Error(`Invalid formation: ${formation || 'missing'}`);
  return formation as Formation;
};

const readTactics = (payload: AgentPayload) => {
  const raw = payload?.tactics;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('setTactics requires a tactics object');
  const tactics: Partial<TeamTactics> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (!(key in VALID_TACTICS)) throw new Error(`Invalid tactic key: ${key}`);
    if (typeof value !== 'string' || !VALID_TACTICS[key as keyof TeamTactics].includes(value)) {
      throw new Error(`Invalid tactic value for ${key}: ${String(value)}`);
    }
    tactics[key as keyof TeamTactics] = value as never;
  });
  return tactics;
};

const detach = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const requiredString = (payload: AgentPayload, key: string) => {
  const value = readString(payload, key);
  if (!value) throw new Error(`${key} is required`);
  return value;
};
const ownedPlayer = (payload: AgentPayload, key = 'playerId') => {
  const id = requiredString(payload, key);
  const player = state().players[id];
  if (!player) throw new Error(`Unknown player ${id}`);
  assertManagedTeam(player.teamId);
  return player;
};
const playableTeamId = (teamId: string) => {
  const teams = Object.keys(state().teams).length ? state().teams : initGameData().teams;
  if (!teams[teamId] || teams[teamId].isExternal) throw new Error(`Unknown or unmanageable club ${teamId}`);
  return teamId;
};
const formationSlot = (payload: AgentPayload, key: string, teamId: string) => {
  const slotKey = requiredString(payload, key);
  const [row, column] = slotKey.split('-').map(Number);
  const slot = getSlotsForFormation(state().teams[teamId].activeFormation)[row]?.[column];
  if (!slot || slotKey !== `${row}-${column}`) throw new Error(`Invalid formation slot ${slotKey}`);
  return { slotKey, slot };
};
const pagination = (payload: AgentPayload) => {
  const limit = readPositiveInteger(payload, 'limit') ?? 20;
  const offset = readNumber(payload, 'offset', 0);
  if (limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('limit must be 1–100 and offset a nonnegative safe integer');
  return { limit, offset };
};
const searchText = (payload: AgentPayload) => {
  const search = payload?.search ?? '';
  if (typeof search !== 'string') throw new Error('search must be a string');
  return search.trim().toLowerCase();
};
const describePlayer = (player: Player) => ({
  ...player, rating: player.overallRating, unavailable: isPlayerUnavailable(player),
  renewalOffer: getRenewalOffer(player),
});
const queryPlayers = (payload: AgentPayload) => {
  const current = state();
  const { limit, offset } = pagination(payload);
  const category = readString(payload, 'category') ?? 'squad';
  if (!['squad', 'market', 'external', 'freeAgents', 'all'].includes(category)) throw new Error('Unknown player category');
  const teamId = readString(payload, 'teamId') ?? current.userTeamId;
  if (teamId && !current.teams[teamId]) throw new Error(`Unknown club ${teamId}`);
  const position = readString(payload, 'position');
  if (position && !['GK', 'DEF', 'MID', 'FWD'].includes(position)) throw new Error('position must be GK, DEF, MID or FWD');
  const search = searchText(payload);
  const players = Object.values(current.players).filter(player => (
    (category !== 'squad' || player.teamId === teamId) &&
    (category !== 'market' || (player.isTransferListed && player.teamId !== current.userTeamId)) &&
    (category !== 'external' || (player.teamId !== current.userTeamId && player.teamId !== FREE_AGENT_TEAM_ID)) &&
    (category !== 'freeAgents' || player.teamId === FREE_AGENT_TEAM_ID) &&
    (!position || player.position === position) &&
    (!search || `${player.name} ${player.id} ${current.teams[player.teamId]?.name ?? ''}`.toLowerCase().includes(search))
  )).sort((a, b) => b.overallRating - a.overallRating);
  return { category, total: players.length, offset, limit, players: players.slice(offset, offset + limit).map(describePlayer) };
};
const queryTeams = (payload: AgentPayload) => {
  const { limit, offset } = pagination(payload);
  const search = searchText(payload);
  const teams = Object.values(state().teams).filter(team => !team.isExternal && (!search || `${team.id} ${team.name} ${team.division}`.toLowerCase().includes(search)));
  return { total: teams.length, offset, limit, teams: teams.slice(offset, offset + limit) };
};
const liveProgress = (fixture: Fixture) => {
  const current = state();
  const live = current.liveMatches[fixture.id];
  const completedMinute = fixture.scoreBreakdown ? 120 : 90;
  const minute = fixture.isPlayed && ['regular', 'extra_time', 'penalties'].includes(fixture.resolution ?? 'regular')
    ? completedMinute : Math.max(0, ...(live?.processedMinutes ?? []));
  const tie = getDecisiveTieScore(fixture, current.fixtures);
  const maxMinute = fixture.scoreBreakdown || live?.extraTimeStarted || (minute >= 90 && tie.isDecisive && tie.homeScore === tie.awayScore) ? 120 : 90;
  return {
    fixture, minute, nextMinute: fixture.isPlayed || minute >= maxMinute ? null : minute + 1, maxMinute,
    aggregate: tie, live: live ?? null,
  };
};
const liveDetails = (fixture: Fixture) => ({
  ...liveProgress(fixture),
  players: Object.values(state().players).filter(player => player.teamId === fixture.homeTeamId || player.teamId === fixture.awayTeamId).map(describePlayer),
});
const advanceOneWeek = () => {
  const week = state().currentWeek;
  const season = getInboxSeason(state().competitions);
  state().advanceWeek();
  return state().currentWeek !== week || getInboxSeason(state().competitions) !== season;
};

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
  const userTeamId = current.userTeamId;
  if (!userTeamId) throw new Error('No managed team selected');
  if (fixtureId) {
    const fixture = current.fixtures[fixtureId];
    if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);
    assertManagedDueFixture(fixture);
    return fixture;
  }

  const fixture = getNextDueFixture(current.fixtures, userTeamId, current.currentWeek);
  if (!fixture) throw new Error('No unplayed fixture found');
  return fixture;
};

export const buildAgentGameSummary = (): AgentGameSummary => {
  const current = state();
  const userTeam = current.userTeamId ? current.teams[current.userTeamId] : undefined;
  const playedFixtures = Object.values(current.fixtures).filter(fixture => fixture.isPlayed).length;
  const nextFixture = getNextDueFixture(current.fixtures, current.userTeamId, current.currentWeek) || undefined;

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
    if (!Number.isFinite(player.energy) || !Number.isFinite(player.morale)) addIssue('error', 'Player energy or morale is not finite', player.id);
    if (player.energy < 0 || player.energy > 100) addIssue('warning', `Player energy outside 0-100: ${player.energy}`, player.id);
    if (player.morale < 0 || player.morale > 100) addIssue('warning', `Player morale outside 0-100: ${player.morale}`, player.id);
  });

  Object.values(current.teams).forEach(team => {
    if (!Number.isFinite(team.budget)) addIssue('error', `Team budget is not finite: ${team.budget}`, team.id);
    if (!Number.isFinite(team.transferSpend)) addIssue('error', `Team transfer spend is not finite: ${team.transferSpend}`, team.id);
    if (!Number.isFinite(team.boardApproval)) addIssue('error', 'Board approval is not finite', team.id);
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
        addIssue('error', `Formation slot ${slotKey} player is not marked starting`, player.id);
      }
    });
  });

  Object.values(current.fixtures).forEach(fixture => {
    if (!current.teams[fixture.homeTeamId]) addIssue('error', 'Fixture references missing home team', fixture.id);
    if (!current.teams[fixture.awayTeamId]) addIssue('error', 'Fixture references missing away team', fixture.id);
    if (fixture.week < current.currentWeek && !fixture.isPlayed) {
      addIssue('error', 'Fixture from a past week is still unplayed', fixture.id);
    }
    if (fixture.isPlayed && fixture.resolution !== 'void') {
      if (typeof fixture.homeScore !== 'number' || !Number.isFinite(fixture.homeScore)) addIssue('error', 'Played fixture has a missing or nonfinite home score', fixture.id);
      if (typeof fixture.awayScore !== 'number' || !Number.isFinite(fixture.awayScore)) addIssue('error', 'Played fixture has a missing or nonfinite away score', fixture.id);
      if (fixture.isKnockout && !fixture.winnerTeamId) addIssue('error', 'Played knockout fixture is missing winner', fixture.id);
    }
  });

  Object.entries(current.liveMatches || {}).forEach(([fixtureId, liveMatch]) => {
    const fixture = current.fixtures[fixtureId];
    if (!fixture) addIssue('error', 'Live match references missing fixture', fixtureId);
    if (fixture && (fixture.isPlayed || fixture.week < current.currentWeek)) {
      addIssue('error', 'Live match references a resolved or past fixture', fixtureId);
    }
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
  const { limit, offset } = pagination(payload);
  const teamId = readString(payload, 'teamId') || current.userTeamId || Object.keys(current.teams)[0];
  const team = teamId ? current.teams[teamId] : undefined;
  if (teamId && !team) throw new Error('Unknown club ' + teamId);
  const roster = queryPlayers({ ...payload, category: 'squad', teamId });
  const teamFixtures = Object.values(current.fixtures).filter(fixture => !teamId || fixture.homeTeamId === teamId || fixture.awayTeamId === teamId).sort(compareFixturesChronologically);
  const fixtureId = readString(payload, 'fixtureId');
  const fixture = fixtureId ? current.fixtures[fixtureId] : teamFixtures.find(item => !item.isPlayed);
  if (fixtureId && !fixture) throw new Error('Unknown fixture ' + fixtureId);
  const upcoming = teamFixtures.filter(item => !item.isPlayed);
  return detach({
    summary: buildAgentGameSummary(), validation: validateAgentGameState(),
    team: team ? { ...team, formation: team.activeFormation, record: team.wins + '-' + team.draws + '-' + team.losses } : null,
    formationSlots: team ? getSlotsForFormation(team.activeFormation).flatMap((row, rowIndex) => row.map((slot, column) => ({
      ...slot, slotKey: rowIndex + '-' + column, playerId: team.formationMap?.[rowIndex + '-' + column] ?? null,
      role: team.playerRoles?.[rowIndex + '-' + column] ?? 'default', roles: getCompatiblePlayerRolesForSlot(slot.label),
    }))) : [],
    squad: roster.players, squadTotal: roster.total, offset, limit,
    fixtures: upcoming.slice(offset, offset + limit).map(fixtureSummary), fixturesTotal: upcoming.length,
    recentResults: teamFixtures.filter(item => item.isPlayed).reverse().slice(offset, offset + limit).map(fixtureSummary),
    recentResultsTotal: teamFixtures.filter(item => item.isPlayed).length,
    match: fixture ? liveDetails(fixture) : null,
    inboxMessages: current.inboxMessages.slice(offset, offset + limit).map(message => ({ ...message, actionType: message.action?.type })), inboxTotal: current.inboxMessages.length,
    pendingNegotiations: current.pendingNegotiations ?? [],
    boardObjectives: current.boardObjectives, careerRecord: current.careerRecord,
    competitions: current.competitions, news: current.news.slice(0, limit),
  });
};

const getInitialTeamId = () => Object.keys(initGameData().teams)[0];

const applyAssistantActions = (payload: AgentPayload) => {
  const current = state();
  const userTeamId = current.userTeamId;
  if (payload?.types !== undefined && (!Array.isArray(payload.types) || !payload.types.every(type => typeof type === 'string' && ['apply_lineup', 'apply_tactics', 'renew_contract', 'accept_job_offer', 'accept_transfer_counter', 'withdraw_transfer_negotiation'].includes(type)))) {
    throw new Error('types must be an array of known inbox action types');
  }
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
  if (state().liveMatches[fixture.id]?.initialized) throw new Error('This fixture has an active live match. Resume it or use finishLiveMatch.');
  state().playMatch(fixture.id);
  return fixtureSummary(state().fixtures[fixture.id]);
};

const liveSimNext = (payload: AgentPayload) => {
  const fixture = getNextFixture(readString(payload, 'fixtureId'));
  const finish = readBoolean(payload, 'finish', true);
  if (fixture.isPlayed) throw new Error(`Fixture ${fixture.id} is already played`);

  const events: { minute: number; event: string }[] = [];
  const progress = liveProgress(fixture);
  const nextMinute = progress.nextMinute ?? 121;
  let completedMinute = progress.minute;
  for (let minute = nextMinute; minute <= 120; minute += 1) {
    const latest = state().fixtures[fixture.id];
    if (latest.isPlayed || minute > liveProgress(latest).maxMinute) break;
    const result = state().processMatchMinute(fixture.id, minute);
    completedMinute = minute;
    if (result.event) events.push({ minute, event: result.event });
  }

  if (finish && !state().fixtures[fixture.id].isPlayed) {
    state().finishLiveMatch(fixture.id);
  }

  return {
    fixture: fixtureSummary(state().fixtures[fixture.id]),
    events,
    liveMatchActive: Boolean(state().liveMatches[fixture.id]),
    minute: completedMinute,
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
  record('advance week', () => state().advanceWeek());
  record('quick sim', () => { quickSimNext(undefined); });
  record('settle quick-sim week', () => state().advanceWeek());
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
  const maxWeeks = readPositiveInteger(payload, 'maxWeeks') ?? 80;
  if (maxWeeks > 100) throw new Error('maxWeeks must be at most 100');

  if (reset || Object.keys(state().teams).length === 0) {
    state().initializeGame(playableTeamId(requestedTeamId || getInitialTeamId()), readPositiveInteger(payload, 'seed'));
  } else if (requestedTeamId) {
    state().changeTeam(playableTeamId(requestedTeamId));
  }

  const startedAt = buildAgentGameSummary();
  const startingSeason = getInboxSeason(state().competitions);
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
  let blocked = false;

  while (weeksPlayed < maxWeeks) {
    if (applyAssistantBeforeWeeks) applyAssistantActions(undefined);

    const before = buildAgentGameSummary();
    if (!advanceOneWeek()) { blocked = true; break; }
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

    if (getInboxSeason(state().competitions) > startingSeason) {
      completedSeason = true;
      break;
    }
  }

  const finalValidation = validateAgentGameState();

  return {
    status: firstFailure ? 'fail' : blocked ? 'blocked' : completedSeason ? 'pass' : 'incomplete',
    completedSeason,
    weeksPlayed,
    maxWeeks,
    startedAt,
    finishedAt: buildAgentGameSummary(),
    weeklyReports,
    firstFailure,
    blocked,
    finalValidation,
  };
};

const AI_POLICIES: AIPolicyMode[] = ['aggressive', 'balanced', 'passive'];
const AI_VERBOSITIES: AIPlayVerbosity[] = ['quiet', 'summary', 'detailed'];

const readAiPolicy = (payload: AgentPayload): AIPolicyMode => {
  const value = readString(payload, 'policy');
  if (value && !AI_POLICIES.includes(value as AIPolicyMode)) throw new Error('Unknown AI policy');
  return (value ?? 'balanced') as AIPolicyMode;
};

const readAiVerbosity = (payload: AgentPayload): AIPlayVerbosity => {
  const value = readString(payload, 'verbosity');
  if (value && !AI_VERBOSITIES.includes(value as AIPlayVerbosity)) throw new Error('Unknown AI verbosity');
  return (value ?? 'summary') as AIPlayVerbosity;
};

const buildAiPlayConfig = (payload: AgentPayload): AIPlayConfig => ({
  seasons: readPositiveInteger(payload, 'seasons') ?? 1,
  seed: readPositiveInteger(payload, 'seed') ?? 12091,
  teamId: playableTeamId(readString(payload, 'teamId') || getInitialTeamId()),
  policy: readAiPolicy(payload),
  stopOnError: readBoolean(payload, 'stopOnError', true),
  reportBalanceFlags: readBoolean(payload, 'reportBalanceFlags', true),
  verbosity: readAiVerbosity(payload),
});

const getPlayerTeamChanges = (
  beforePlayers: Record<string, Player>,
  afterPlayers: Record<string, Player>
) => Object.values(afterPlayers).filter(player => (
  beforePlayers[player.id] && beforePlayers[player.id].teamId !== player.teamId
)).length;

const getTeamFinancialHealth = (teams: Record<string, Team>): AIPlayReport['summary']['financialHealth'] => {
  const playableTeams = Object.values(teams).filter(team => !team.isExternal);
  if (playableTeams.some(team => team.budget < 0 || (team.operatingBudget ?? team.budget) < 0)) return 'bankrupt';
  if (playableTeams.some(team => team.budget < 2 || (team.operatingBudget ?? team.budget) < 2)) return 'strained';
  return 'healthy';
};

const buildBugReport = (
  type: BugReport['type'],
  message: string,
  error?: unknown,
  validation?: AgentValidationReport
): BugReport => ({
  week: state().currentWeek,
  type,
  message,
  stack: error instanceof Error ? error.stack : undefined,
  stateHash: getStateHash(),
  stateSnapshot: buildAgentGameSummary(),
  issues: validation?.issues,
});

const collectBalanceFlags = ({
  playedFixtureIdsBefore,
  seasonStartRatings,
  checkProgression,
}: {
  playedFixtureIdsBefore: Set<string>;
  seasonStartRatings: Record<string, number>;
  checkProgression: boolean;
}): BalanceFlag[] => {
  const current = state();
  const flags: BalanceFlag[] = [];

  Object.values(current.fixtures)
    .filter(fixture => fixture.isPlayed && !playedFixtureIdsBefore.has(fixture.id))
    .forEach(fixture => {
      const totalGoals = (fixture.homeScore ?? 0) + (fixture.awayScore ?? 0);
      if (totalGoals > 8) {
        flags.push({
          week: current.currentWeek,
          type: 'scoreline',
          entity: fixture.id,
          message: `High-scoring fixture finished with ${totalGoals} total goals.`,
          context: { homeScore: fixture.homeScore, awayScore: fixture.awayScore },
        });
      }

      const homeStats = fixture.matchSummary?.homeTeamStats;
      const awayStats = fixture.matchSummary?.awayTeamStats;
      if (homeStats && homeStats.goals > homeStats.shotsOnTarget) {
        flags.push({
          week: current.currentWeek,
          type: 'match_stats',
          entity: fixture.id,
          message: 'Home goals exceeded shots on target.',
          context: homeStats,
        });
      }
      if (awayStats && awayStats.goals > awayStats.shotsOnTarget) {
        flags.push({
          week: current.currentWeek,
          type: 'match_stats',
          entity: fixture.id,
          message: 'Away goals exceeded shots on target.',
          context: awayStats,
        });
      }
    });

  Object.values(current.teams).forEach(team => {
    const operatingBudget = team.operatingBudget ?? team.budget;
    if (team.budget < -0.01 || operatingBudget < -0.01) {
      flags.push({
        week: current.currentWeek,
        type: 'finances',
        entity: team.id,
        message: `${team.name} has negative financial reserves.`,
        context: { budget: team.budget, operatingBudget },
      });
    }
    if (team.played !== team.wins + team.draws + team.losses) {
      flags.push({
        week: current.currentWeek,
        type: 'league_table',
        entity: team.id,
        message: `${team.name} table record does not add up.`,
        context: { played: team.played, wins: team.wins, draws: team.draws, losses: team.losses },
      });
    }
    if (team.points !== team.wins * 3 + team.draws) {
      flags.push({
        week: current.currentWeek,
        type: 'league_table',
        entity: team.id,
        message: `${team.name} points do not match the 3-1-0 formula.`,
        context: { points: team.points, wins: team.wins, draws: team.draws },
      });
    }
  });

  if (checkProgression) {
    Object.values(current.players).forEach(player => {
      const startRating = seasonStartRatings[player.id];
      if (startRating !== undefined && player.overallRating - startRating > 10) {
        flags.push({
          week: current.currentWeek,
          type: 'progression',
          entity: player.id,
          message: `${player.name} gained more than 10 OVR in one season.`,
          context: { startRating, currentRating: player.overallRating },
        });
      }
    });
  }

  return flags;
};

const buildSeasonStartRatings = () => Object.fromEntries(
  Object.values(state().players).map(player => [player.id, player.overallRating])
);

const getAiPolicyGameState = (): AIPolicyGameState => ({
  ...state(),
  getAiState: getAiPolicyGameState,
});

const buildAiPlaySummary = (
  initialSeasonHistoryLength: number,
  transfersMade: number,
  matchTotals: { played: number; goals: number }
): AIPlayReport['summary'] => {
  const current = state();
  const newSeasonSummaries = current.careerRecord.seasonHistory.slice(initialSeasonHistoryLength);

  return {
    avgGoalsPerMatch: matchTotals.played > 0 ? Number((matchTotals.goals / matchTotals.played).toFixed(2)) : 0,
    promotions: newSeasonSummaries.filter(summary => summary.outcome === 'promoted').length,
    relegations: newSeasonSummaries.filter(summary => summary.outcome === 'relegated').length,
    sackings: newSeasonSummaries.filter(summary => summary.outcome === 'sacked').length,
    transfersMade,
    financialHealth: getTeamFinancialHealth(current.teams),
  };
};

const playWithAIState = (config: AIPlayConfig, maxWeeks: number): AIPlayReport => {
  state().initializeGame(config.teamId, config.seed);

  const bugs: BugReport[] = [];
  const balanceFlags: BalanceFlag[] = [];
  const initialSeasonHistoryLength = state().careerRecord.seasonHistory.length;
  const startingSeason = getInboxSeason(state().competitions);
  let seasonStartRatings = buildSeasonStartRatings();
  let lastSeasonMarker = startingSeason;
  let attempts = 0;
  let consecutiveErrors = 0;
  let weeksPlayed = 0;
  let transfersMade = 0;
  let playedMatches = 0;
  let totalGoals = 0;

  while (
    attempts < maxWeeks &&
    getInboxSeason(state().competitions) - startingSeason < config.seasons
  ) {
    attempts += 1;
    const beforePlayers = state().players;
    const playedFixtureIdsBefore = new Set(
      Object.values(state().fixtures).filter(fixture => fixture.isPlayed).map(fixture => fixture.id)
    );

    try {
      applyAssistantActions(undefined);
      runAiPreWeekPolicy(getAiPolicyGameState(), config);
      if (!advanceOneWeek()) throw new Error('Week advancement is blocked by an active live match.');
      weeksPlayed += 1;
      runAiPostWeekPolicy(getAiPolicyGameState(), config);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      bugs.push(buildBugReport('exception', errorMessage(error), error));
      if (config.stopOnError || consecutiveErrors >= 3) break;
    }

    transfersMade += getPlayerTeamChanges(beforePlayers, state().players);

    const validation = validateAgentGameState();
    if (validation.status === 'fail') {
      bugs.push(buildBugReport('validation', 'Agent validation failed during AI autoplay.', undefined, validation));
      if (config.stopOnError) break;
    }

    const seasonAdvanced = getInboxSeason(state().competitions) > lastSeasonMarker;
    const newlyPlayedFixtures = Object.values(state().fixtures).filter(fixture => (
      fixture.isPlayed && !playedFixtureIdsBefore.has(fixture.id)
    ));
    playedMatches += newlyPlayedFixtures.length;
    totalGoals += newlyPlayedFixtures.reduce((sum, fixture) => (
      sum + (fixture.homeScore ?? 0) + (fixture.awayScore ?? 0)
    ), 0);

    if (config.reportBalanceFlags) {
      balanceFlags.push(...collectBalanceFlags({
        playedFixtureIdsBefore,
        seasonStartRatings,
        checkProgression: seasonAdvanced,
      }));
    }

    if (seasonAdvanced) {
      seasonStartRatings = buildSeasonStartRatings();
      lastSeasonMarker = getInboxSeason(state().competitions);
    }
  }

  if (getInboxSeason(state().competitions) - startingSeason < config.seasons && bugs.length === 0) {
    bugs.push(buildBugReport('validation', 'Autoplay reached its attempt limit before completing the requested seasons.'));
  }

  return {
    seasons: config.seasons,
    weeksPlayed,
    bugs,
    balanceFlags,
    summary: buildAiPlaySummary(initialSeasonHistoryLength, transfersMade, {
      played: playedMatches,
      goals: totalGoals,
    }),
  };
};

const playWithAI = (payload: AgentPayload): AIPlayReport => {
  const config = buildAiPlayConfig(payload);
  if (config.seasons > 20) throw new Error('seasons must be at most 20');
  const maxWeeks = readPositiveInteger(payload, 'maxWeeks') ?? config.seasons * 120;
  if (maxWeeks > config.seasons * 120) throw new Error('maxWeeks exceeds the requested season bound');
  const originalRandom = Math.random;
  try {
    Math.random = createSeededRandomGenerator(config.seed).next;
    return playWithAIState(config, maxWeeks);
  } finally { Math.random = originalRandom; }
};

const runAgentCommand = (command: AgentCommand, payload?: AgentPayload): AgentCommandResult => {
  const before = buildAgentGameSummary();
  const beforeHash = getStateHash();
  try {
    if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) throw new Error('payload must be an object');
    let data: unknown;

    if (command === 'help') data = listAgentCommands();
    else if (command === 'summary') data = buildAgentGameSummary();
    else if (command === 'validate') data = validateAgentGameState();
    else if (command === 'snapshot') data = buildSnapshot(payload);
    else if (command === 'rawState') data = detach(state());
    else if (command === 'players') data = queryPlayers(payload);
    else if (command === 'teams') data = queryTeams(payload);
    else if (command === 'initialize') state().initializeGame(playableTeamId(readString(payload, 'teamId') ?? getInitialTeamId()), readPositiveInteger(payload, 'seed'));
    else if (command === 'changeTeam') state().changeTeam(playableTeamId(requiredString(payload, 'teamId')));
    else if (command === 'applyAssistantActions') data = applyAssistantActions(payload);
    else if (command === 'applyInboxAction' || command === 'markInboxRead' || command === 'dismissInbox') {
      const messageId = requiredString(payload, 'messageId');
      const message = state().inboxMessages.find(item => item.id === messageId);
      if (!message) throw new Error(`Unknown inbox message ${messageId}`);
      if (command === 'applyInboxAction') {
        if (!message.action) throw new Error('This inbox message has no action');
        state().applyInboxAction(messageId);
      } else if (command === 'markInboxRead') state().markInboxMessageRead(messageId);
      else state().dismissInboxMessage(messageId);
    }
    else if (command === 'advanceWeek') {
      const count = readPositiveInteger(payload, 'count') ?? 1;
      const allowLargeCount = readBoolean(payload, 'allowLargeCount', false);
      if (count > 100) throw new Error('advanceWeek count must be at most 100');
      if (count > 26 && !allowLargeCount) {
        throw new Error('advanceWeek count over 26 requires allowLargeCount: true');
      }
      let advancedWeeks = 0;
      while (advancedWeeks < count && advanceOneWeek()) advancedWeeks += 1;
      data = { advancedWeeks, requestedWeeks: count, success: advancedWeeks === count,
        message: advancedWeeks === count ? 'Weeks advanced.' : 'Finish the active live match before advancing.' };
    } else if (command === 'skipSeason') state().skipToEndOfSeason();
    else if (command === 'clearStuckLiveMatch') data = { cleared: state().clearStuckLiveMatches() };
    else if (command === 'quickSimNext') data = quickSimNext(payload);
    else if (command === 'liveSimNext') data = liveSimNext(payload);
    else if (command === 'processLiveMinute') {
      const fixtureId = readString(payload, 'fixtureId');
      if (!fixtureId) throw new Error('processLiveMinute requires fixtureId');
      const fixture = state().fixtures[fixtureId];
      if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);
      assertManagedDueFixture(fixture);
      const minute = readPositiveInteger(payload, 'minute') ?? 1;
      const progress = liveProgress(fixture);
      if (minute > progress.maxMinute) throw new Error(`processLiveMinute minute must be from 1 to ${progress.maxMinute}`);
      if (minute !== progress.nextMinute && !progress.live?.processedMinutes?.includes(minute)) throw new Error(`Process the next minute (${progress.nextMinute}) first`);
      data = state().processMatchMinute(fixtureId, minute);
    } else if (command === 'finishLiveMatch') {
      const fixtureId = readString(payload, 'fixtureId');
      if (!fixtureId) throw new Error('finishLiveMatch requires fixtureId');
      const fixture = state().fixtures[fixtureId];
      if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);
      assertManagedDueFixture(fixture);
      state().finishLiveMatch(fixtureId);
    } else if (command === 'setFormation') {
      const teamId = readString(payload, 'teamId') || state().userTeamId;
      assertManagedTeam(teamId);
      const formation = readFormation(payload);
      state().setFormation(teamId, formation);
    } else if (command === 'setTactics') {
      const teamId = readString(payload, 'teamId') || state().userTeamId;
      assertManagedTeam(teamId);
      const tactics = readTactics(payload);
      state().setTactics(teamId, tactics);
    } else if (command === 'toggleStarting' || command === 'markAsSub') {
      const player = ownedPlayer(payload);
      if (command === 'toggleStarting') state().toggleStarting(player.id);
      else state().markAsSub(player.id);
    } else if (command === 'setTrainingFocus') {
      const player = ownedPlayer(payload);
      const focus = payload?.focus;
      if (focus !== null && !['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'].includes(focus as string)) throw new Error('focus must be a training attribute or null');
      state().setTrainingFocus(player.id, focus as StatKey | null);
    } else if (command === 'setPlayerRole') {
      const teamId = readString(payload, 'teamId') ?? state().userTeamId;
      assertManagedTeam(teamId);
      const { slotKey, slot } = formationSlot(payload, 'slotKey', teamId);
      const role = requiredString(payload, 'role') as PlayerRole;
      if (!getCompatiblePlayerRolesForSlot(slot.label).includes(role)) throw new Error(`Incompatible role for ${slot.label}`);
      state().setPlayerRole(teamId, slotKey, role);
    } else if (command === 'swapPlayer') {
      const player = ownedPlayer(payload, 'addId');
      const removeId = payload?.removeId == null ? null : ownedPlayer(payload, 'removeId').id;
      if (removeId === player.id) throw new Error('A player cannot replace himself');
      const map = state().teams[player.teamId].formationMap;
      const slotKey = payload?.slotKey === undefined
        ? Object.entries(map ?? {}).find(([, id]) => id === removeId)?.[0]
        : formationSlot(payload, 'slotKey', player.teamId).slotKey;
      if (player.isStarting && !slotKey) throw new Error('Replacing another starter requires a mapped formation slot');
      if (slotKey && (state().teams[player.teamId].formationMap?.[slotKey] ?? null) !== removeId) throw new Error('removeId must match the player currently in slotKey');
      state().swapPlayer(removeId, player.id, slotKey);
    } else if (command === 'swapStartingSlots') {
      const teamId = readString(payload, 'teamId') ?? state().userTeamId;
      assertManagedTeam(teamId);
      const slotA = formationSlot(payload, 'slotA', teamId);
      const slotB = formationSlot(payload, 'slotB', teamId);
      const map = state().teams[teamId].formationMap;
      const playerA = state().players[map?.[slotA.slotKey] ?? ''];
      const playerB = state().players[map?.[slotB.slotKey] ?? ''];
      if (!playerA || !playerB || playerA.teamId !== teamId || playerB.teamId !== teamId) throw new Error('Both slots must contain managed players');
      if ((playerA.position === 'GK') !== (slotB.slot.pos === 'GK') || (playerB.position === 'GK') !== (slotA.slot.pos === 'GK')) throw new Error('Goalkeepers must remain in goalkeeper slots');
      state().swapStartingSlots(teamId, slotA.slotKey, slotB.slotKey);
    } else if (command === 'approachPlayer' || command === 'signFreeAgent') {
      const playerId = requiredString(payload, 'playerId');
      if (!state().players[playerId]) throw new Error(`Unknown player ${playerId}`);
      data = command === 'approachPlayer' ? state().approachPlayer(playerId)
        : state().signFreeAgent(playerId, readNumber(payload, 'wageOffered', 0));
    } else if (command === 'submitTransferBid' || command === 'acceptTransferCounter' || command === 'withdrawTransferNegotiation') {
      const negotiationId = requiredString(payload, 'negotiationId');
      const negotiation = state().pendingNegotiations?.find(item => item.id === negotiationId);
      if (!negotiation || !['pending', 'countered'].includes(negotiation.status)) throw new Error('No active negotiation with that ID');
      if (command === 'submitTransferBid') data = state().submitTransferBid(negotiationId, readNumber(payload, 'fee', 0), readNumber(payload, 'wageOffered', 0));
      else if (command === 'acceptTransferCounter') data = state().acceptTransferCounter(negotiationId);
      else state().withdrawTransferNegotiation(negotiationId);
    } else if (command === 'makeLiveSubstitutions' || command === 'setLiveMatchFormation') {
      const fixture = getNextFixture(requiredString(payload, 'fixtureId'));
      const teamId = readString(payload, 'teamId') ?? state().userTeamId;
      assertManagedTeam(teamId);
      if (command === 'setLiveMatchFormation') data = state().setLiveMatchFormation(fixture.id, teamId, readFormation(payload));
      else {
        const replacements = payload?.replacements;
        if (!Array.isArray(replacements) || replacements.length < 1 || replacements.length > 5) throw new Error('replacements must contain 1–5 player pairs');
        const pairs = replacements.map(pair => {
          if (!pair || typeof pair !== 'object' || Array.isArray(pair)) throw new Error('Invalid substitution pair');
          return { offPlayerId: ownedPlayer(pair, 'offPlayerId').id, onPlayerId: ownedPlayer(pair, 'onPlayerId').id };
        });
        data = state().makeLiveSubstitutions(fixture.id, pairs);
      }
    } else if (command === 'listPlayer') {
      const player = ownedPlayer(payload);
      const askingPrice = readNumber(payload, 'askingPrice', 1);
      if (askingPrice <= 0) throw new Error('askingPrice must be positive');
      state().listPlayerForSale(player.id, askingPrice);
    } else if (command === 'unlistPlayer') {
      const playerId = readString(payload, 'playerId');
      if (!playerId) throw new Error('unlistPlayer requires playerId');
      assertManagedTeam(state().players[playerId]?.teamId);
      state().unlistPlayer(playerId);
    } else if (command === 'buyPlayer') {
      const playerId = readString(payload, 'playerId');
      if (!playerId) throw new Error('buyPlayer requires playerId');
      data = state().buyPlayer(playerId, readNumber(payload, 'fee', 0), readNumber(payload, 'wageOffered', 0));
    } else if (command === 'renewContract') {
      const player = ownedPlayer(payload);
      data = state().renewPlayerContract(player.id, readNumber(payload, 'years', 1), readNumber(payload, 'wage', 1));
    } else if (command === 'playSeason') data = playSeason(payload);
    else if (command === 'playWithAI') data = playWithAI(payload);
    else if (command === 'smokeCheck') data = runSmokeCheck();
    else throw new Error(`Unknown agent command ${command}`);

    const stateHash = getStateHash();
    const changed = stateHash !== beforeHash;
    if (!changed && ['toggleStarting', 'markAsSub', 'swapPlayer'].includes(command)) throw new Error('Action rejected by lineup eligibility or capacity rules');
    const result = data as { success?: boolean; message?: string } | undefined;
    const ok = result?.success !== false;
    return { ok, command, data: data === undefined ? undefined : detach(data), error: ok ? undefined : result?.message, before, after: buildAgentGameSummary(), stateHash, changed };
  } catch (error) {
    const stateHash = getStateHash();
    return { ok: false, command, error: errorMessage(error), before, after: buildAgentGameSummary(), stateHash, changed: stateHash !== beforeHash };
  }
};

export const installAgentGameHandler = () => {
  const handler: AgentGameHandler = {
    version: 2,
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

import { existsSync } from 'fs';
import { installAgentGameHandler } from '../../src/dev/agentGameHandler';
import { runAiPreWeekPolicy } from '../../src/dev/aiPolicy';
import type { Player } from '../../src/models/types';
import { assert, buildTestPlayer, buildTestTeam, initGameData, readSource } from './shared';

type AgentRunner = (command: string, payload?: Record<string, unknown>) => {
  ok: boolean;
  data?: unknown;
  error?: string;
};

type AIPlayReportShape = {
  seasons: number;
  weeksPlayed: number;
  bugs: unknown[];
  balanceFlags: unknown[];
  summary: {
    avgGoalsPerMatch: number;
    promotions: number;
    relegations: number;
    sackings: number;
    transfersMade: number;
    financialHealth: string;
  };
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const checkAiAutoplayCommandProducesReport = () => {
  const cleanup = installAgentGameHandler();
  try {
    const runner = globalThis.__FM_AGENT__?.run as AgentRunner | undefined;
    if (!runner) throw new Error('Expected agent handler to be installed');
    const help = runner('help');
    assert(help.ok, `Expected help command to succeed: ${help.error ?? 'unknown error'}`);
    assert(
      Array.isArray(help.data) && help.data.some(item => isObject(item) && item.command === 'playWithAI'),
      'Agent help should expose the playWithAI command'
    );

    const result = runner('playWithAI', {
      seasons: 1,
      seed: 12091,
      teamId: 'T1',
      policy: 'balanced',
      stopOnError: true,
      reportBalanceFlags: true,
      verbosity: 'quiet',
    });

    assert(result.ok, `Expected playWithAI command to succeed: ${result.error ?? 'unknown error'}`);
    const report = result.data as AIPlayReportShape;
    assert(report.seasons === 1, 'AI play report should echo requested season count');
    assert(report.weeksPlayed > 0, 'AI play report should advance at least one week');
    assert(Array.isArray(report.bugs), 'AI play report should include a bugs array');
    assert(report.bugs.length === 0, 'One-season balanced AI smoke run should not report integrity bugs');
    assert(Array.isArray(report.balanceFlags), 'AI play report should include a balanceFlags array');
    assert(report.summary.avgGoalsPerMatch > 0, 'AI play report should average goals across the whole autoplay run');
    assert(Number.isInteger(report.summary.promotions), 'AI play report should count promotions');
    assert(Number.isInteger(report.summary.relegations), 'AI play report should count relegations');
    assert(Number.isInteger(report.summary.sackings), 'AI play report should count sackings');
    assert(Number.isInteger(report.summary.transfersMade), 'AI play report should count transfer activity');
    assert(
      ['healthy', 'strained', 'bankrupt'].includes(report.summary.financialHealth),
      'AI play report should classify financial health'
    );
  } finally {
    cleanup();
  }
};

export const checkAiAutoplayRunnerScriptsExist = () => {
  const packageJson = JSON.parse(readSource('package.json')) as { scripts?: Record<string, string> };
  assert(existsSync('scripts/ai_autoplay.ts'), 'AI autoplay runner script should exist');
  assert(packageJson.scripts?.['ai:play']?.includes('scripts/ai_autoplay.ts'), 'package.json should define ai:play');
  assert(packageJson.scripts?.['ai:play:long']?.includes('scripts/ai_autoplay.ts'), 'package.json should define ai:play:long');
  assert(packageJson.scripts?.['ai:play:stress']?.includes('scripts/ai_autoplay.ts'), 'package.json should define ai:play:stress');
};

export const checkAiAutoplayRotationDoesNotReuseBenchPlayer = () => {
  const data = initGameData('T1');
  const templateTeam = data.teams.T1;
  const templatePlayer = Object.values(data.players).find(player => player.teamId === 'T1');
  assert(templateTeam && templatePlayer, 'Expected templates for AI autoplay rotation regression');

  const team = buildTestTeam(templateTeam, 'ai-team', 'AI Team', {
    activeFormation: '4-3-3',
    manager: { preferredFormations: ['4-3-3'] },
    formationMap: {
      '0-0': 'starter-a',
      '0-1': 'starter-b',
    },
  });
  const players: Record<string, Player> = {
    'starter-a': buildTestPlayer(templatePlayer!, 'starter-a', team.id, 'MID', 72, {
      energy: 35,
      isStarting: true,
    }),
    'starter-b': buildTestPlayer(templatePlayer!, 'starter-b', team.id, 'MID', 71, {
      energy: 36,
      isStarting: true,
    }),
    'fresh-mid': buildTestPlayer(templatePlayer!, 'fresh-mid', team.id, 'MID', 74, {
      energy: 95,
      isSub: true,
    }),
    'backup-mid': buildTestPlayer(templatePlayer!, 'backup-mid', team.id, 'MID', 70, {
      energy: 92,
      isSub: true,
    }),
  };
  const swappedIn: string[] = [];

  runAiPreWeekPolicy({
    currentWeek: 1,
    userTeamId: team.id,
    teams: { [team.id]: team },
    players,
    fixtures: {},
    competitions: {},
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    boardReviewAppliedWeek: 0,
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
    liveMatches: {},
    setFormation: () => undefined,
    setTactics: () => undefined,
    swapPlayer: (removeId, addId) => {
      swappedIn.push(addId);
      if (removeId) players[removeId] = { ...players[removeId], isStarting: false, isSub: true };
      players[addId] = { ...players[addId], isStarting: true, isSub: false };
    },
    setTrainingFocus: () => undefined,
    buyPlayer: () => ({ success: false, message: 'not needed' }),
    signFreeAgent: () => ({ success: false, message: 'not needed' }),
    listPlayerForSale: () => undefined,
    renewPlayerContract: () => ({ success: false, message: 'not needed' }),
    applyInboxAction: () => undefined,
    makeLiveSubstitutions: () => ({ success: false, message: 'not needed' }),
  }, {
    seasons: 1,
    seed: 12091,
    teamId: team.id,
    policy: 'passive',
    stopOnError: true,
    reportBalanceFlags: true,
    verbosity: 'quiet',
  });

  assert(swappedIn.length === new Set(swappedIn).size, 'AI rotation should not reuse the same bench player for multiple tired starters');
};

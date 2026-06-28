import { existsSync } from 'fs';
import { installAgentGameHandler } from '../../src/dev/agentGameHandler';
import { assert, readSource } from './shared';

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

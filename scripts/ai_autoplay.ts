import { installAgentGameHandler } from '../src/dev/agentGameHandler';
import type { AIPlayConfig, AIPlayReport } from '../src/dev/aiPolicy';

type AgentRunner = (command: string, payload?: Record<string, unknown>) => {
  ok: boolean;
  data?: unknown;
  error?: string;
};

const readArg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
};

const readNumberArg = (name: string, fallback: number) => {
  const value = Number(readArg(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const readBooleanArg = (name: string, fallback: boolean) => {
  const value = readArg(name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const readChoiceArg = <T extends string>(name: string, choices: readonly T[], fallback: T): T => {
  const value = readArg(name);
  return choices.includes(value as T) ? value as T : fallback;
};

const config: AIPlayConfig = {
  seasons: readNumberArg('seasons', 3),
  seed: readNumberArg('seed', 12091),
  teamId: readArg('teamId') || 'T1',
  policy: readChoiceArg('policy', ['aggressive', 'balanced', 'passive'] as const, 'balanced'),
  stopOnError: readBooleanArg('stopOnError', true),
  reportBalanceFlags: readBooleanArg('reportBalanceFlags', true),
  verbosity: readChoiceArg('verbosity', ['quiet', 'summary', 'detailed'] as const, 'summary'),
};

const cleanup = installAgentGameHandler();

try {
  const run = globalThis.__FM_AGENT__?.run as AgentRunner | undefined;
  if (!run) {
    throw new Error('Agent handler was not installed.');
  }
  const result = run('playWithAI', { ...config });
  if (!result.ok) {
    console.error(`AI autoplay failed to start: ${result.error || 'unknown error'}`);
    process.exitCode = 1;
  } else {
    const report = result.data as AIPlayReport;
    console.log(
      [
        `AI autoplay complete: ${report.weeksPlayed} weeks across ${report.seasons} requested season(s).`,
        `Bugs: ${report.bugs.length}`,
        `Balance flags: ${report.balanceFlags.length}`,
        `Average goals: ${report.summary.avgGoalsPerMatch}`,
        `Transfers: ${report.summary.transfersMade}`,
        `Financial health: ${report.summary.financialHealth}`,
      ].join('\n')
    );
    console.log(JSON.stringify(report, null, 2));
    if (report.bugs.length > 0) process.exitCode = 1;
  }
} finally {
  cleanup();
}

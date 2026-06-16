import { installAgentGameHandler } from '../src/dev/agentGameHandler';

type SeasonPlaythroughResult = {
  status?: string;
  completedSeason?: boolean;
  weeksPlayed?: number;
  finalValidation?: {
    status?: string;
    errors?: number;
    warnings?: number;
    issues?: unknown[];
  };
  finishedAt?: unknown;
  firstFailure?: unknown;
};

const cleanup = installAgentGameHandler();
const result = globalThis.__FM_AGENT__?.run('playSeason', {
  reset: true,
  applyAssistantActions: true,
});
const data = result?.data as SeasonPlaythroughResult | undefined;

console.log(JSON.stringify({
  ok: Boolean(result?.ok),
  status: data?.status,
  completedSeason: data?.completedSeason,
  weeksPlayed: data?.weeksPlayed,
  finalValidation: data?.finalValidation
    ? {
      status: data.finalValidation.status,
      errors: data.finalValidation.errors,
      warnings: data.finalValidation.warnings,
      issueSample: data.finalValidation.issues?.slice(0, 10),
    }
    : undefined,
  finishedAt: data?.finishedAt,
  firstFailure: data?.firstFailure,
  error: result?.error,
}, null, 2));

cleanup();

if (
  !result?.ok ||
  data?.status !== 'pass' ||
  !data.completedSeason ||
  data.finalValidation?.status !== 'pass'
) {
  process.exit(1);
}

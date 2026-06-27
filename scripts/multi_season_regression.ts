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

const args = process.argv.slice(2);
const seasonCount = Math.max(1, Math.min(10, parseInt(args.find(arg => arg.startsWith('--seasons='))?.split('=')[1] || '5', 10)));

const cleanup = installAgentGameHandler();

let totalOk = true;
const seasonResults: unknown[] = [];

for (let season = 1; season <= seasonCount; season++) {
  const reset = season === 1;
  const result = globalThis.__FM_AGENT__?.run('playSeason', {
    reset,
    applyAssistantActions: true,
  });
  const data = result?.data as SeasonPlaythroughResult | undefined;

  const seasonOk = Boolean(result?.ok) &&
    data?.status === 'pass' &&
    Boolean(data.completedSeason) &&
    data?.finalValidation?.status === 'pass';

  seasonResults.push({
    season,
    ok: seasonOk,
    weeksPlayed: data?.weeksPlayed,
    errors: data?.finalValidation?.errors,
    issues: data?.finalValidation?.issues,
    firstFailure: data?.firstFailure,
    status: data?.status,
    validationStatus: data?.finalValidation?.status,
  });

  if (!seasonOk) {
    totalOk = false;
    console.error(`Season ${season} FAILED: status=${data?.status}, completed=${data?.completedSeason}, validation=${data?.finalValidation?.status}, errors=${data?.finalValidation?.errors}`);
    if (data?.finalValidation?.issues) console.error('Issues:', JSON.stringify(data.finalValidation.issues, null, 2));
    if (data?.firstFailure) console.error('First failure:', JSON.stringify(data.firstFailure, null, 2));
    if (result?.error) console.error('Error:', result.error);
    break;
  }
}

console.log(JSON.stringify({
  requestedSeasons: seasonCount,
  completedRuns: seasonResults.length,
  ok: totalOk,
  results: seasonResults,
}, null, 2));

cleanup();

if (!totalOk) {
  process.exit(1);
}

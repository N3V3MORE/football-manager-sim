import { CupState, TrophyCabinet, TrophyCompetition, TrophyHistoryEntry } from '../models/types';
import { TRACKED_TROPHY_COMPETITION_IDS } from './domainRegistry';

export const TRACKED_TROPHIES: TrophyCompetition[] = [...TRACKED_TROPHY_COMPETITION_IDS];

export const createEmptyTrophyCabinet = (): TrophyCabinet => (
  TRACKED_TROPHY_COMPETITION_IDS.reduce<TrophyCabinet>((acc, competitionId) => {
    acc[competitionId] = 0;
    return acc;
  }, {} as TrophyCabinet)
);

export const ensureTrophyCabinetShape = (
  cabinet?: Partial<TrophyCabinet> | null
): TrophyCabinet => {
  const shapedCabinet = createEmptyTrophyCabinet();
  Object.entries(cabinet || {}).forEach(([competitionId, trophyCount]) => {
    if (typeof trophyCount === 'number') {
      shapedCabinet[competitionId] = trophyCount;
    }
  });
  return shapedCabinet;
};

export const getCupWinnerTeamId = (
  cups: Record<string, CupState>,
  competitionId: string
) => {
  const cupState = cups[competitionId];
  if (!cupState?.completed) return undefined;
  return cupState.entrants.length === 1 ? cupState.entrants[0] : undefined;
};

export const recordTrophyWin = (
  trophyCabinet: TrophyCabinet,
  trophyHistory: TrophyHistoryEntry[],
  competitionId: TrophyCompetition,
  season: number,
  teamId: string,
  teamName: string
) => ({
  trophyCabinet: {
    ...trophyCabinet,
    [competitionId]: (trophyCabinet[competitionId] || 0) + 1,
  },
  trophyHistory: [
    { competitionId, competition: competitionId, season, teamId, teamName },
    ...trophyHistory,
  ].slice(0, 50),
});

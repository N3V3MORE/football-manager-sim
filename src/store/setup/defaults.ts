import { buildInitialCupStates } from '../../core/cupUtils';
import { createEmptyTrophyCabinet } from '../../core/trophyUtils';
import { GameStore } from '../types';

export const createStoreDefaults = (): Pick<
  GameStore,
  | 'currentWeek'
  | 'season'
  | 'userTeamId'
  | 'teams'
  | 'players'
  | 'fixtures'
  | 'cups'
  | 'trophyCabinet'
  | 'trophyHistory'
  | 'seasonResults'
  | 'news'
  | 'boardObjectives'
  | 'liveMatches'
  | 'isSeasonSkipInProgress'
> => ({
  currentWeek: 1,
  season: 1,
  userTeamId: null,
  teams: {},
  players: {},
  fixtures: {},
  cups: buildInitialCupStates({}),
  trophyCabinet: createEmptyTrophyCabinet(),
  trophyHistory: [],
  seasonResults: [],
  news: [],
  boardObjectives: [],
  liveMatches: {},
  isSeasonSkipInProgress: false,
});

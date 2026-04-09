import { Formation, GameState, TeamTactics } from '../models/types';

export type LiveMatchState = {
  initialized: boolean;
  yellowCardPlayerIds: string[];
  sentOffPlayerIds: string[];
  sentOffMinutes?: Record<string, number>;
  homeGoalMinutes?: number[];
  awayGoalMinutes?: number[];
  homeStarterIds: string[];
  awayStarterIds: string[];
};

export interface GameStore extends GameState {
  liveMatches: Record<string, LiveMatchState>;
  isSeasonSkipInProgress: boolean;
  initializeGame: (userTeamId: string) => void;
  advanceWeek: () => void;
  advanceMultipleWeeks: (weeks: number) => void;
  playMatch: (fixtureId: string) => void;
  setFormation: (teamId: string, formation: Formation) => void;
  toggleStarting: (playerId: string) => void;
  markAsSub: (playerId: string) => void;
  setTactics: (teamId: string, tactics: Partial<TeamTactics>) => void;
  swapPlayer: (removeId: string | null, addId: string, slotKey?: string) => void;
  swapStartingSlots: (teamId: string, slotA: string, slotB: string) => void;
  skipToEndOfSeason: () => void;
  changeTeam: (teamId: string) => void;
  buyPlayer: (playerId: string, fee: number, wageOffered: number) => { success: boolean; message: string };
  listPlayerForSale: (playerId: string, askingPrice: number) => void;
  unlistPlayer: (playerId: string) => void;
  processWeeklyTransfers: () => void;
  checkBoardObjectives: () => void;
  processMatchMinute: (fixtureId: string, minute: number) => { event: string | null };
  finishLiveMatch: (fixtureId: string) => void;
}

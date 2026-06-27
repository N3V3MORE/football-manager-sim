import type { Formation, Position } from './player';

/**
 * Per-match contribution counters accumulated during simulation. Moved to the
 * model layer so `LiveMatchState` (below) does not need to import from core.
 * `postMatchAccounting` re-exports this for existing callers.
 */
export type PlayerMatchContribution = {
  goals?: number;
  assists?: number;
  yellowCards?: number;
  redCards?: number;
};

export type MatchTeamSummaryStats = {
  teamId: string;
  goals: number;
  shots: number;
  shotsOnTarget: number;
  possessionShare?: number;
};

export type MatchPlayerSummaryRow = {
  playerId: string;
  teamId: string;
  name: string;
  position: Position;
  minutes: number;
  rating: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  started: boolean;
};

export type MatchSummary = {
  homeTeamId: string;
  awayTeamId: string;
  homeTeamStats: MatchTeamSummaryStats;
  awayTeamStats: MatchTeamSummaryStats;
  playerRows: MatchPlayerSummaryRow[];
  manOfTheMatchPlayerId?: string;
};

/**
 * Live (minute-by-minute) match runtime state, persisted between advances.
 * Lives in the model layer so store and engine code share one canonical type.
 */
export type LiveMatchState = {
  initialized: boolean;
  yellowCardPlayerIds: string[];
  sentOffPlayerIds: string[];
  sentOffMinutes?: Record<string, number>;
  homeGoalMinutes?: number[];
  awayGoalMinutes?: number[];
  matchContributions?: Record<string, PlayerMatchContribution>;
  homeShots?: number;
  awayShots?: number;
  homeShotsOnTarget?: number;
  awayShotsOnTarget?: number;
  homeStarterIds: string[];
  awayStarterIds: string[];
  currentHomePlayerIds?: string[];
  currentAwayPlayerIds?: string[];
  homeActiveFormation?: Formation;
  awayActiveFormation?: Formation;
  homeFormationMap?: Record<string, string>;
  awayFormationMap?: Record<string, string>;
  homeBenchIds?: string[];
  awayBenchIds?: string[];
  homeMinuteMap?: Record<string, number>;
  awayMinuteMap?: Record<string, number>;
  homeSubEntryMinutes?: Record<string, number>;
  awaySubEntryMinutes?: Record<string, number>;
  homeGoalkeeperId?: string;
  awayGoalkeeperId?: string;
  homeSubstitutionState?: {
    substitutesUsed: number;
    substitutionWindowsUsed: number;
    maxSubstitutes?: number;
    maxWindows?: number;
  };
  awaySubstitutionState?: {
    substitutesUsed: number;
    substitutionWindowsUsed: number;
    maxSubstitutes?: number;
    maxWindows?: number;
  };
  appliedSubstitutionCheckpoints?: number[];
  processedMinutes?: number[];
};

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type LeagueDivision = 'Premier League' | 'Championship' | 'League One' | 'League Two';
export type Division = LeagueDivision | 'Continental';
export type Formation =
  | '4-3-3'
  | '3-4-3'
  | '5-2-3'
  | '4-4-2'
  | '4-2-3-1'
  | '3-5-2'
  | '4-1-4-1'
  | '4-3-2-1'
  | '3-4-2-1'
  | '4-5-1'
  | '4-2-2-2'
  | '3-2-4-1';

export type SquadNeedSeverity = 'none' | 'watch' | 'need' | 'urgent';
type ContractDecisionType = 'renew' | 'sell' | 'release' | 'hold';

export interface TeamTactics {
  mentality: 'Defensive' | 'Balanced' | 'Attacking';
  passingStyle: 'Short' | 'Mixed' | 'Direct';
  tempo: 'Slow' | 'Normal' | 'Fast';
  defensiveLine: 'Deep' | 'Standard' | 'High';
  pressing: 'None' | 'Medium' | 'High';
}

interface PlayerStats {
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
  gk_diving?: number;
  gk_handling?: number;
  gk_kicking?: number;
  gk_reflexes?: number;
  gk_speed?: number;
  gk_positioning?: number;
  [key: string]: number | undefined; // For detailed micro-stats
}

export interface Player {
  id: string;
  name: string;
  longName?: string;
  position: Position;
  subPosition: string;      // primary FIFA position e.g. 'RB', 'RM', 'ST'
  altPositions: string[];   // all FIFA positions e.g. ['CAM', 'CM', 'LW']
  overallRating: number;
  marketValue: number;      // value in millions GBP e.g. 45.5
  age: number;
  morale: number;           // 0 to 100
  energy: number;           // 0 to 100
  teamId: string;
  isStarting: boolean;
  isSub: boolean;           // true = designated sub (bench)
  isTransferListed: boolean; // true = listed for sale
  askingPrice: number;      // asking price in millions GBP (0 if not listed)
  matchesSuspended: number; // dynamically used for suspensions
  /**
   * @deprecated No longer written by the match engines; kept on the type and
   * read-only in persistence for backward compatibility with older saves.
   * Same-match suspension skipping is driven by `suspensionAppliedFixtureId`.
   */
  suspensionAppliedWeek?: number;
  suspensionAppliedFixtureId?: string; // fixture that created the active suspension; avoids serving it in the same match
  injuryWeeks: number;      // full weeks unavailable through injury
  injuryAppliedWeek?: number; // week when the current injury was applied; skips decrement in same week
  injuryType?: string;
  wage: number;             // wage in thousands per week
  contractLeft: number;     // years remaining on contract
  impactCoefficient: number;// modifier for clutch/hero moments
  matchRatingHistory: number[]; // array of hidden ratings for each match
  minutesPlayed: number;        // total season minutes played
  goals: number;
  assists: number;
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
  nationality: string;
  playerTraits?: string;
  clubJerseyNumber?: number | null;
  stats: PlayerStats;
}

export type SquadNeed = {
  teamId: string;
  position: Position;
  severity: SquadNeedSeverity;
  reason: string;
  currentDepth: number;
  targetDepth: number;
  averageAge: number;
  wageLoad: number;
};

export type ContractDecision = {
  playerId: string;
  decision: ContractDecisionType;
  priority: number;
  reason: string;
};

export type SquadPlan = {
  teamId: string;
  needs: SquadNeed[];
  contractDecisions: ContractDecision[];
};

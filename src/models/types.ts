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

export type ManagerStatus = 'Permanent' | 'Interim' | 'Caretaker';
export type BoardAmbition = 'elite' | 'europe' | 'promotion' | 'stability' | 'survival';
export type BoardPatience = 'low' | 'medium' | 'high';
export type TransferDiscipline = 'strict' | 'balanced' | 'aggressive';
export type BoardReviewVerdict = 'thriving' | 'stable' | 'warning' | 'critical';
export type SquadNeedSeverity = 'none' | 'watch' | 'need' | 'urgent';
export type ContractDecisionType = 'renew' | 'sell' | 'release' | 'hold';
export type CompetitionId =
  | 'premier-league'
  | 'championship'
  | 'league-one'
  | 'league-two'
  | 'carabao-cup'
  | 'fa-cup'
  | 'europe';
export type CompetitionType = 'league' | 'domestic_cup' | 'continental';
export type CompetitionRoundKey =
  | 'league'
  | 'round_1'
  | 'round_2'
  | 'round_3'
  | 'round_4'
  | 'round_of_16'
  | 'quarter_final'
  | 'semi_final'
  | 'final';
export type CompetitionFinish = CompetitionRoundKey | 'winner' | 'runner_up' | 'not_qualified';
export type BoardObjectiveType = 'position' | 'goalDiff' | 'spend' | 'max_spend' | 'wins' | 'cup_round';

export interface ManagerRecord {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  position: number;
}

export interface BoardProfile {
  ambition: BoardAmbition;
  patience: BoardPatience;
  transferDiscipline: TransferDiscipline;
  targetCompetitions: CompetitionId[];
  identity: string;
}

export interface Manager {
  id: string;
  teamId: string;
  teamName: string;
  name: string;
  nationality: string;
  dateOfBirth: string;
  age: number;
  appointedAt: string;
  contractUntil: string;
  status: ManagerStatus;
  reputation: number;
  preferredFormations: Formation[];
  tacticalIdentity: string;
  transferIdentity: string;
  boardTrust: number;
  jobSecurity: number;
  contractYearsRemaining: number;
  pressureScore: number;
  replacementRisk: number;
  seasonExpectations: string;
  clubFit: number;
  record: ManagerRecord;
}

export interface TeamTactics {
  mentality: 'Defensive' | 'Balanced' | 'Attacking';
  passingStyle: 'Short' | 'Mixed' | 'Direct';
  tempo: 'Slow' | 'Normal' | 'Fast';
  defensiveLine: 'Deep' | 'Standard' | 'High';
  pressing: 'None' | 'Medium' | 'High';
}

export interface PlayerStats {
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
  suspensionAppliedWeek?: number; // week when the current suspension was applied; skips decrement in same week
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

export interface Team {
  id: string;
  name: string;
  countryId?: string;
  division: Division;
  isExternal?: boolean;
  clubClass?: string;
  boardProfile: BoardProfile;
  manager: Manager;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  wins: number;
  draws: number;
  losses: number;
  played: number;
  activeFormation: Formation;
  form: string[];            // ['W', 'D', 'L', 'W', 'W']
  tactics: TeamTactics;
  budget: number;            // transfer budget in millions GBP
  operatingBudget?: number;   // operating cash in millions GBP (separated from transfer budget; optional for backward compat)
  transferSpend: number;     // gross transfer spend in millions GBP this season
  boardApproval: number;     // 0 to 100
  lastStartingXI?: string[]; // player IDs
  lastTacticalAdaptationPlayed?: number;
  formationMap?: Record<string, string>; // Maps slot coordinate 'row-col' to playerId
}

export interface BoardObjective {
  id: string;
  description: string;
  type: BoardObjectiveType;
  target: number;
  met: boolean;
  failed?: boolean;
  competitionId?: CompetitionId;
  targetRound?: CompetitionRoundKey;
}

export type BoardSignalBreakdown = {
  ageProfile: {
    score: number;
    reason?: string;
  };
  wagePosture: {
    score: number;
    wageBill: number;
    wagePressureRatio: number;
    spendRatio: number;
    reason?: string;
  };
  registrationDepth: {
    score: number;
    availablePlayers: number;
    positionShortages: number;
    missingDepth: number;
    reason?: string;
  };
};

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

export interface Fixture {
  id: string;
  week: number;
  /** Day offset from season start used for chronological ordering and fixture dates. */
  dateOrdinal?: number;
  division?: LeagueDivision;
  competitionId: CompetitionId;
  competitionType: CompetitionType;
  round: CompetitionRoundKey;
  isKnockout: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  isPlayed: boolean;
  winnerTeamId?: string;
  resolution?: 'regular' | 'penalties' | 'forfeit' | 'void';
}

export type InboxMessageSource = 'assistant' | 'system';

export type InboxMessageCategory =
  | 'system_news'
  | 'competition_update'
  | 'season_update'
  | 'board_update'
  | 'injury_update'
  | 'pre_match_energy'
  | 'pre_match_availability'
  | 'lineup_suggestion'
  | 'tactic_suggestion'
  | 'post_match_report'
  | 'transfer_advice'
  | 'squad_warning'
  | 'contract_warning'
  | 'career_sack_warning'
  | 'career_job_offer'
  | 'career_milestone';

export type InboxAction =
  | {
      type: 'apply_lineup';
      payload: {
        teamId: string;
        formationMap: Record<string, string>;
        startingIds: string[];
        subIds: string[];
      };
    }
  | {
      type: 'apply_tactics';
      payload: {
        teamId: string;
        tactics: Partial<TeamTactics>;
      };
    }
  | {
      type: 'renew_contract';
      payload: {
        playerId: string;
        years: number;
        wage: number;
      };
    }
  | {
      type: 'accept_job_offer';
      payload: {
        teamId: string;
      };
    };

export interface InboxMessage {
  id: string;
  week: number;
  source: InboxMessageSource;
  category: InboxMessageCategory;
  title: string;
  body: string;
  isRead: boolean;
  action?: InboxAction;
  fixtureId?: string;
  playerId?: string;
  teamId?: string;
}

export interface TrophyEntry {
  /** Stable unique key: `season|type|competitionId|label`. Populated on creation; optional for backward compatibility. */
  id?: string;
  season: number;
  division: Division;
  /** `relegated` is deprecated and no longer created; kept for backward compatibility with older saves. */
  type: 'champion' | 'promoted' | 'relegated' | 'cup_winner' | 'continental_winner';
  competitionId?: CompetitionId;
  label?: string;
}

export interface CompetitionRoundState {
  key: CompetitionRoundKey;
  label: string;
  week: number;
  dateOrdinal?: number;
  entrantTeamIds: string[];
  fixtureIds: string[];
  byeTeamIds: string[];
  winnerTeamIds: string[];
  completed: boolean;
}

export interface CompetitionState {
  id: CompetitionId;
  name: string;
  shortName: string;
  type: CompetitionType;
  season: number;
  leagueDivision?: LeagueDivision;
  entrantTeamIds: string[];
  rounds: CompetitionRoundState[];
  currentRound?: CompetitionRoundKey;
  eliminatedTeamIds: string[];
  championTeamId?: string;
  runnerUpTeamId?: string;
}

export interface CompetitionResultSummary {
  competitionId: CompetitionId;
  name: string;
  finish: CompetitionFinish;
}

export interface SeasonSummary {
  season: number;
  teamId: string;
  teamName: string;
  division: Division;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  finalPosition: number;
  outcome: 'champion' | 'promoted' | 'stayed' | 'relegated' | 'sacked';
  boardVerdict: BoardReviewVerdict;
  competitionResults: CompetitionResultSummary[];
}

/** Minimal persistent identity for the user-as-manager that follows across team changes. */
export interface UserManagerIdentity {
  name: string;
  nationality: string;
  dateOfBirth: string;
  preferredFormations: Formation[];
  tacticalIdentity: string;
  transferIdentity: string;
}

export interface CareerRecord {
  seasonsManaged: number;
  totalWins: number;
  totalDraws: number;
  totalLosses: number;
  totalGoalsFor: number;
  totalGoalsAgainst: number;
  reputation: number;
  trophies: TrophyEntry[];
  seasonHistory: SeasonSummary[];
  consecutiveLowApprovalWeeks: number;
  /** The user's persistent manager identity. Optional for backward compatibility. */
  userManager?: UserManagerIdentity;
}

export interface GameState {
  currentWeek: number;
  userTeamId: string | null;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  fixtures: Record<string, Fixture>;
  competitions: Record<string, CompetitionState>;
  news: string[];
  inboxMessages: InboxMessage[];
  boardObjectives: BoardObjective[];
  boardReviewAppliedWeek: number;
  careerRecord: CareerRecord;
  /** Persisted RNG state for deterministic replay. Optional for backward compatibility. */
  rngState?: number;
}

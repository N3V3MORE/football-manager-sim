import type { Formation, Division, Player } from './player';
import type {
  CompetitionId,
  CompetitionRoundKey,
  CompetitionResultSummary,
  CompetitionState,
  Fixture,
  Team,
} from './fixture-competition';
import type { InboxMessage } from './inbox';

type BoardObjectiveType = 'position' | 'goalDiff' | 'spend' | 'max_spend' | 'wins' | 'cup_round';
export type BoardReviewVerdict = 'thriving' | 'stable' | 'warning' | 'critical';

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

import type { Division, Formation, LeagueDivision, PlayerRole, TeamTactics } from './player';
import type { MatchSummary, PenaltyShootout } from './live-match';

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
type CompetitionFinish = CompetitionRoundKey | 'winner' | 'runner_up' | 'not_qualified';

export type ManagerStatus = 'Permanent' | 'Interim' | 'Caretaker';
type BoardAmbition = 'elite' | 'europe' | 'promotion' | 'stability' | 'survival';
type BoardPatience = 'low' | 'medium' | 'high';
type TransferDiscipline = 'strict' | 'balanced' | 'aggressive';

interface ManagerRecord {
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
  playerRoles?: Record<string, PlayerRole>; // Maps slot coordinate 'row-col' to tactical role
}

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
  resolution?: 'regular' | 'extra_time' | 'penalties' | 'forfeit' | 'void';
  scoreBreakdown?: {
    regulationHomeScore: number;
    regulationAwayScore: number;
    extraTimeHomeScore: number;
    extraTimeAwayScore: number;
    penaltyHomeScore?: number;
    penaltyAwayScore?: number;
  };
  penaltyShootout?: PenaltyShootout;
  matchSummary?: MatchSummary;
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
  playoffWinnerTeamId?: string;
}

export interface CompetitionResultSummary {
  competitionId: CompetitionId;
  name: string;
  finish: CompetitionFinish;
}

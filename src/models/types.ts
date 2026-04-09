export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type CountryId = string;
export type LeagueId = string;
export type CompetitionId = string;
export type CupCompetitionId = string;
export type TrophyCompetitionId = string;
export type Division = LeagueId;
export type Competition = CompetitionId;
export type CupCompetition = CupCompetitionId;
export type TrophyCompetition = TrophyCompetitionId;
export type CompetitionType = 'league' | 'domestic-cup' | 'continental-cup';
export type CompetitionFixtureStrategy = 'round-robin' | 'knockout' | 'inactive';
export type TrophyCabinet = Record<TrophyCompetitionId, number>;

export interface CountryDefinition {
  id: CountryId;
  displayName: string;
  reelHint: string;
  sortOrder: number;
}

export interface LeagueDefinition {
  id: LeagueId;
  countryId: CountryId;
  displayName: string;
  tier: number;
  teamCount: number;
  roundsPerOpponent: number;
  promotionSlots: number;
  relegationSlots: number;
  newsPriority: number;
}

export interface CompetitionDefinition {
  id: CompetitionId;
  type: CompetitionType;
  displayName: string;
  countryScope: CountryId | 'europe';
  trackedForTrophies: boolean;
  fixtureStrategy: CompetitionFixtureStrategy;
  roundNames: string[];
  startWeek: number;
  spacingWeeks: number;
  sortPriority: number;
}

export interface WorldConfig {
  countries: Record<CountryId, CountryDefinition>;
  leagues: Record<LeagueId, LeagueDefinition>;
  competitions: Record<CompetitionId, CompetitionDefinition>;
}
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

export interface ManagerRecord {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  position: number;
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
  systemIds?: string[];
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
  traitIds?: string[];
  clubJerseyNumber?: number | null;
  stats: PlayerStats;
}

export interface Team {
  id: string;
  name: string;
  countryId?: CountryId;
  leagueId: LeagueId;
  division?: Division;
  clubClass?: string;
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
  boardApproval: number;     // 0 to 100
  lastStartingXI?: string[]; // player IDs
  formationMap?: Record<string, string>; // Maps slot coordinate 'row-col' to playerId
}

export interface BoardObjective {
  id: string;
  description: string;
  type: 'position' | 'goalDiff' | 'spend' | 'wins';
  target: number;
  met: boolean;
}

export interface Fixture {
  id: string;
  week: number;
  competitionId: CompetitionId;
  competition?: Competition;
  leagueId?: LeagueId;
  division?: Division;
  roundNumber?: number;
  roundName?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  isPlayed: boolean;
  winnerTeamId?: string;
  decidedBy?: 'PEN' | 'AET';
}

export interface CupState {
  competitionId: CupCompetitionId;
  competition?: CupCompetition;
  roundNumber: number;
  roundName: string;
  entrants: string[];
  scheduledWeek: number;
  currentRoundByeTeamId?: string;
  completed: boolean;
}

export interface TrophyHistoryEntry {
  competitionId: TrophyCompetitionId;
  competition?: TrophyCompetition;
  season: number;
  teamId: string;
  teamName: string;
}

export interface SeasonResult {
  season: number;
  teamId: string;
  teamName: string;
  leagueId: LeagueId;
  leagueResult: string;
  competitions: Record<CompetitionId, string>;
}

export interface GameState {
  season: number;
  currentWeek: number;
  userTeamId: string | null;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  fixtures: Record<string, Fixture>;
  cups: Record<CupCompetition, CupState>;
  trophyCabinet: TrophyCabinet;
  trophyHistory: TrophyHistoryEntry[];
  seasonResults: SeasonResult[];
  news: string[];
  boardObjectives: BoardObjective[];
}

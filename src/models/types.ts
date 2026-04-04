export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type Formation = 
  | '4-3-3' 
  | '4-3-3 Flat' | '4-3-3 Attack' | '4-3-3 Defend'
  | '3-4-3' 
  | '5-2-3' 
  | '4-4-2'
  | '4-4-2 Flat' | '4-4-2 Diamond'
  | '4-2-3-1' 
  | '3-5-2' 
  | '4-1-4-1' 
  | '4-3-2-1';

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
}

export interface Player {
  id: string;
  name: string;
  position: Position;
  subPosition: string;   // granular FIFA pos e.g. 'RB', 'RM', 'ST'
  overallRating: number;
  age: number;
  morale: number; // 0 to 100
  energy: number; // 0 to 100
  teamId: string;
  isStarting: boolean;
  isSub: boolean;        // true = designated sub (bench), false = pure reserve
  goals: number;
  assists: number;
  cleanSheets: number;
  yellowCards: number;
  redCards: number;
  nationality: string;
  stats: PlayerStats;
}

export interface Team {
  id: string;
  name: string;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  wins: number;
  draws: number;
  losses: number;
  played: number;
  activeFormation: Formation;
  form: string[]; // ['W', 'D', 'L', 'W', 'W']
  strategy: 'defend' | 'balanced' | 'attack';
  lastStartingXI?: string[]; // player IDs
  lastSubs?: string[];        // player IDs
}

export interface Fixture {
  id: string;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  isPlayed: boolean;
}

export interface GameState {
  currentWeek: number;
  userTeamId: string | null;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  fixtures: Record<string, Fixture>;
  news: string[];
}

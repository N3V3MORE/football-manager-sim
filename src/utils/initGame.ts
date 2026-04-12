import 'react-native-get-random-values';
import { Player, Team, Position, BoardObjective, TeamTactics, LeagueDivision } from '../models/types';
import { computeMarketValue, getBudgetForClass } from './calendar';
import englishLeaguePlayers from '../data/english_league_players.json';
import { PREMIER_LEAGUE_MANAGERS } from '../data/premier_league_managers';
import { buildManager, buildGenericManager, deriveInitialBoardApproval } from '../core/managerUtils';
import { buildSeasonCompetitionBundle, getContinentalClubNames } from '../core/competitionEngine';
import { buildBoardObjectives, buildBoardProfile } from '../core/boardEngine';

const REAL_TEAMS = [
  { name: 'Arsenal',            class: 'A' },
  { name: 'Aston Villa',        class: 'B' },
  { name: 'Bournemouth',        class: 'C' },
  { name: 'Brentford',          class: 'C' },
  { name: 'Brighton',           class: 'B' },
  { name: 'Burnley',            class: 'D' },
  { name: 'Chelsea',            class: 'A' },
  { name: 'Crystal Palace',     class: 'C' },
  { name: 'Everton',            class: 'C' },
  { name: 'Fulham',             class: 'C' },
  { name: 'Leeds United',       class: 'D' },
  { name: 'Liverpool',          class: 'A' },
  { name: 'Manchester City',    class: 'S' },
  { name: 'Manchester Utd',     class: 'A' },
  { name: 'Newcastle Utd',      class: 'B' },
  { name: 'Nottingham Forest',  class: 'C' },
  { name: 'Sunderland',         class: 'D' },
  { name: 'Tottenham Hotspur',  class: 'A' },
  { name: 'West Ham Utd',       class: 'B' },
  { name: 'Wolves',             class: 'C' },
];

const getRandomTactics = () => {
  const mentalities: TeamTactics['mentality'][] = ['Defensive', 'Balanced', 'Attacking'];
  const passingStyles: TeamTactics['passingStyle'][] = ['Short', 'Mixed', 'Direct'];
  const tempos: TeamTactics['tempo'][] = ['Slow', 'Normal', 'Fast'];
  const lines: TeamTactics['defensiveLine'][] = ['Deep', 'Standard', 'High'];
  const pressings: TeamTactics['pressing'][] = ['None', 'Medium', 'High'];

  return {
    mentality: mentalities[Math.floor(Math.random() * mentalities.length)],
    passingStyle: passingStyles[Math.floor(Math.random() * passingStyles.length)],
    tempo: tempos[Math.floor(Math.random() * tempos.length)],
    defensiveLine: lines[Math.floor(Math.random() * lines.length)],
    pressing: pressings[Math.floor(Math.random() * pressings.length)],
  };
};

type RawPlayerStats = {
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physic: number;
  gk_diving?: number;
  gk_handling?: number;
  gk_kicking?: number;
  gk_reflexes?: number;
  gk_speed?: number;
  gk_positioning?: number;
};

type BasePlayerRow = {
  name: string;
  longName?: string;
  position: Position;
  subPosition: string;
  altPositions: string[];
  overallRating: number;
  marketValue?: number;
  age: number;
  nationality: string;
  clubJerseyNumber?: number | null;
  stats: RawPlayerStats;
};

type LeaguePlayerRow = BasePlayerRow & {
  leagueId: number;
  leagueName: LeagueDivision;
  clubName: string;
  clubTeamId: number;
  playerTraits?: string;
};

type LowerLeaguePlayerRow = LeaguePlayerRow;

const toLowerLeagueSourcePlayers = (rows: LowerLeaguePlayerRow[]) => rows.map(row => ({
  name: row.name,
  longName: row.longName,
  fifaTeam: row.clubName,
  gameTeamTitle: row.clubName,
  position: row.position,
  subPosition: row.subPosition,
  altPositions: row.altPositions,
  overallRating: row.overallRating,
  marketValue: row.marketValue,
  age: row.age,
  nationality: row.nationality,
  clubJerseyNumber: row.clubJerseyNumber,
  stats: row.stats,
}));

const deriveTeamClass = (division: LeagueDivision, avgOverall: number) => {
  if (division === 'Premier League') return avgOverall >= 84 ? 'A' : avgOverall >= 79 ? 'B' : avgOverall >= 75 ? 'C' : 'D';
  if (division === 'Championship') return avgOverall >= 74 ? 'B' : avgOverall >= 70 ? 'C' : avgOverall >= 66 ? 'D' : 'E';
  if (division === 'League One') return avgOverall >= 72 ? 'C' : avgOverall >= 68 ? 'D' : avgOverall >= 64 ? 'E' : 'F';
  return avgOverall >= 68 ? 'D' : avgOverall >= 64 ? 'E' : 'F';
};

const buildGeneratedSquadRows = (
  teamName: string,
  baseOverall: number,
  nationality: string
): BasePlayerRow[] => {
  const positions: [Position, string][] = [
    ['GK', 'GK'], ['GK', 'GK'],
    ['DEF', 'CB'], ['DEF', 'CB'], ['DEF', 'CB'], ['DEF', 'CB'],
    ['DEF', 'RB'], ['DEF', 'LB'],
    ['MID', 'CM'], ['MID', 'CM'], ['MID', 'CDM'], ['MID', 'CAM'],
    ['MID', 'RM'], ['MID', 'LM'],
    ['FWD', 'ST'], ['FWD', 'ST'], ['FWD', 'RW'], ['FWD', 'LW'],
  ];

  return positions.map(([position, subPosition], index) => ({
    name: `${teamName.split(' ')[0]} ${index + 1}`,
    position,
    subPosition,
    altPositions: [subPosition],
    overallRating: baseOverall + Math.floor(Math.random() * 6) - 2,
    age: 20 + Math.floor(Math.random() * 11),
    nationality,
    stats: {
      pace: 68 + Math.random() * 18,
      shooting: position === 'FWD' ? 74 : 50,
      passing: position === 'MID' ? 75 : 60,
      dribbling: 68 + Math.random() * 12,
      defending: position === 'DEF' ? 74 : 42,
      physic: 68 + Math.random() * 14,
    },
  }));
};

const calculateImpactCoefficient = (overallRating: number) => {
  if (overallRating >= 88) return 1.5 + ((overallRating - 88) * 0.15);
  if (overallRating >= 84) return 1.1 + ((overallRating - 84) * 0.08);
  return 0.9 + ((overallRating - 70) * 0.01);
};

const buildPlayerRecord = (rp: BasePlayerRow, teamId: string, playerId: string, includeLongName = false): Player => {
  const mv = rp.marketValue && rp.marketValue > 0 ? rp.marketValue : computeMarketValue(rp.overallRating, rp.age);
  return {
    id: playerId,
    name: rp.name,
    ...(includeLongName && rp.longName ? { longName: rp.longName } : {}),
    position: rp.position as Position,
    subPosition: rp.subPosition || rp.position || 'MID',
    altPositions: Array.isArray(rp.altPositions) ? rp.altPositions : [rp.subPosition || rp.position || 'MID'],
    overallRating: rp.overallRating,
    marketValue: mv,
    age: rp.age,
    morale: 80 + Math.floor(Math.random() * 21),
    energy: 90 + Math.floor(Math.random() * 11),
    teamId,
    isStarting: false,
    isSub: false,
    isTransferListed: false,
    askingPrice: 0,
    matchesSuspended: 0,
    injuryWeeks: 0,
    wage: Math.floor(mv * 1.5) + 10,
    contractLeft: 1 + Math.floor(Math.random() * 4),
    impactCoefficient: calculateImpactCoefficient(rp.overallRating),
    matchRatingHistory: [],
    minutesPlayed: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
    nationality: rp.nationality || 'Unknown',
    ...(rp.clubJerseyNumber !== undefined ? { clubJerseyNumber: rp.clubJerseyNumber ?? null } : {}),
    stats: {
      pace: rp.stats?.pace || 50,
      shooting: rp.stats?.shooting || 50,
      passing: rp.stats?.passing || 50,
      dribbling: rp.stats?.dribbling || 50,
      defending: rp.stats?.defending || 50,
      physical: rp.stats?.physic || 50,
      gk_diving: rp.stats?.gk_diving,
      gk_handling: rp.stats?.gk_handling,
      gk_kicking: rp.stats?.gk_kicking,
      gk_reflexes: rp.stats?.gk_reflexes,
      gk_speed: rp.stats?.gk_speed,
      gk_positioning: rp.stats?.gk_positioning,
    },
  };
};

const markBestStarters = (teamPlayers: Player[], players: Record<string, Player>) => {
  const sorted = [...teamPlayers].sort((a, b) => b.overallRating - a.overallRating);
  const gks = sorted.filter(p => p.position === 'GK').slice(0, 1);
  const defs = sorted.filter(p => p.position === 'DEF').slice(0, 4);
  const mids = sorted.filter(p => p.position === 'MID').slice(0, 3);
  const fwds = sorted.filter(p => p.position === 'FWD').slice(0, 3);
  [...gks, ...defs, ...mids, ...fwds].forEach(player => {
    players[player.id] = { ...players[player.id], isStarting: true };
  });
};

export const initGameData = (userTeamName?: string) => {
  const teams: Record<string, Team> = {};
  const players: Record<string, Player> = {};
  const teamIds: string[] = [];
  const teamClasses: Record<string, string> = {}; // teamId -> class letter

  const sourcePlayers = englishLeaguePlayers as LeaguePlayerRow[];
  const premierLeaguePlayers = sourcePlayers.filter(player => player.leagueId === 1);
  const lowerLeaguePlayers = sourcePlayers.filter(
    player => player.leagueId === 11 || player.leagueId === 12 || player.leagueId === 13
  );
  const playersByTeam: Record<string, LeaguePlayerRow[]> = {};
  premierLeaguePlayers.forEach(player => {
    if (!playersByTeam[player.clubName]) playersByTeam[player.clubName] = [];
    playersByTeam[player.clubName].push(player);
  });

  let teamCounter = 1;
  let playerCounter = 1;

  // 1. Create Teams and Players
  REAL_TEAMS.forEach(teamData => {
    const teamId = `T${teamCounter++}`;
    teamIds.push(teamId);
    teamClasses[teamId] = teamData.class;
    const boardProfile = buildBoardProfile(teamData.class, 'Premier League');
    const managerSource = PREMIER_LEAGUE_MANAGERS.find(item => item.teamName === teamData.name);
    if (!managerSource) {
      throw new Error(`Missing manager data for ${teamData.name}`);
    }
    const manager = buildManager(managerSource, teamId, boardProfile);

    teams[teamId] = {
      id: teamId,
      name: teamData.name,
      countryId: 'england',
      division: 'Premier League',
      clubClass: teamData.class,
      boardProfile,
      manager,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      played: 0,
      activeFormation: '4-3-3',
      form: [],
      tactics: teamData.name === userTeamName 
        ? { mentality: 'Balanced', passingStyle: 'Mixed', tempo: 'Normal', defensiveLine: 'Standard', pressing: 'Medium' }
        : getRandomTactics(),
      budget: getBudgetForClass(teamData.class),
      transferSpend: 0,
      boardApproval: deriveInitialBoardApproval(manager, boardProfile),
    };

    const teamPlayers: Player[] = [];
    let realPlayers: BasePlayerRow[] = playersByTeam[teamData.name] || [];
    
    // Generate generic squad if missing from JSON
    if (realPlayers.length < 15) {
      const baseOvr = teamData.class === 'C' ? 76 : (teamData.class === 'D' ? 74 : 78);
      realPlayers = buildGeneratedSquadRows(teamData.name, baseOvr, 'England');
    }

    realPlayers.sort((a, b) => b.overallRating - a.overallRating);

    realPlayers.forEach(rp => {
      const p = buildPlayerRecord(rp, teamId, (playerCounter++).toString());
      players[p.id] = p;
      teamPlayers.push(p);
    });

    // Auto-select best 11 for AI teams; user team stays in reserves
    if (teamData.name !== userTeamName) {
      markBestStarters(teamPlayers, players);
    }
  });

  const lowerRows = lowerLeaguePlayers;
  const lowerGroups = lowerRows.reduce<Record<LeagueDivision, Record<string, LowerLeaguePlayerRow[]>>>((acc, row) => {
    if (!acc[row.leagueName]) acc[row.leagueName] = {};
    if (!acc[row.leagueName][row.clubName]) acc[row.leagueName][row.clubName] = [];
    acc[row.leagueName][row.clubName].push(row);
    return acc;
  }, { Championship: {}, 'League One': {}, 'League Two': {} } as Record<LeagueDivision, Record<string, LowerLeaguePlayerRow[]>>);

  (['Championship', 'League One', 'League Two'] as LeagueDivision[]).forEach((division) => {
    const clubs = Object.entries(lowerGroups[division] || {})
      .map(([clubName, rows]) => {
        const avgOverall = rows.reduce((sum, row) => sum + row.overallRating, 0) / Math.max(1, rows.length);
        return { clubName, rows, avgOverall, teamClass: deriveTeamClass(division, avgOverall) };
      })
      .sort((a, b) => {
        if (b.avgOverall !== a.avgOverall) return b.avgOverall - a.avgOverall;
        return a.clubName.localeCompare(b.clubName);
      });

    clubs.forEach(club => {
      const teamId = `T${teamCounter++}`;
      teamIds.push(teamId);
      teamClasses[teamId] = club.teamClass;
      const boardProfile = buildBoardProfile(club.teamClass, division);
      const manager = buildGenericManager(club.clubName, teamId, division, club.avgOverall, boardProfile);
      const teamPlayers: Player[] = [];
      const realPlayers = toLowerLeagueSourcePlayers(club.rows);

    teams[teamId] = {
      id: teamId,
      name: club.clubName,
      countryId: 'england',
      division,
      clubClass: club.teamClass,
      boardProfile,
      manager,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        played: 0,
        activeFormation: manager.preferredFormations[0] || '4-2-3-1',
        form: [],
        tactics: club.clubName === userTeamName
          ? { mentality: 'Balanced', passingStyle: 'Mixed', tempo: 'Normal', defensiveLine: 'Standard', pressing: 'Medium' }
          : getRandomTactics(),
        budget: getBudgetForClass(club.teamClass),
        transferSpend: 0,
        boardApproval: deriveInitialBoardApproval(manager, boardProfile),
      };

      realPlayers.sort((a, b) => b.overallRating - a.overallRating);
      realPlayers.forEach(rp => {
        const p = buildPlayerRecord(rp, teamId, (playerCounter++).toString(), true);
        players[p.id] = p;
        teamPlayers.push(p);
      });

      if (club.clubName !== userTeamName) {
        markBestStarters(teamPlayers, players);
      }
    });
  });

  getContinentalClubNames().forEach((clubName, index) => {
    const teamId = `T${teamCounter++}`;
    teamIds.push(teamId);
    teamClasses[teamId] = index < 3 ? 'A' : 'B';
    const boardProfile = buildBoardProfile(teamClasses[teamId], 'Continental', true);
    const manager = buildGenericManager(clubName, teamId, 'Continental', index < 3 ? 80 : 74, boardProfile);
    teams[teamId] = {
      id: teamId,
      name: clubName,
      countryId: 'continental',
      division: 'Continental',
      isExternal: true,
      clubClass: teamClasses[teamId],
      boardProfile,
      manager,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      played: 0,
      activeFormation: '4-2-3-1',
      form: [],
      tactics: getRandomTactics(),
      budget: index < 3 ? 85 : 55,
      transferSpend: 0,
      boardApproval: deriveInitialBoardApproval(manager, boardProfile),
    };

    buildGeneratedSquadRows(clubName, index < 3 ? 81 : 77, index % 2 === 0 ? 'Spain' : 'Italy')
      .forEach(playerRow => {
        const player = buildPlayerRecord(playerRow, teamId, (playerCounter++).toString(), true);
        players[player.id] = player;
      });
    const squad = Object.values(players).filter(player => player.teamId === teamId);
    markBestStarters(squad, players);
  });

  const { fixtures, competitions } = buildSeasonCompetitionBundle(teams, 1);

  return { teams, players, fixtures, competitions, teamClasses };
};

/** Generate board objectives for the user's team. */
export const generateBoardObjectives = (
  teamClass: string,
  _teamName: string,
  division: LeagueDivision = 'Premier League'
): BoardObjective[] =>
  buildBoardObjectives(teamClass, division, buildBoardProfile(teamClass, division));



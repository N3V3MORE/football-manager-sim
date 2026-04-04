import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { Player, Team, Fixture, Position, Formation } from '../models/types';
import premierLeaguePlayers from '../data/premier_league_players.json';

const REAL_TEAMS = [
  { name: 'Arsenal', class: 'A' },
  { name: 'Aston Villa', class: 'B' },
  { name: 'Bournemouth', class: 'C' },
  { name: 'Brentford', class: 'C' },
  { name: 'Brighton', class: 'B' },
  { name: 'Chelsea', class: 'A' },
  { name: 'Crystal Palace', class: 'C' },
  { name: 'Everton', class: 'C' },
  { name: 'Fulham', class: 'C' },
  { name: 'Liverpool', class: 'A' },
  { name: 'Luton Town', class: 'D' },
  { name: 'Manchester City', class: 'S' },
  { name: 'Manchester Utd', class: 'A' },
  { name: 'Newcastle Utd', class: 'B' },
  { name: 'Nottingham Forest', class: 'C' },
  { name: 'Sheffield Utd', class: 'D' },
  { name: 'Tottenham Hotspur', class: 'A' },
  { name: 'West Ham Utd', class: 'B' },
  { name: 'Wolves', class: 'C' },
  { name: 'Leicester City', class: 'C' }
];

const FIRST_NAMES = ['John', 'Paul', 'David', 'Chris', 'Mike', 'James', 'Tom', 'Liam', 'Will', 'Alex', 'Ben', 'Sam', 'Dan', 'Luke', 'Matt', 'Jack', 'Harry', 'Oliver', 'Charlie', 'Thomas'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Jones', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Garcia', 'Martinez', 'Robinson'];

const getRatingForClass = (teamClass: string) => {
  switch (teamClass) {
    case 'S': return 82 + Math.floor(Math.random() * 8); // 82-89
    case 'A': return 79 + Math.floor(Math.random() * 8); // 79-86
    case 'B': return 75 + Math.floor(Math.random() * 8); // 75-82
    case 'C': return 72 + Math.floor(Math.random() * 7); // 72-78
    case 'D': return 68 + Math.floor(Math.random() * 7); // 68-74
    default: return 70;
  }
};



export const initGameData = (userTeamName?: string) => {
  const teams: Record<string, Team> = {};
  const players: Record<string, Player> = {};
  const fixtures: Record<string, Fixture> = {};
  const teamIds: string[] = [];

  // Group real players by team title
  const playersByTeam: Record<string, any[]> = {};
  premierLeaguePlayers.forEach(p => {
      if (!playersByTeam[p.gameTeamTitle]) playersByTeam[p.gameTeamTitle] = [];
      playersByTeam[p.gameTeamTitle].push(p);
  });

  // 1. Create Teams and Players
  REAL_TEAMS.forEach(teamData => {
    const teamId = uuidv4();
    teamIds.push(teamId);
    
    teams[teamId] = {
      id: teamId,
      name: teamData.name,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      played: 0,
      activeFormation: '4-3-3',
      form: [],
      strategy: 'balanced',
    };

    const teamPlayers: Player[] = [];
    const realPlayers = playersByTeam[teamData.name] || [];
    
    // Sort real players by rating
    realPlayers.sort((a: any, b: any) => b.overallRating - a.overallRating);

    // Grab ALL real players
    realPlayers.forEach((rp: any) => {
        const p: Player = {
            id: uuidv4(),
            name: rp.name,
            position: rp.position as Position,
            subPosition: rp.subPosition || rp.position || 'MID',
            overallRating: rp.overallRating,
            age: rp.age,
            morale: 80 + Math.floor(Math.random() * 21),
            energy: 90 + Math.floor(Math.random() * 11),
            teamId,
            isStarting: false,
            isSub: false,
            goals: 0,
            assists: 0,
            cleanSheets: 0,
            yellowCards: 0,
            redCards: 0,
            nationality: rp.nationality || 'Unknown',
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
                gk_positioning: rp.stats?.gk_positioning
            }
        };
        players[p.id] = p;
        teamPlayers.push(p);
    });

    // Auto-select best 11 for computer teams
    // User team starts empty (everyone in reserves) as requested
    if (teamData.name !== userTeamName) {
      const sorted = [...teamPlayers].sort((a, b) => b.overallRating - a.overallRating);
      const gks = sorted.filter(p => p.position === 'GK').slice(0, 1);
      const defs = sorted.filter(p => p.position === 'DEF').slice(0, 4);
      const mids = sorted.filter(p => p.position === 'MID').slice(0, 3);
      const fwds = sorted.filter(p => p.position === 'FWD').slice(0, 3);
      
      [...gks, ...defs, ...mids, ...fwds].forEach(p => {
        players[p.id].isStarting = true;
      });
    }
  });

  // 2. Generate Scheduled Fixtures
  let week = 1;
  const numTeams = teamIds.length;
  const schedulingIds = [...teamIds];

  for (let round = 0; round < numTeams - 1; round++) {
    for (let match = 0; match < schedulingIds.length / 2; match++) {
      const home = schedulingIds[match];
      const away = schedulingIds[schedulingIds.length - 1 - match];
      
      const fixture1: Fixture = {
        id: uuidv4(),
        week: week,
        homeTeamId: home,
        awayTeamId: away,
        homeScore: null,
        awayScore: null,
        isPlayed: false,
      };
      const fixture2: Fixture = {
        id: uuidv4(),
        week: week + (numTeams - 1),
        homeTeamId: away,
        awayTeamId: home,
        homeScore: null,
        awayScore: null,
        isPlayed: false,
      };
      fixtures[fixture1.id] = fixture1;
      fixtures[fixture2.id] = fixture2;
    }
    schedulingIds.splice(1, 0, schedulingIds.pop() as string);
    week++;
  }

  return { teams, players, fixtures };
};

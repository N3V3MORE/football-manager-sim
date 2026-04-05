import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { Player, Team, Fixture, Position, BoardObjective, TeamTactics } from '../models/types';
import { computeMarketValue, getBudgetForClass } from './calendar';
import premierLeaguePlayers from '../data/premier_league_players.json';

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

/** Generate 3 board objectives based on team class. */
const generateObjectives = (teamClass: string, teamName: string): BoardObjective[] => {
  const objectives: BoardObjective[] = [];

  // Position objective
  const posTargets: Record<string, { desc: string; target: number }> = {
    S: { desc: 'Win the Premier League title',      target: 1  },
    A: { desc: 'Finish in the Top 4',               target: 4  },
    B: { desc: 'Finish in the Top 8',               target: 8  },
    C: { desc: 'Finish in the Top Half (Top 10)',   target: 10 },
    D: { desc: 'Avoid Relegation (Finish Top 17)',  target: 17 },
  };
  const pos = posTargets[teamClass] || posTargets['C'];
  objectives.push({
    id: uuidv4(), description: pos.desc,
    type: 'position', target: pos.target, met: false,
  });

  // Win-rate objective
  const winTargets: Record<string, { desc: string; target: number }> = {
    S: { desc: 'Win at least 22 league matches',    target: 22 },
    A: { desc: 'Win at least 18 league matches',    target: 18 },
    B: { desc: 'Win at least 13 league matches',    target: 13 },
    C: { desc: 'Win at least 10 league matches',    target: 10 },
    D: { desc: 'Win at least 6 league matches',     target: 6  },
  };
  const win = winTargets[teamClass] || winTargets['C'];
  objectives.push({
    id: uuidv4(), description: win.desc,
    type: 'wins', target: win.target, met: false,
  });

  // Transfer spend objective
  const spendTargets: Record<string, { desc: string; target: number }> = {
    S: { desc: 'Invest at least £60m in transfers', target: 60 },
    A: { desc: 'Invest at least £30m in transfers', target: 30 },
    B: { desc: 'Invest at least £20m in transfers', target: 20 },
    C: { desc: 'Invest at least £10m in transfers', target: 10 },
    D: { desc: 'Invest at least £5m in transfers',  target: 5  },
  };
  const spend = spendTargets[teamClass] || spendTargets['C'];
  objectives.push({
    id: uuidv4(), description: spend.desc,
    type: 'spend', target: spend.target, met: false,
  });

  return objectives;
};

const getRandomTactics = (): TeamTactics => {
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

export const initGameData = (userTeamName?: string) => {
  const teams: Record<string, Team> = {};
  const players: Record<string, Player> = {};
  const fixtures: Record<string, Fixture> = {};
  const teamIds: string[] = [];
  const teamClasses: Record<string, string> = {}; // teamId -> class letter

  // Group real players by team title
  const playersByTeam: Record<string, any[]> = {};
  (premierLeaguePlayers as any[]).forEach(p => {
    if (!playersByTeam[p.gameTeamTitle]) playersByTeam[p.gameTeamTitle] = [];
    playersByTeam[p.gameTeamTitle].push(p);
  });

  let teamCounter = 1;
  let playerCounter = 1;

  // 1. Create Teams and Players
  REAL_TEAMS.forEach(teamData => {
    const teamId = `T${teamCounter++}`;
    teamIds.push(teamId);
    teamClasses[teamId] = teamData.class;

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
      tactics: teamData.name === userTeamName 
        ? { mentality: 'Balanced', passingStyle: 'Mixed', tempo: 'Normal', defensiveLine: 'Standard', pressing: 'Medium' }
        : getRandomTactics(),
      budget: getBudgetForClass(teamData.class),
      boardApproval: 50,
    };

    const teamPlayers: Player[] = [];
    let realPlayers = (playersByTeam[teamData.name] || []) as any[];
    
    // Generate generic squad if missing from JSON
    if (realPlayers.length < 15) {
      const positions: [Position, string][] = [
        ['GK', 'GK'], ['GK', 'GK'],
        ['DEF', 'CB'], ['DEF', 'CB'], ['DEF', 'CB'], ['DEF', 'CB'],
        ['DEF', 'RB'], ['DEF', 'LB'],
        ['MID', 'CM'], ['MID', 'CM'], ['MID', 'CDM'], ['MID', 'CAM'],
        ['MID', 'RM'], ['MID', 'LM'],
        ['FWD', 'ST'], ['FWD', 'ST'], ['FWD', 'RW'], ['FWD', 'LW'],
      ];
      const baseOvr = teamData.class === 'C' ? 76 : (teamData.class === 'D' ? 74 : 78);
      realPlayers = positions.map(([pos, subPos], i) => ({
        name: `${teamData.name.substring(0,3)} Player ${i+1}`,
        position: pos,
        subPosition: subPos,
        altPositions: [subPos],
        overallRating: baseOvr + Math.floor(Math.random() * 6) - 2,
        age: 20 + Math.floor(Math.random() * 12),
        nationality: 'England',
        stats: { 
          pace: 70 + Math.random() * 15, 
          shooting: pos === 'FWD' ? 75 : 50, 
          passing: pos === 'MID' ? 75 : 60, 
          dribbling: 70, 
          defending: pos === 'DEF' ? 75 : 40, 
          physic: 70 
        }
      }));
    }

    realPlayers.sort((a, b) => b.overallRating - a.overallRating);

    realPlayers.forEach(rp => {
      // Use market value from CSV if available
      const mv = rp.marketValue && rp.marketValue > 0
        ? rp.marketValue
        : computeMarketValue(rp.overallRating, rp.age);

      // Impact Coefficient calculation
      let impact = 1.0;
      if (rp.overallRating >= 88) impact = 1.5 + ((rp.overallRating - 88) * 0.15); // e.g. 91 => 1.95
      else if (rp.overallRating >= 84) impact = 1.1 + ((rp.overallRating - 84) * 0.08);
      else impact = 0.9 + ((rp.overallRating - 70) * 0.01);

      const p: Player = {
        id: (playerCounter++).toString(),
        name: rp.name,
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
        wage: Math.floor(mv * 1.5) + 10,
        contractLeft: 1 + Math.floor(Math.random() * 4),
        impactCoefficient: impact,
        matchRatingHistory: [],
        minutesPlayed: 0,
        goals: 0,
        assists: 0,
        cleanSheets: 0,
        yellowCards: 0,
        redCards: 0,
        nationality: rp.nationality || 'Unknown',
        stats: {
          pace:     rp.stats?.pace     || 50,
          shooting: rp.stats?.shooting || 50,
          passing:  rp.stats?.passing  || 50,
          dribbling: rp.stats?.dribbling || 50,
          defending: rp.stats?.defending || 50,
          physical: rp.stats?.physic   || rp.stats?.physical || 50,
          gk_diving:      rp.stats?.gk_diving,
          gk_handling:    rp.stats?.gk_handling,
          gk_kicking:     rp.stats?.gk_kicking,
          gk_reflexes:    rp.stats?.gk_reflexes,
          gk_speed:       rp.stats?.gk_speed,
          gk_positioning: rp.stats?.gk_positioning,
        },
      };
      players[p.id] = p;
      teamPlayers.push(p);
    });

    // Auto-select best 11 for AI teams; user team stays in reserves
    if (teamData.name !== userTeamName) {
      const sorted = [...teamPlayers].sort((a, b) => b.overallRating - a.overallRating);
      const gks  = sorted.filter(p => p.position === 'GK').slice(0, 1);
      const defs = sorted.filter(p => p.position === 'DEF').slice(0, 4);
      const mids = sorted.filter(p => p.position === 'MID').slice(0, 3);
      const fwds = sorted.filter(p => p.position === 'FWD').slice(0, 3);
      [...gks, ...defs, ...mids, ...fwds].forEach(p => { players[p.id].isStarting = true; });
    }
  });

  // 2. Generate round-robin fixtures using proper circle method
  // This naturally alternates home/away for each team each round
  const numTeams = teamIds.length;
  const rounds = numTeams - 1;
  const circleIds = [...teamIds];

  // Build first-half schedule (weeks 1–19)
  const firstHalf: { home: string; away: string; week: number }[] = [];
  for (let round = 0; round < rounds; round++) {
    const week = round + 1;
    // Pair fixed[0] with last slot, then pair inward
    for (let i = 0; i < numTeams / 2; i++) {
      const teamA = circleIds[i];
      const teamB = circleIds[numTeams - 1 - i];
      // Alternate home/away based on round parity per pairing
      const flipHome = (round + i) % 2 === 0;
      firstHalf.push({ home: flipHome ? teamA : teamB, away: flipHome ? teamB : teamA, week });
    }
    // Rotate all except the first element (circle method)
    const last = circleIds.pop()!;
    circleIds.splice(1, 0, last);
  }

  // Build second half: swap home/away, add 19 weeks offset
  let fixtureCounter = 1;
  firstHalf.forEach(f => {
    const fId = `F${fixtureCounter++}`;
    const sId = `F${fixtureCounter++}`;
    fixtures[fId] = { id: fId, week: f.week, homeTeamId: f.home, awayTeamId: f.away, homeScore: null, awayScore: null, isPlayed: false };
    fixtures[sId] = { id: sId, week: f.week + rounds, homeTeamId: f.away, awayTeamId: f.home, homeScore: null, awayScore: null, isPlayed: false };
  });

  return { teams, players, fixtures, teamClasses };
};

/** Generate board objectives for the user's team. */
export const generateBoardObjectives = (teamClass: string, teamName: string): BoardObjective[] =>
  generateObjectives(teamClass, teamName);

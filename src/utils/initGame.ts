import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { Player, Team, Position, BoardObjective, TeamTactics, LeagueId } from '../models/types';
import { computeMarketValue, getBudgetForClass } from './calendar';
import englishLeaguePlayers from '../data/english_league_players.json';
import { PREMIER_LEAGUE_MANAGERS } from '../data/premier_league_managers';
import { DEFAULT_LEAGUE_ID, getLeagueDefinition, LEAGUE_IDS, mapLegacyLeagueId } from '../core/domainRegistry';
import { buildManager, buildGenericManager, deriveInitialBoardApproval } from '../core/managerUtils';
import { getDivisionTeamCount } from '../core/leagueUtils';
import { buildSeasonFixtures } from '../core/seasonFixtureBuilder';
import { extractTraitIds } from '../core/tacticalEffects';

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

type LowerLeaguePlayerRow = {
  leagueId: number;
  leagueName: LeagueId;
  clubName: string;
  clubTeamId: number;
  name: string;
  longName?: string;
  position: Position;
  subPosition: string;
  altPositions: string[];
  overallRating: number;
  marketValue: number;
  age: number;
  nationality: string;
  clubJerseyNumber?: number | null;
  stats: {
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
};

type SourcePlayerRow = {
  leagueId?: number;
  clubName?: string;
  name: string;
  longName?: string;
  position: Position;
  subPosition?: string;
  altPositions?: string[];
  overallRating: number;
  marketValue?: number;
  age: number;
  nationality?: string;
  clubJerseyNumber?: number | null;
  stats?: {
    pace?: number;
    shooting?: number;
    passing?: number;
    dribbling?: number;
    defending?: number;
    physic?: number;
    gk_diving?: number;
    gk_handling?: number;
    gk_kicking?: number;
    gk_reflexes?: number;
    gk_speed?: number;
    gk_positioning?: number;
  };
};

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

const deriveTeamClass = (leagueId: LeagueId, avgOverall: number) => {
  if (leagueId === LEAGUE_IDS.PREMIER_LEAGUE) return avgOverall >= 84 ? 'A' : avgOverall >= 79 ? 'B' : avgOverall >= 75 ? 'C' : 'D';
  if (leagueId === LEAGUE_IDS.CHAMPIONSHIP) return avgOverall >= 74 ? 'B' : avgOverall >= 70 ? 'C' : avgOverall >= 66 ? 'D' : 'E';
  if (leagueId === LEAGUE_IDS.LEAGUE_ONE) return avgOverall >= 72 ? 'C' : avgOverall >= 68 ? 'D' : avgOverall >= 64 ? 'E' : 'F';
  return avgOverall >= 68 ? 'D' : avgOverall >= 64 ? 'E' : 'F';
};

const buildGenericTeamManager = (teamName: string, teamId: string, leagueId: LeagueId, avgOverall: number) => (
  buildGenericManager(teamName, teamId, leagueId, Math.max(35, Math.min(85, Math.round(avgOverall))))
);

const buildTeamObjectives = (teamClass: string, leagueId: LeagueId): BoardObjective[] => {
  const leagueLabel = getLeagueDefinition(leagueId).displayName;
  const teamCount = getDivisionTeamCount(leagueId);
  const seasonMatches = Math.max(1, (teamCount - 1) * 2);
  const topHalf = Math.ceil(teamCount / 2);
  const safeZone = Math.max(teamCount - 3, topHalf + 1);

  const posTargets: Record<string, { desc: string; target: number }> = {
    S: { desc: `Win the ${leagueLabel} title`, target: 1 },
    A: { desc: `Finish in the Top 4 in the ${leagueLabel}`, target: 4 },
    B: { desc: `Finish in the Top 8 in the ${leagueLabel}`, target: 8 },
    C: { desc: `Finish in the Top Half of the ${leagueLabel}`, target: topHalf },
    D: { desc: `Finish above the relegation zone in the ${leagueLabel}`, target: safeZone },
    E: { desc: `Stay clear of the drop in the ${leagueLabel}`, target: safeZone },
    F: { desc: `Secure survival in the ${leagueLabel}`, target: safeZone },
  };
  const pos = posTargets[teamClass] || posTargets['C'];

  const winTargetByClass: Record<string, number> = {
    S: Math.max(22, Math.round(seasonMatches * 0.60)),
    A: Math.max(18, Math.round(seasonMatches * 0.50)),
    B: Math.max(13, Math.round(seasonMatches * 0.40)),
    C: Math.max(10, Math.round(seasonMatches * 0.35)),
    D: Math.max(8, Math.round(seasonMatches * 0.28)),
    E: Math.max(6, Math.round(seasonMatches * 0.22)),
    F: Math.max(5, Math.round(seasonMatches * 0.18)),
  };

  const spendTargets: Record<string, number> = {
    S: 60,
    A: 30,
    B: 20,
    C: 10,
    D: 5,
    E: 3,
    F: 2,
  };

  return [
    {
      id: uuidv4(),
      description: pos.desc,
      type: 'position',
      target: pos.target,
      met: false,
    },
    {
      id: uuidv4(),
      description: `Win at least ${winTargetByClass[teamClass] || 10} league matches`,
      type: 'wins',
      target: winTargetByClass[teamClass] || 10,
      met: false,
    },
    {
      id: uuidv4(),
      description: `Invest at least GBP ${spendTargets[teamClass] || 5}m in transfers`,
      type: 'spend',
      target: spendTargets[teamClass] || 5,
      met: false,
    },
  ];
};

const calculateImpactCoefficient = (overallRating: number) => {
  if (overallRating >= 88) return 1.5 + ((overallRating - 88) * 0.15);
  if (overallRating >= 84) return 1.1 + ((overallRating - 84) * 0.08);
  return 0.9 + ((overallRating - 70) * 0.01);
};

const buildPlayerRecord = (rp: SourcePlayerRow, teamId: string, playerId: string, includeLongName = false): Player => {
  const mv = rp.marketValue && rp.marketValue > 0 ? rp.marketValue : computeMarketValue(rp.overallRating, rp.age);
  const rawTraitString = typeof (rp as SourcePlayerRow & { playerTraits?: string }).playerTraits === 'string'
    ? (rp as SourcePlayerRow & { playerTraits?: string }).playerTraits
    : undefined;
  const traitIds = rawTraitString ? extractTraitIds({ playerTraits: rawTraitString }) : undefined;
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
    ...(rawTraitString ? { playerTraits: rawTraitString } : {}),
    ...(traitIds && traitIds.length > 0 ? { traitIds } : {}),
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
  const teamClasses: Record<string, string> = {}; // teamId -> class letter

  const allEnglishLeaguePlayers = englishLeaguePlayers as SourcePlayerRow[];
  const premierLeaguePlayers = allEnglishLeaguePlayers.filter(player => player.leagueId === 1);
  const lowerLeaguePlayers = allEnglishLeaguePlayers.filter(
    player => player.leagueId === 11 || player.leagueId === 12 || player.leagueId === 13
  );
  const playersByTeam: Record<string, SourcePlayerRow[]> = {};
  premierLeaguePlayers.forEach(player => {
    if (!player.clubName) return;
    if (!playersByTeam[player.clubName]) playersByTeam[player.clubName] = [];
    playersByTeam[player.clubName].push(player);
  });

  let teamCounter = 1;
  let playerCounter = 1;

  // 1. Create Teams and Players
  REAL_TEAMS.forEach(teamData => {
    const teamId = `T${teamCounter++}`;
    teamClasses[teamId] = teamData.class;
    const managerSource = PREMIER_LEAGUE_MANAGERS.find(item => item.teamName === teamData.name);
    if (!managerSource) {
      throw new Error(`Missing manager data for ${teamData.name}`);
    }
    const manager = buildManager(managerSource, teamId);

    teams[teamId] = {
      id: teamId,
      name: teamData.name,
      countryId: 'england',
      leagueId: LEAGUE_IDS.PREMIER_LEAGUE,
      clubClass: teamData.class,
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
      boardApproval: deriveInitialBoardApproval(manager),
    };

    const teamPlayers: Player[] = [];
    let realPlayers: SourcePlayerRow[] = playersByTeam[teamData.name] || [];
    
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
      const p = buildPlayerRecord(rp, teamId, (playerCounter++).toString());
      players[p.id] = p;
      teamPlayers.push(p);
    });

    // Auto-select best 11 for AI teams; user team stays in reserves
    if (teamData.name !== userTeamName) {
      markBestStarters(teamPlayers, players);
    }
  });

  const lowerRows = lowerLeaguePlayers as LowerLeaguePlayerRow[];
  const lowerLeagueIds = [LEAGUE_IDS.CHAMPIONSHIP, LEAGUE_IDS.LEAGUE_ONE, LEAGUE_IDS.LEAGUE_TWO] as LeagueId[];
  const lowerGroups = lowerRows.reduce<Record<LeagueId, Record<string, LowerLeaguePlayerRow[]>>>((acc, row) => {
    const canonicalLeagueId = mapLegacyLeagueId(row.leagueName) || DEFAULT_LEAGUE_ID;
    if (!acc[canonicalLeagueId]) acc[canonicalLeagueId] = {};
    if (!acc[canonicalLeagueId][row.clubName]) acc[canonicalLeagueId][row.clubName] = [];
    acc[canonicalLeagueId][row.clubName].push(row);
    return acc;
  }, Object.fromEntries(lowerLeagueIds.map(leagueId => [leagueId, {}])) as Record<LeagueId, Record<string, LowerLeaguePlayerRow[]>>);

  lowerLeagueIds.forEach((leagueId) => {
    const clubs = Object.entries(lowerGroups[leagueId] || {})
      .map(([clubName, rows]) => {
        const avgOverall = rows.reduce((sum, row) => sum + row.overallRating, 0) / Math.max(1, rows.length);
        return { clubName, rows, avgOverall, teamClass: deriveTeamClass(leagueId, avgOverall) };
      })
      .sort((a, b) => {
        if (b.avgOverall !== a.avgOverall) return b.avgOverall - a.avgOverall;
        return a.clubName.localeCompare(b.clubName);
      });

    clubs.forEach(club => {
      const teamId = `T${teamCounter++}`;
      teamClasses[teamId] = club.teamClass;
      const manager = buildGenericTeamManager(club.clubName, teamId, leagueId, club.avgOverall);
      const teamPlayers: Player[] = [];
      const realPlayers = toLowerLeagueSourcePlayers(club.rows);

    teams[teamId] = {
      id: teamId,
      name: club.clubName,
      countryId: 'england',
      leagueId,
      clubClass: club.teamClass,
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
        boardApproval: deriveInitialBoardApproval(manager),
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

  const seasonFixtures = buildSeasonFixtures(teams);

  return { teams, players, fixtures: seasonFixtures.fixtures, cups: seasonFixtures.cups, teamClasses };
};

/** Generate board objectives for the user's team. */
export const generateBoardObjectives = (teamClass: string, teamName: string, leagueId: LeagueId = DEFAULT_LEAGUE_ID): BoardObjective[] =>
  buildTeamObjectives(teamClass, leagueId);



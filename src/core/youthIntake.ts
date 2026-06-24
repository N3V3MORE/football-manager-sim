import { Player, Position, Team } from '../models/types';
import { computeMarketValue } from '../utils/calendar';
import { getSquadPolicy } from './squadPolicy';
import { isPlayableClub } from './freeAgentPool';

const YOUTH_FIRST_NAMES = ['Alex', 'Ben', 'Callum', 'Dan', 'Ethan', 'Finn', 'George', 'Harry', 'Isaac', 'Jack'];
const YOUTH_LAST_NAMES = ['Adams', 'Brown', 'Clark', 'Davies', 'Evans', 'Fisher', 'Green', 'Harris', 'Irvine', 'Jones'];
const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

const clampRating = (value: number) => Math.max(1, Math.min(99, Math.round(value)));

const calculateImpactCoefficient = (overallRating: number) => {
  if (overallRating >= 88) return 1.5 + ((overallRating - 88) * 0.15);
  if (overallRating >= 84) return 1.1 + ((overallRating - 84) * 0.08);
  return 0.9 + ((overallRating - 70) * 0.01);
};

const getNextPlayerId = (players: Record<string, Player>): string => {
  let maxId = 0;
  for (const id of Object.keys(players)) {
    const num = parseInt(id, 10);
    if (!isNaN(num) && num > maxId) maxId = num;
  }
  return (maxId + 1).toString();
};

const getPositionCounts = (players: Player[]) => (
  players.reduce<Record<Position, number>>((acc, player) => {
    acc[player.position] += 1;
    return acc;
  }, { GK: 0, DEF: 0, MID: 0, FWD: 0 })
);

const getNextIntakePosition = (counts: Record<Position, number>, team: Team, rng: () => number): Position => {
  const policy = getSquadPolicy(team);
  const shortage = POSITIONS
    .map(position => ({ position, missing: Math.max(0, policy.positionalMinimums[position] - counts[position]) }))
    .filter(item => item.missing > 0)
    .sort((a, b) => b.missing - a.missing)[0];
  if (shortage) return shortage.position;
  return POSITIONS[Math.floor(rng() * POSITIONS.length)];
};

const generateYouthPlayer = (
  playerId: string,
  teamId: string,
  position: Position,
  rng: () => number
): Player => {
  const firstName = YOUTH_FIRST_NAMES[Math.floor(rng() * YOUTH_FIRST_NAMES.length)];
  const lastName = YOUTH_LAST_NAMES[Math.floor(rng() * YOUTH_LAST_NAMES.length)];
  const age = 16 + Math.floor(rng() * 3);
  const rating = 40 + Math.floor(rng() * 16);
  const marketValue = computeMarketValue(rating, age);
  const aroundRating = (offset = 0, spread = 8) => clampRating(rating + offset + Math.floor((rng() * spread * 2) - spread));

  const baseStats = {
    pace: aroundRating(2),
    shooting: aroundRating(-4),
    passing: aroundRating(-1),
    dribbling: aroundRating(-1),
    defending: aroundRating(-3),
    physical: aroundRating(1),
  };

  let stats: Player['stats'];
  let subPosition: string;
  let altPositions: string[];
  switch (position) {
    case 'GK':
      stats = {
        ...baseStats,
        shooting: clampRating(Math.max(8, rating - 28 + Math.floor(rng() * 8))),
        gk_diving: aroundRating(3),
        gk_handling: aroundRating(1),
        gk_kicking: aroundRating(-3),
        gk_reflexes: aroundRating(4),
        gk_speed: aroundRating(-2),
        gk_positioning: aroundRating(2),
      };
      subPosition = 'GK';
      altPositions = ['GK'];
      break;
    case 'DEF':
      stats = { ...baseStats, defending: aroundRating(8), physical: aroundRating(5) };
      subPosition = 'CB';
      altPositions = ['CB', 'RB', 'LB'];
      break;
    case 'MID':
      stats = { ...baseStats, passing: aroundRating(8), dribbling: aroundRating(5) };
      subPosition = 'CM';
      altPositions = ['CM', 'CDM', 'CAM'];
      break;
    case 'FWD':
    default:
      stats = { ...baseStats, shooting: aroundRating(8), pace: aroundRating(5) };
      subPosition = 'ST';
      altPositions = ['ST', 'LW', 'RW'];
      break;
  }

  return {
    id: playerId,
    name: `${firstName} ${lastName}`,
    position,
    subPosition,
    altPositions,
    overallRating: rating,
    marketValue,
    age,
    morale: 70 + Math.floor(rng() * 21),
    energy: 95 + Math.floor(rng() * 6),
    teamId,
    isStarting: false,
    isSub: false,
    isTransferListed: false,
    askingPrice: 0,
    matchesSuspended: 0,
    injuryWeeks: 0,
    wage: Math.max(1, Math.floor(marketValue * 0.8) + 1),
    contractLeft: 1 + Math.floor(rng() * 3),
    impactCoefficient: calculateImpactCoefficient(rating),
    matchRatingHistory: [],
    minutesPlayed: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    yellowCards: 0,
    redCards: 0,
    nationality: 'English',
    stats,
  };
};

export const replenishUnderfilledSquads = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  rng: () => number
): Record<string, Player> => {
  const nextPlayers = { ...players };
  let nextId = parseInt(getNextPlayerId(players), 10);

  Object.values(teams).filter(isPlayableClub).forEach(team => {
    let squad = Object.values(nextPlayers).filter(player => player.teamId === team.id);
    const policy = getSquadPolicy(team);
    let counts = getPositionCounts(squad);

    while (squad.length < policy.structuralMinimum || POSITIONS.some(position => counts[position] < policy.positionalMinimums[position])) {
      const position = getNextIntakePosition(counts, team, rng);
      const playerId = (nextId++).toString();
      const youth = generateYouthPlayer(playerId, team.id, position, rng);
      nextPlayers[playerId] = youth;
      squad = [...squad, youth];
      counts = getPositionCounts(squad);
    }
  });

  return nextPlayers;
};

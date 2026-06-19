import { Player } from '../models/types';
import { RandomGenerator, resolveRandom } from './random';
import { weightedPick } from './matchUtils';

type InjuryEvent = {
  playerId: string;
  playerName: string;
  weeks: number;
  injuryType: string;
};

const INJURY_TYPES = [
  'tight hamstring',
  'ankle knock',
  'groin strain',
  'knee sprain',
  'calf strain',
];

const getInjuryLength = (roll: number) => {
  if (roll < 0.5) return 1;
  if (roll < 0.8) return 2;
  if (roll < 0.95) return 3;
  return 4;
};

const getTeamInjuryChance = (participants: Player[], minuteMap: Record<string, number>) => {
  const healthy = participants.filter(player => (player.injuryWeeks || 0) === 0);
  const highLoadPlayers = healthy.filter(player => (minuteMap[player.id] || 0) >= 60);
  const tiredPlayers = highLoadPlayers.filter(player => player.energy <= 55);
  return Math.min(0.22, 0.05 + highLoadPlayers.length * 0.005 + tiredPlayers.length * 0.018);
};

export const applyMatchInjuries = (
  participants: Player[],
  minuteMap: Record<string, number>,
  updatedPlayers: Record<string, Player>,
  matchWeek?: number,
  rng?: RandomGenerator
) => {
  const random = resolveRandom(rng);
  const candidates = participants
    .filter(player => (
      (minuteMap[player.id] || 0) >= 20 &&
      (updatedPlayers[player.id]?.injuryWeeks || 0) === 0
    ));

  if (candidates.length === 0) return [] as InjuryEvent[];
  if (random() >= getTeamInjuryChance(candidates, minuteMap)) return [] as InjuryEvent[];

  // Weighted random selection: higher load = higher injury risk, but not deterministic.
  const injuredPlayer = weightedPick(candidates, p => {
    const load = (minuteMap[p.id] || 0) + Math.max(0, 65 - updatedPlayers[p.id].energy);
    return Math.max(0.1, load);
  }, rng);
  const weeks = getInjuryLength(random());
  const injuryType = INJURY_TYPES[Math.floor(random() * INJURY_TYPES.length)];

  updatedPlayers[injuredPlayer.id] = {
    ...updatedPlayers[injuredPlayer.id],
    injuryWeeks: weeks,
    injuryType,
    injuryAppliedWeek: matchWeek,
    isStarting: false,
    isSub: false,
  };

  return [{
    playerId: injuredPlayer.id,
    playerName: injuredPlayer.name,
    weeks,
    injuryType,
  }];
};

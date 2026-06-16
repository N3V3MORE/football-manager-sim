import { Player } from '../models/types';
import { RandomGenerator } from './random';

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
  const highLoadPlayers = participants.filter(player => (minuteMap[player.id] || 0) >= 60);
  const tiredPlayers = highLoadPlayers.filter(player => player.energy <= 55);
  return Math.min(0.22, 0.05 + highLoadPlayers.length * 0.005 + tiredPlayers.length * 0.018);
};

export const applyMatchInjuries = (
  participants: Player[],
  minuteMap: Record<string, number>,
  updatedPlayers: Record<string, Player>,
  rng?: RandomGenerator
) => {
  const random = rng || Math.random;
  const candidates = participants
    .filter(player => (
      (minuteMap[player.id] || 0) >= 20 &&
      (updatedPlayers[player.id]?.injuryWeeks || 0) === 0
    ));

  if (candidates.length === 0) return [] as InjuryEvent[];
  if (random() >= getTeamInjuryChance(candidates, minuteMap)) return [] as InjuryEvent[];

  const weightedCandidates = [...candidates].sort((a, b) => {
    const loadA = (minuteMap[a.id] || 0) + Math.max(0, 65 - updatedPlayers[a.id]!.energy);
    const loadB = (minuteMap[b.id] || 0) + Math.max(0, 65 - updatedPlayers[b.id]!.energy);
    return loadB - loadA;
  });
  const injuredPlayer = weightedCandidates[0]!;
  const weeks = getInjuryLength(random());
  const injuryType = INJURY_TYPES[Math.floor(random() * INJURY_TYPES.length)]!;

  updatedPlayers[injuredPlayer.id] = {
    ...updatedPlayers[injuredPlayer.id],
    injuryWeeks: weeks,
    injuryType,
    isStarting: false,
    isSub: false,
  } as Player;

  return [{
    playerId: injuredPlayer.id,
    playerName: injuredPlayer.name,
    weeks,
    injuryType,
  }];
};

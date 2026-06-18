import { ENGINE_CONFIG } from '../config/engineConfig';
import { Player } from '../models/types';
import { PlayerCounterStat, RoleTag } from './matchTypes';
import { RandomGenerator, resolveRandom } from './random';

export const runDuel = (
  att: number,
  def: number,
  luck: number = 30,
  rng?: RandomGenerator
) => {
  const random = resolveRandom(rng);
  const curveStat = (s: number) => {
    const gamma = ENGINE_CONFIG.RATING_CURVE_GAMMA || 1.0;
    const clamped = Math.max(0, Math.min(100, s));
    if (gamma <= 0 || gamma === 1) return clamped;
    return Math.pow(clamped / 100, gamma) * 100;
  };
  const compress = (s: number) => {
    const curved = curveStat(s);
    return curved <= ENGINE_CONFIG.STAT_COMPRESSION_BASE
      ? curved
      : ENGINE_CONFIG.STAT_COMPRESSION_BASE + (curved - ENGINE_CONFIG.STAT_COMPRESSION_BASE) * ENGINE_CONFIG.STAT_COMPRESSION_FACTOR;
  };
  const rollA = compress(att) + (random() * 2 - 1) * luck;
  const rollB = compress(def) + (random() * 2 - 1) * luck;
  return rollA > rollB;
};

export const weightedPick = <T>(
  items: T[],
  getWeight: (item: T) => number,
  rng?: RandomGenerator
): T => {
  if (items.length === 0) {
    throw new RangeError('weightedPick requires at least one item.');
  }
  const random = resolveRandom(rng);
  const weights = items.map(item => Math.max(0.1, getWeight(item)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * totalWeight;

  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }

  return items[items.length - 1];
};

export const addPlayerStat = (
  players: Record<string, Player>,
  playerId: string,
  stat: PlayerCounterStat,
  amount = 1
) => {
  const player = players[playerId];
  if (!player) return;
  players[playerId] = { ...player, [stat]: player[stat] + amount };
};

export const inferRoleTag = (player: Player): RoleTag => {
  const raw = (player.subPosition || '').toUpperCase();
  const alt = (player.altPositions || []).map(pos => pos.toUpperCase());
  if (player.position === 'GK') return 'GK';
  if (raw.includes('LWB') || raw.includes('RWB')) return 'WB';
  if (raw.includes('LB') || raw.includes('RB')) return 'FB';
  if (raw.includes('CB')) return 'CB';
  if (raw.includes('CDM') || raw === 'DM') return 'DM';
  if (raw.includes('CAM') || raw === 'AM') return 'AM';
  if (raw === 'CM') return 'CM';
  if (raw === 'LM' || raw === 'RM') return 'WIDE_MID';
  if (raw === 'LW' || raw === 'RW') return 'WINGER';
  if (raw === 'ST' || raw === 'CF') return 'ST';
  if (player.position === 'DEF') {
    if (alt.some(pos => pos.includes('LWB') || pos.includes('RWB'))) return 'WB';
    if (alt.some(pos => pos.includes('LB') || pos.includes('RB'))) return 'FB';
    return 'CB';
  }
  if (player.position === 'MID') return 'CM';
  return 'ST';
};

export const getRoleGroups = (players: Player[]) => {
  const groups: Record<RoleTag, Player[]> = {
    GK: [],
    CB: [],
    FB: [],
    WB: [],
    DM: [],
    CM: [],
    AM: [],
    WIDE_MID: [],
    WINGER: [],
    ST: [],
  };
  players.forEach(player => {
    groups[inferRoleTag(player)].push(player);
  });
  return groups;
};

export const avgStat = (players: Player[], getStat: (p: Player) => number, fallback: number) => {
  if (players.length === 0) return fallback;
  return players.reduce((sum, player) => sum + getStat(player), 0) / players.length;
};

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const getFormModifier = (form: string[]): number => {
  if (!form || form.length === 0) return 1.0;
  const wins = form.filter(x => x === 'W').length;
  const losses = form.filter(x => x === 'L').length;
  return 1.0 + (wins * 0.01) - (losses * 0.01);
};

export const getMoraleModifier = (teamPlayers: Player[]): number => {
  if (teamPlayers.length === 0) return 1.0;
  const avgMorale = teamPlayers.reduce((s, p) => s + p.morale, 0) / teamPlayers.length;
  return 1.0 + ((avgMorale - 50) / 50) * 0.05;
};

export const getClubClassMatchMultiplier = (clubClass?: string): number => {
  const multipliers: Record<string, number> = {
    S: 1.035,
    A: 1.02,
    B: 1.005,
    C: 0.99,
    D: 0.975,
    E: 0.96,
    F: 0.945,
  };
  return multipliers[clubClass || 'C'] || 0.99;
};

export const scaleLineupForMatch = (
  players: Player[],
  formMultiplier: number,
  moraleMultiplier: number,
  homeAdvantage = 1,
  clubClass?: string
) => (
  players.map(player => ({
    ...player,
    stats: {
      ...player.stats,
      passing: player.stats.passing * formMultiplier * moraleMultiplier * homeAdvantage * getClubClassMatchMultiplier(clubClass),
      shooting: player.stats.shooting * formMultiplier * moraleMultiplier * homeAdvantage * getClubClassMatchMultiplier(clubClass),
      defending: (player.stats.defending || 50) * formMultiplier * moraleMultiplier * homeAdvantage * getClubClassMatchMultiplier(clubClass),
      dribbling: (player.stats.dribbling || 50) * formMultiplier * moraleMultiplier * homeAdvantage * getClubClassMatchMultiplier(clubClass),
    },
  }))
);

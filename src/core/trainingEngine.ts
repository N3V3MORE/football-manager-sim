import { GoalkeeperStatKey, Player, StatKey, Team, TrainingStatKey } from '../models/types';
import { computeMarketValue } from '../utils/calendar';
import { calculateImpactCoefficient, clampRating } from './playerRatingUtils';
import { getTrainingTraitXpMultiplier } from './traitEngine';

const statKeys: StatKey[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];
export const GOALKEEPER_TRAINING_STATS: Record<StatKey, GoalkeeperStatKey> = {
  pace: 'gk_speed', shooting: 'gk_reflexes', passing: 'gk_kicking',
  dribbling: 'gk_handling', defending: 'gk_positioning', physical: 'gk_diving',
};
const goalkeeperStatKeys = Object.values(GOALKEEPER_TRAINING_STATS);

type TrainingOptions = {
  xpMultiplier?: number;
  focusOverride?: StatKey | null;
};

const clampPotential = (value: number) => Math.max(40, Math.min(99, Math.round(value)));

const derivePotential = (player: Player) => {
  if (typeof player.potential === 'number' && Number.isFinite(player.potential)) {
    return clampPotential(player.potential);
  }

  const ageUpside = player.age <= 20 ? 14 : player.age <= 24 ? 9 : player.age <= 29 ? 4 : 0;
  return clampPotential(Math.max(player.overallRating, player.overallRating + ageUpside));
};

const getAgeMultiplier = (age: number) => {
  if (age <= 20) return 1.4;
  if (age <= 24) return 1.1;
  if (age <= 29) return 0.9;
  return 0.5;
};

const getStatWeight = (player: Player, key: TrainingStatKey) => {
  if (player.position === 'GK') {
    return key === 'gk_reflexes' ? 0.28 : key === 'gk_positioning' ? 0.24
      : key === 'gk_diving' ? 0.20 : key === 'gk_handling' ? 0.16 : key === 'gk_kicking' ? 0.08 : 0.04;
  }
  if (player.position === 'DEF') {
    return key === 'defending' ? 0.34
      : key === 'physical' ? 0.22
        : key === 'pace' ? 0.16
          : key === 'passing' ? 0.12
            : key === 'dribbling' ? 0.10
              : 0.06;
  }

  if (player.position === 'MID') {
    return key === 'passing' ? 0.28
      : key === 'dribbling' ? 0.22
        : key === 'physical' ? 0.16
          : key === 'pace' ? 0.14
            : key === 'defending' ? 0.12
              : 0.08;
  }

  if (player.position === 'FWD') {
    return key === 'shooting' ? 0.30
      : key === 'pace' ? 0.20
        : key === 'dribbling' ? 0.18
          : key === 'physical' ? 0.14
            : key === 'passing' ? 0.12
              : 0.06;
  }

  return key === 'physical' ? 0.22
    : key === 'pace' ? 0.20
      : key === 'passing' ? 0.18
        : key === 'defending' ? 0.18
          : key === 'dribbling' ? 0.14
            : 0.08;
};

const estimateOverallFromStats = (player: Player, stats: Player['stats']) => {
  const keys = player.position === 'GK' ? goalkeeperStatKeys : statKeys;
  const weightedTotal = keys.reduce((sum, key) => (
    sum + (stats[key] ?? player.overallRating) * getStatWeight(player, key)
  ), 0);
  const weightTotal = keys.reduce((sum, key) => sum + getStatWeight(player, key), 0);
  return clampRating(weightedTotal / Math.max(0.01, weightTotal));
};

const pickTrainingStat = (player: Player, rng: () => number, focusOverride?: StatKey | null): TrainingStatKey => {
  const focus = (focusOverride !== undefined ? focusOverride : player.trainingFocus)
    || statKeys[Math.floor(rng() * statKeys.length)] || 'passing';
  return player.position === 'GK' ? GOALKEEPER_TRAINING_STATS[focus] : focus;
};

export const computeWeeklyTraining = (
  player: Player,
  _team: Team,
  _currentWeek: number,
  rng: () => number,
  options: TrainingOptions = {}
): Partial<Player> => {
  const potential = derivePotential(player);
  const previousXp = Math.max(0, Math.min(99, Math.floor(player.trainingXp || 0)));

  if ((player.injuryWeeks || 0) > 0) {
    return player.potential === potential && previousXp === (player.trainingXp || 0)
      ? {}
      : { potential, trainingXp: previousXp };
  }

  const baseXp = 8 + Math.floor(rng() * 8);
  const energyMultiplier = player.energy < 50 ? 0.7 : 1;
  const activeFocus = options.focusOverride !== undefined ? options.focusOverride : player.trainingFocus;
  const moraleMultiplier = player.morale < 40 ? 0.6 : (player.morale > 70 ? 1.1 : 1);
  const traitMultiplier = getTrainingTraitXpMultiplier(player, activeFocus);
  const xpGain = Math.max(0, Math.round(
    baseXp *
    getAgeMultiplier(player.age) *
    energyMultiplier *
    moraleMultiplier *
    traitMultiplier *
    (options.xpMultiplier ?? 1)
  ));

  let totalXp = previousXp + xpGain;
  let statPoints = Math.floor(totalXp / 100);
  const trainingXp = totalXp % 100;
  let stats = player.stats;
  let overallRating = player.overallRating;
  let trainingStatProgress = Math.max(0, player.trainingStatProgress || 0);
  const trainingStatGains: Partial<Record<TrainingStatKey, number>> = {
    ...(player.trainingStatGains || {}),
  };

  while (statPoints > 0) {
    statPoints -= 1;
    if (overallRating >= potential) continue;

    const key = pickTrainingStat(player, rng, options.focusOverride);
    const previousStat = stats[key] ?? player.overallRating;
    if (previousStat >= 99) continue;
    stats = {
      ...stats,
      [key]: clampRating(previousStat + 1),
    };
    trainingStatProgress += 1;
    trainingStatGains[key] = (trainingStatGains[key] || 0) + 1;

    if (trainingStatProgress >= 3) {
      const estimatedOverall = estimateOverallFromStats(player, stats);
      overallRating = Math.min(potential, Math.max(overallRating, estimatedOverall));
      trainingStatProgress %= 3;
    }
  }

  totalXp = trainingXp;

  const patch: Partial<Player> = {
    potential,
    trainingXp: totalXp,
    trainingStatProgress,
  };

  if (stats !== player.stats) {
    patch.stats = stats;
    patch.trainingStatGains = trainingStatGains;
  }

  if (overallRating !== player.overallRating) {
    patch.overallRating = overallRating;
    patch.marketValue = computeMarketValue(overallRating, player.age);
    patch.impactCoefficient = calculateImpactCoefficient(overallRating);
  }

  return patch;
};

export const createYouthPotential = (overallRating: number, rng: () => number) => {
  const upside = 15 + Math.floor(Math.pow(rng(), 1.7) * 21);
  return clampPotential(Math.min(95, Math.max(overallRating + 10, overallRating + upside)));
};

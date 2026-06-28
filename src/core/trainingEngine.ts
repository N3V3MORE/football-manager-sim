import { Player, StatKey, Team } from '../models/types';
import { computeMarketValue } from '../utils/calendar';

const statKeys: StatKey[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];

type TrainingOptions = {
  xpMultiplier?: number;
  focusOverride?: StatKey | null;
};

const clampRating = (value: number) => Math.max(1, Math.min(99, Math.round(value)));
const clampPotential = (value: number) => Math.max(40, Math.min(99, Math.round(value)));

const calculateImpactCoefficient = (overallRating: number) => {
  if (overallRating >= 88) return 1.5 + ((overallRating - 88) * 0.15);
  if (overallRating >= 84) return 1.1 + ((overallRating - 84) * 0.08);
  return 0.9 + ((overallRating - 70) * 0.01);
};

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

const getStatWeight = (player: Player, key: StatKey) => {
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
  const weightedTotal = statKeys.reduce((sum, key) => (
    sum + (stats[key] || player.overallRating) * getStatWeight(player, key)
  ), 0);
  const weightTotal = statKeys.reduce((sum, key) => sum + getStatWeight(player, key), 0);
  return clampRating(weightedTotal / Math.max(0.01, weightTotal));
};

const pickTrainingStat = (player: Player, rng: () => number, focusOverride?: StatKey | null): StatKey => {
  if (focusOverride !== undefined) {
    return focusOverride || statKeys[Math.floor(rng() * statKeys.length)] || 'passing';
  }
  return player.trainingFocus || statKeys[Math.floor(rng() * statKeys.length)] || 'passing';
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
  const moraleMultiplier = player.morale > 70 ? 1.1 : 1;
  const xpGain = Math.max(0, Math.round(
    baseXp *
    getAgeMultiplier(player.age) *
    energyMultiplier *
    moraleMultiplier *
    (options.xpMultiplier ?? 1)
  ));

  let totalXp = previousXp + xpGain;
  let statPoints = Math.floor(totalXp / 100);
  const trainingXp = totalXp % 100;
  let stats = { ...player.stats };
  let overallRating = player.overallRating;
  let trainingStatProgress = Math.max(0, player.trainingStatProgress || 0);
  const trainingStatGains: Partial<Record<StatKey, number>> = {
    ...(player.trainingStatGains || {}),
  };

  while (statPoints > 0) {
    statPoints -= 1;
    if (overallRating >= potential) continue;

    const key = pickTrainingStat(player, rng, options.focusOverride);
    stats = {
      ...stats,
      [key]: clampRating((stats[key] || player.overallRating) + 1),
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

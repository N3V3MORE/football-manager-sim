export const ENGINE_CONFIG = {
  // MATCH TIMING & PACING
  TOTAL_POSSESSIONS: 35, // Base possessions per team in a Quick Sim
  ENERGY_DRAIN_PER_MINUTE: 0.25, // Energy lost per minute played
  WEEKLY_ENERGY_RECOVERY: 50, // Energy regained after a week

  // SCORING & CHANCES
  BIG_MOMENT_CHANCE: 0.52, // Rebalanced after slot-shape tactical integration
  GLOBAL_HOME_ADVANTAGE: 1.04, // Slightly tuned

  // DUELS & VARIANCE
  STAT_COMPRESSION_BASE: 80, // Compress elite stat gaps to reduce team scoring extremes
  STAT_COMPRESSION_FACTOR: 0.3,
  RATING_CURVE_GAMMA: 1.0, // Optional non-linear stat curve (1.0 = linear)
  DUEL_LUCK_MIDFIELD: 32, // Slightly more variance
  DUEL_LUCK_ATTACK: 28,
  DUEL_LUCK_SHOOTING: 24, // Increased from 20 to give keepers more of a chance

  // ANTI-STEAMROLL (Desperation mechanics for trailing teams)
  STEAMROLL_MARGIN_1: 2,
  STEAMROLL_BONUS_1: 1.1,
  STEAMROLL_MARGIN_2: 3,
  STEAMROLL_BONUS_2: 1.25,

  // DISCIPLINE
  FOUL_CHANCE: 0.28,
  RED_CARD_CHANCE: 0.015,
  SECOND_YELLOW_RED_CHANCE: 0.12,
};

export const ENGINE_CONFIG = {
  // MATCH TIMING & PACING
  TOTAL_POSSESSIONS: 35, // Base possessions per team in a Quick Sim
  ENERGY_DRAIN_PER_MINUTE: 0.25, // Energy lost per minute played
  WEEKLY_ENERGY_RECOVERY: 50, // Energy regained after a week

  // SCORING & CHANCES
  BIG_MOMENT_CHANCE: 0.42, // Increased from 0.35 to reach ~2.7 goals/match
  GLOBAL_HOME_ADVANTAGE: 1.03, // Multiplier applied to the home team's stats
  
  // DUELS & VARIANCE
  STAT_COMPRESSION_BASE: 80, // Stats above this value suffer diminishing returns
  STAT_COMPRESSION_FACTOR: 0.4, // e.g. 90 stat becomes 80 + 10*0.4 = 84
  DUEL_LUCK_MIDFIELD: 35, // Increased from 22
  DUEL_LUCK_ATTACK: 30,   // Increased from 18
  DUEL_LUCK_SHOOTING: 25, // Increased from 15

  // ANTI-STEAMROLL (Desperation mechanics for trailing teams)
  // If losing by this margin, get the corresponding defensive multiplier
  STEAMROLL_MARGIN_1: 2,
  STEAMROLL_BONUS_1: 1.1,
  STEAMROLL_MARGIN_2: 3, 
  STEAMROLL_BONUS_2: 1.25,

  // DISCIPLINE
  FOUL_CHANCE: 0.30,      // % chance a failed defensive duel ends in a foul
  RED_CARD_CHANCE: 0.02,  // % chance a foul is a Red Card instead of a Yellow
};

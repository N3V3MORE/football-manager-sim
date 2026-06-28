import { Player, StatKey } from '../models/types';

export type TraitPhase = 'buildUp' | 'creation' | 'finishing' | 'defense';

export interface TraitEffect {
  phase?: TraitPhase | TraitPhase[];
  statBonus?: Partial<Record<StatKey, number>>;
  weightMultiplier?: number;
  throughBallBonus?: number;
  wideRouteBonus?: number;
  fatigueReduction?: number;
  injuryRiskModifier?: number;
  penaltyBonus?: number;
}

export interface TraitBonuses {
  statBonus: Partial<Record<StatKey, number>>;
  weightMultiplier: number;
  throughBallBonus: number;
  wideRouteBonus: number;
  fatigueReduction: number;
  injuryRiskModifier: number;
  penaltyBonus: number;
  traits: string[];
}

const bonus = (
  phase: TraitPhase | TraitPhase[],
  statBonus: Partial<Record<StatKey, number>>,
  extra: Omit<TraitEffect, 'phase' | 'statBonus'> = {}
): TraitEffect => ({ phase, statBonus, ...extra });

export const TRAIT_REGISTRY: Record<string, TraitEffect> = {
  Acrobatic: bonus('finishing', { shooting: 2, physical: 1 }, { weightMultiplier: 1.05 }),
  'Acrobatic +': bonus('finishing', { shooting: 4, physical: 2 }, { weightMultiplier: 1.12 }),
  'Aerial Fortress': bonus(['defense', 'finishing'], { physical: 2, defending: 2, shooting: 1 }, { weightMultiplier: 1.05 }),
  Anticipate: bonus('defense', { defending: 3 }, { weightMultiplier: 1.08 }),
  'Anticipate +': bonus('defense', { defending: 5 }, { weightMultiplier: 1.14 }),
  Block: bonus('defense', { defending: 3 }, { weightMultiplier: 1.08 }),
  'Block +': bonus('defense', { defending: 5 }, { weightMultiplier: 1.14 }),
  Bruiser: bonus('defense', { physical: 3, defending: 1 }, { weightMultiplier: 1.06 }),
  'Bruiser +': bonus('defense', { physical: 5, defending: 2 }, { weightMultiplier: 1.12 }),
  'Chip Shot': bonus('finishing', { shooting: 2 }, { weightMultiplier: 1.04 }),
  'Cross Claimer': bonus('defense', { defending: 2, physical: 2 }),
  'Cross Claimer +': bonus('defense', { defending: 4, physical: 3 }),
  'Dead Ball': bonus('creation', { passing: 2, shooting: 1 }, { penaltyBonus: 3 }),
  'Dead Ball +': bonus('creation', { passing: 4, shooting: 2 }, { penaltyBonus: 5 }),
  Deflector: bonus('defense', { defending: 2, physical: 1 }),
  'Deflector +': bonus('defense', { defending: 4, physical: 2 }),
  Enforcer: bonus('defense', { physical: 3, defending: 1 }, { weightMultiplier: 1.05 }),
  'Enforcer +': bonus('defense', { physical: 5, defending: 2 }, { weightMultiplier: 1.1 }),
  'Far Reach': bonus('defense', { defending: 2, pace: 1 }),
  'Far Throw': bonus('creation', { passing: 1, physical: 2 }, { wideRouteBonus: 0.04 }),
  'Finesse Shot': bonus('finishing', { shooting: 3 }),
  'Finesse Shot +': bonus('finishing', { shooting: 5 }),
  'First Touch': bonus(['buildUp', 'creation'], { dribbling: 2, passing: 1 }),
  Footwork: bonus(['buildUp', 'defense'], { pace: 1, dribbling: 2 }),
  Gamechanger: bonus('finishing', {}, { weightMultiplier: 1.15 }),
  'Gamechanger +': bonus('finishing', {}, { weightMultiplier: 1.25 }),
  'Incisive Pass': bonus('creation', { passing: 3 }, { throughBallBonus: 0.08 }),
  'Incisive Pass +': bonus('creation', { passing: 5 }, { throughBallBonus: 0.12 }),
  Intercept: bonus('defense', { defending: 3 }, { weightMultiplier: 1.08 }),
  'Intercept +': bonus('defense', { defending: 5 }, { weightMultiplier: 1.14 }),
  Inventive: bonus('creation', { passing: 2, dribbling: 2 }, { throughBallBonus: 0.04 }),
  'Inventive +': bonus('creation', { passing: 4, dribbling: 3 }, { throughBallBonus: 0.08 }),
  Jockey: bonus('defense', { defending: 2, pace: 1 }),
  'Long Ball Pass': bonus(['buildUp', 'creation'], { passing: 2 }, { throughBallBonus: 0.05 }),
  'Long Ball Pass +': bonus(['buildUp', 'creation'], { passing: 4 }, { throughBallBonus: 0.09 }),
  'Long Throw': bonus('creation', { passing: 1, physical: 1 }, { wideRouteBonus: 0.03 }),
  'Long Throw +': bonus('creation', { passing: 2, physical: 2 }, { wideRouteBonus: 0.06 }),
  'Low Driven Shot': bonus('finishing', { shooting: 2 }, { weightMultiplier: 1.04 }),
  'Low Driven Shot +': bonus('finishing', { shooting: 4 }, { weightMultiplier: 1.1 }),
  'Pinged Pass': bonus(['buildUp', 'creation'], { passing: 2 }, { throughBallBonus: 0.03 }),
  'Pinged Pass +': bonus(['buildUp', 'creation'], { passing: 4 }, { throughBallBonus: 0.06 }),
  'Power Shot': bonus('finishing', { shooting: 2, physical: 1 }, { weightMultiplier: 1.1 }),
  'Precision Header': bonus('finishing', { shooting: 2, physical: 2 }, { weightMultiplier: 1.08 }),
  'Press Proven': bonus(['buildUp', 'creation'], { dribbling: 1, physical: 1 }, { fatigueReduction: 0.1 }),
  'Press Proven +': bonus(['buildUp', 'creation'], { dribbling: 2, physical: 2 }, { fatigueReduction: 0.15 }),
  'Quick Step': bonus('creation', { pace: 2, dribbling: 1 }, { weightMultiplier: 1.04 }),
  'Quick Step +': bonus('creation', { pace: 4, dribbling: 2 }, { weightMultiplier: 1.1 }),
  Rapid: bonus(['creation', 'finishing'], { pace: 3 }, { weightMultiplier: 1.04 }),
  'Rapid +': bonus(['creation', 'finishing'], { pace: 5 }, { weightMultiplier: 1.1 }),
  Relentless: { fatigueReduction: 0.15, injuryRiskModifier: -0.02 },
  'Relentless +': { fatigueReduction: 0.22, injuryRiskModifier: -0.03 },
  'Rush Out': bonus('defense', { pace: 2, defending: 1 }),
  'Rush Out +': bonus('defense', { pace: 4, defending: 2 }),
  'Slide Tackle': bonus('defense', { defending: 2, physical: 1 }, { weightMultiplier: 1.06 }),
  'Slide Tackle +': bonus('defense', { defending: 4, physical: 2 }, { weightMultiplier: 1.12 }),
  Technical: bonus(['buildUp', 'creation'], { dribbling: 3 }, { weightMultiplier: 1.05 }),
  'Tiki Taka': bonus('buildUp', { passing: 2, dribbling: 1 }),
  'Tiki Taka +': bonus('buildUp', { passing: 4, dribbling: 2 }),
  Trickster: bonus('creation', { dribbling: 3 }, { wideRouteBonus: 0.04 }),
  'Trickster +': bonus('creation', { dribbling: 5 }, { wideRouteBonus: 0.08 }),
  'Whipped Pass': bonus('creation', { passing: 2 }, { wideRouteBonus: 0.08 }),
  'Whipped Pass +': bonus('creation', { passing: 4 }, { wideRouteBonus: 0.13 }),
};

const traitAppliesToPhase = (effect: TraitEffect, phase?: TraitPhase) => {
  if (!phase || !effect.phase) return true;
  const phases = Array.isArray(effect.phase) ? effect.phase : [effect.phase];
  return phases.includes(phase);
};

export const normalizePlayerTraits = (rawTraits: unknown): string[] => {
  const rawItems = Array.isArray(rawTraits) ? rawTraits : [rawTraits];
  const traits = rawItems.flatMap(item => {
    if (typeof item !== 'string') return [];
    let text = item.trim().replace(/\\"/g, '"');
    while (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
      text = text.slice(1, -1).trim();
    }
    if (!text) return [];
    return text
      .split(',')
      .map(trait => trait.trim().replace(/^"+|"+$/g, '').trim())
      .filter(Boolean);
  });

  return [...new Set(traits)];
};

export const getPlayerTraits = (player: Pick<Player, 'playerTraits'>): string[] => (
  normalizePlayerTraits(player.playerTraits)
);

export const getTraitBonuses = (
  player: Pick<Player, 'playerTraits'>,
  phase?: TraitPhase
): TraitBonuses => {
  const traits = getPlayerTraits(player);
  const bonuses: TraitBonuses = {
    statBonus: {},
    weightMultiplier: 1,
    throughBallBonus: 0,
    wideRouteBonus: 0,
    fatigueReduction: 0,
    injuryRiskModifier: 0,
    penaltyBonus: 0,
    traits,
  };

  traits.forEach(trait => {
    const effect = TRAIT_REGISTRY[trait];
    if (!effect) return;

    bonuses.fatigueReduction += effect.fatigueReduction || 0;
    bonuses.injuryRiskModifier += effect.injuryRiskModifier || 0;
    bonuses.penaltyBonus += effect.penaltyBonus || 0;

    if (!traitAppliesToPhase(effect, phase)) return;

    if (effect.statBonus) {
      (Object.entries(effect.statBonus) as [StatKey, number][]).forEach(([key, value]) => {
        bonuses.statBonus[key] = (bonuses.statBonus[key] || 0) + value;
      });
    }
    bonuses.weightMultiplier *= effect.weightMultiplier || 1;
    bonuses.throughBallBonus += effect.throughBallBonus || 0;
    bonuses.wideRouteBonus += effect.wideRouteBonus || 0;
  });

  bonuses.weightMultiplier = Math.min(1.5, Math.max(0.5, bonuses.weightMultiplier));
  bonuses.fatigueReduction = Math.min(0.5, Math.max(0, bonuses.fatigueReduction));
  bonuses.injuryRiskModifier = Math.max(-0.08, Math.min(0.08, bonuses.injuryRiskModifier));
  bonuses.penaltyBonus = Math.max(0, Math.min(8, bonuses.penaltyBonus));

  return bonuses;
};

export const getTrainingTraitXpMultiplier = (
  player: Pick<Player, 'playerTraits'>,
  focus?: StatKey | null
) => {
  if (!focus) return 1;
  const hasMatchingTrait = getPlayerTraits(player).some(trait => {
    const effect = TRAIT_REGISTRY[trait];
    return Boolean(effect?.statBonus?.[focus]);
  });
  return hasMatchingTrait ? 1.1 : 1;
};

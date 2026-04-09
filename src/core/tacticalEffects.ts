import { Player, Team } from '../models/types';

export type CompiledMatchEffects = {
  buildUp: {
    passBonusMultiplier: number;
    throughBallChance: number;
  };
  chanceCreation: {
    tempoMultiplier: number;
    creatorBonusMultiplier: number;
    wideRouteBias: number;
  };
  finishing: {
    shootingBonusMultiplier: number;
  };
  defensiveStructure: {
    defensiveBonusMultiplier: number;
    interceptBonusMultiplier: number;
    pressDisruptionMultiplier: number;
    isHighLine: boolean;
    isDeepLine: boolean;
  };
  energyDrain: {
    multiplier: number;
  };
  substitutionBias: {
    attacking: number;
    defensive: number;
  };
  metadata: {
    activeSystemIds: string[];
    activeTraitIds: string[];
  };
};

type TeamEffectContext = {
  team: Team;
  players: Player[];
};

type PlayerTraitEffectContext = TeamEffectContext & {
  traitCounts: Record<string, number>;
};

export type TeamTacticEffectModule = {
  id: string;
  applies: (context: TeamEffectContext) => boolean;
  apply: (effects: CompiledMatchEffects, context: TeamEffectContext) => void;
};

export type PlayerTraitEffectModule = {
  id: string;
  applies: (context: PlayerTraitEffectContext) => boolean;
  apply: (effects: CompiledMatchEffects, context: PlayerTraitEffectContext) => void;
};

const createBaseEffects = (): CompiledMatchEffects => ({
  buildUp: {
    passBonusMultiplier: 1,
    throughBallChance: 0.4,
  },
  chanceCreation: {
    tempoMultiplier: 1,
    creatorBonusMultiplier: 1,
    wideRouteBias: 0,
  },
  finishing: {
    shootingBonusMultiplier: 1,
  },
  defensiveStructure: {
    defensiveBonusMultiplier: 1,
    interceptBonusMultiplier: 1,
    pressDisruptionMultiplier: 1,
    isHighLine: false,
    isDeepLine: false,
  },
  energyDrain: {
    multiplier: 1,
  },
  substitutionBias: {
    attacking: 0,
    defensive: 0,
  },
  metadata: {
    activeSystemIds: [],
    activeTraitIds: [],
  },
});

export const extractTraitIds = (player: Pick<Player, 'traitIds' | 'playerTraits'>) => {
  if (Array.isArray(player.traitIds) && player.traitIds.length > 0) {
    return player.traitIds.filter(Boolean);
  }
  if (!player.playerTraits) return [];
  return player.playerTraits
    .replace(/"/g, '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
};

const MENTALITY_EFFECT_MODULES: TeamTacticEffectModule[] = [
  {
    id: 'mentality-attacking',
    applies: ({ team }) => team.tactics.mentality === 'Attacking',
    apply: effects => {
      effects.finishing.shootingBonusMultiplier *= 1.1;
      effects.buildUp.passBonusMultiplier *= 1.05;
      effects.defensiveStructure.defensiveBonusMultiplier *= 0.88;
      effects.substitutionBias.attacking += 1;
    },
  },
  {
    id: 'mentality-defensive',
    applies: ({ team }) => team.tactics.mentality === 'Defensive',
    apply: effects => {
      effects.finishing.shootingBonusMultiplier *= 0.85;
      effects.buildUp.passBonusMultiplier *= 1.05;
      effects.defensiveStructure.defensiveBonusMultiplier *= 1.15;
      effects.substitutionBias.defensive += 1;
    },
  },
];

const PASSING_STYLE_EFFECT_MODULES: TeamTacticEffectModule[] = [
  {
    id: 'passing-short',
    applies: ({ team }) => team.tactics.passingStyle === 'Short',
    apply: effects => {
      effects.buildUp.passBonusMultiplier *= 1.15;
      effects.buildUp.throughBallChance = 0.25;
    },
  },
  {
    id: 'passing-direct',
    applies: ({ team }) => team.tactics.passingStyle === 'Direct',
    apply: effects => {
      effects.buildUp.passBonusMultiplier *= 0.85;
      effects.buildUp.throughBallChance = 0.75;
    },
  },
];

const TEMPO_EFFECT_MODULES: TeamTacticEffectModule[] = [
  {
    id: 'tempo-fast',
    applies: ({ team }) => team.tactics.tempo === 'Fast',
    apply: effects => {
      effects.chanceCreation.tempoMultiplier *= 1.01;
      effects.energyDrain.multiplier *= 1.3;
      effects.substitutionBias.attacking += 0.5;
    },
  },
  {
    id: 'tempo-slow',
    applies: ({ team }) => team.tactics.tempo === 'Slow',
    apply: effects => {
      effects.chanceCreation.tempoMultiplier *= 0.99;
    },
  },
];

const DEFENSIVE_LINE_EFFECT_MODULES: TeamTacticEffectModule[] = [
  {
    id: 'line-high',
    applies: ({ team }) => team.tactics.defensiveLine === 'High',
    apply: effects => {
      effects.defensiveStructure.isHighLine = true;
      effects.defensiveStructure.interceptBonusMultiplier *= 1.05;
    },
  },
  {
    id: 'line-deep',
    applies: ({ team }) => team.tactics.defensiveLine === 'Deep',
    apply: effects => {
      effects.defensiveStructure.isDeepLine = true;
      effects.defensiveStructure.interceptBonusMultiplier *= 0.95;
    },
  },
];

const PRESSING_EFFECT_MODULES: TeamTacticEffectModule[] = [
  {
    id: 'pressing-high',
    applies: ({ team }) => team.tactics.pressing === 'High',
    apply: effects => {
      effects.defensiveStructure.defensiveBonusMultiplier *= 1.12;
      effects.defensiveStructure.interceptBonusMultiplier *= 1.08;
      effects.defensiveStructure.pressDisruptionMultiplier *= 0.99;
      effects.energyDrain.multiplier *= 1.3;
      effects.substitutionBias.attacking += 0.25;
      effects.substitutionBias.defensive += 0.25;
    },
  },
  {
    id: 'pressing-none',
    applies: ({ team }) => team.tactics.pressing === 'None',
    apply: effects => {
      effects.defensiveStructure.defensiveBonusMultiplier *= 0.96;
      effects.defensiveStructure.interceptBonusMultiplier *= 0.95;
      effects.defensiveStructure.pressDisruptionMultiplier *= 1.01;
    },
  },
];

export const TEAM_TACTIC_EFFECT_MODULES: TeamTacticEffectModule[] = [
  ...MENTALITY_EFFECT_MODULES,
  ...PASSING_STYLE_EFFECT_MODULES,
  ...TEMPO_EFFECT_MODULES,
  ...DEFENSIVE_LINE_EFFECT_MODULES,
  ...PRESSING_EFFECT_MODULES,
];

export const PLAYER_TRAIT_EFFECT_MODULES: PlayerTraitEffectModule[] = [];

export const registerTeamTacticEffectModule = (module: TeamTacticEffectModule) => {
  TEAM_TACTIC_EFFECT_MODULES.push(module);
  return module;
};

export const registerPlayerTraitEffectModule = (module: PlayerTraitEffectModule) => {
  PLAYER_TRAIT_EFFECT_MODULES.push(module);
  return module;
};

export const compileTeamTacticEffects = (
  team: Team,
  players: Player[],
  extraModules: TeamTacticEffectModule[] = []
) => {
  const effects = createBaseEffects();
  const context: TeamEffectContext = { team, players };

  [...TEAM_TACTIC_EFFECT_MODULES, ...extraModules].forEach(module => {
    if (!module.applies(context)) return;
    module.apply(effects, context);
    effects.metadata.activeSystemIds.push(module.id);
  });

  (team.tactics.systemIds || []).forEach(systemId => {
    if (!effects.metadata.activeSystemIds.includes(systemId)) {
      effects.metadata.activeSystemIds.push(systemId);
    }
  });

  return effects;
};

export const compilePlayerTraitEffects = (
  team: Team,
  players: Player[],
  extraModules: PlayerTraitEffectModule[] = []
) => {
  const activeModules = [...PLAYER_TRAIT_EFFECT_MODULES, ...extraModules];
  if (activeModules.length === 0) {
    return createBaseEffects();
  }

  const effects = createBaseEffects();
  const traitCounts = players.reduce<Record<string, number>>((acc, player) => {
    extractTraitIds(player).forEach(traitId => {
      acc[traitId] = (acc[traitId] || 0) + 1;
    });
    return acc;
  }, {});
  effects.metadata.activeTraitIds = Object.keys(traitCounts);
  const context: PlayerTraitEffectContext = { team, players, traitCounts };

  activeModules.forEach(module => {
    if (!module.applies(context)) return;
    module.apply(effects, context);
  });

  return effects;
};

const mergeEffectsInto = (target: CompiledMatchEffects, source: CompiledMatchEffects) => {
  target.buildUp.passBonusMultiplier *= source.buildUp.passBonusMultiplier;
  target.buildUp.throughBallChance *= source.buildUp.throughBallChance / 0.4;
  target.chanceCreation.tempoMultiplier *= source.chanceCreation.tempoMultiplier;
  target.chanceCreation.creatorBonusMultiplier *= source.chanceCreation.creatorBonusMultiplier;
  target.chanceCreation.wideRouteBias += source.chanceCreation.wideRouteBias;
  target.finishing.shootingBonusMultiplier *= source.finishing.shootingBonusMultiplier;
  target.defensiveStructure.defensiveBonusMultiplier *= source.defensiveStructure.defensiveBonusMultiplier;
  target.defensiveStructure.interceptBonusMultiplier *= source.defensiveStructure.interceptBonusMultiplier;
  target.defensiveStructure.pressDisruptionMultiplier *= source.defensiveStructure.pressDisruptionMultiplier;
  target.defensiveStructure.isHighLine = target.defensiveStructure.isHighLine || source.defensiveStructure.isHighLine;
  target.defensiveStructure.isDeepLine = target.defensiveStructure.isDeepLine || source.defensiveStructure.isDeepLine;
  target.energyDrain.multiplier *= source.energyDrain.multiplier;
  target.substitutionBias.attacking += source.substitutionBias.attacking;
  target.substitutionBias.defensive += source.substitutionBias.defensive;
  target.metadata.activeSystemIds = [...target.metadata.activeSystemIds, ...source.metadata.activeSystemIds];
  target.metadata.activeTraitIds = [...target.metadata.activeTraitIds, ...source.metadata.activeTraitIds];
  return target;
};

export const compileMatchEffects = (
  team: Team,
  players: Player[],
  teamModules: TeamTacticEffectModule[] = [],
  traitModules: PlayerTraitEffectModule[] = []
) => {
  const effects = createBaseEffects();
  mergeEffectsInto(effects, compileTeamTacticEffects(team, players, teamModules));
  mergeEffectsInto(effects, compilePlayerTraitEffects(team, players, traitModules));
  return effects;
};

export const getTeamEnergyDrainMultiplier = (team: Team, players: Player[]) => (
  compileMatchEffects(team, players).energyDrain.multiplier
);

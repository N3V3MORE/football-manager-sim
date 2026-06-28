import {
  Player,
  assert,
  buildTestPlayer,
  createSeededRandom,
  initGameData,
  readSource,
} from './shared';
import { computeWeeklyTraining } from '../../src/core/trainingEngine';
import { scaleLineupForMatch } from '../../src/core/matchUtils';
import {
  TRAIT_REGISTRY,
  getPlayerTraits,
  getTraitBonuses,
  normalizePlayerTraits,
} from '../../src/core/traitEngine';

export const checkSeededPlayersNormalizeTraits = () => {
  const data = initGameData('Arsenal');
  const arsenal = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const saka = Object.values(data.players).find(player => player.teamId === arsenal?.id && player.name === 'B. Saka');

  assert(arsenal, 'Expected Arsenal in seeded data');
  assert(saka, 'Expected Bukayo Saka in seeded Arsenal data');
  const traits = getPlayerTraits(saka!);
  assert(traits.includes('Whipped Pass +'), 'Seeded traits should preserve plus variants');
  assert(traits.includes('Finesse Shot'), 'Seeded traits should include comma-separated secondary traits');
  assert(traits.every(trait => !trait.includes('"')), 'Seeded traits should strip escaped quote wrappers');
};

export const checkTraitRegistryCoversSeededTraits = () => {
  const seedRows = JSON.parse(readSource('src/data/english_league_players.json')) as Array<{ playerTraits?: unknown }>;
  const seedTraits = new Set(seedRows.flatMap(row => normalizePlayerTraits(row.playerTraits)));
  const missing = [...seedTraits].filter(trait => !TRAIT_REGISTRY[trait]);

  assert(missing.length === 0, `Trait registry should cover seeded traits: ${missing.join(', ')}`);
};

export const checkTraitBonusesExposeMechanicalEffects = () => {
  const template = Object.values(initGameData('Arsenal').players)[0];
  assert(template, 'Expected player template for trait bonus regression');

  const finisher = buildTestPlayer(template!, 'trait-finisher', 'trait-team', 'FWD', 70, {
    playerTraits: ['Finesse Shot +', 'Gamechanger', 'Dead Ball +'],
    stats: {
      ...template!.stats,
      shooting: 70,
      passing: 70,
      dribbling: 70,
      defending: 40,
      physical: 70,
    },
  } as Partial<Player>);

  const finishing = getTraitBonuses(finisher, 'finishing');
  assert(finishing.statBonus.shooting === 5, 'Finesse Shot + should add a finishing shooting bonus');
  assert(finishing.weightMultiplier > 1, 'Gamechanger should increase finishing selection weight');
  assert(finishing.penaltyBonus === 5, 'Dead Ball + should add the stronger penalty bonus');
};

export const checkTraitTrainingFocusAddsXp = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for trait training regression');

  const basePlayer = buildTestPlayer(templatePlayer!, 'base-trainee', templateTeam!.id, 'FWD', 68, {
    age: 18,
    morale: 80,
    energy: 100,
    potential: 88,
    trainingFocus: 'shooting',
    trainingXp: 0,
    playerTraits: [],
  });
  const traitPlayer = {
    ...basePlayer,
    id: 'trait-trainee',
    playerTraits: ['Finesse Shot'],
  };

  const basePatch = computeWeeklyTraining(basePlayer, templateTeam!, 3, createSeededRandom(44));
  const traitPatch = computeWeeklyTraining(traitPlayer, templateTeam!, 3, createSeededRandom(44));

  assert(
    (traitPatch.trainingXp || 0) > (basePatch.trainingXp || 0),
    'A trait matching the training focus should add weekly training XP'
  );
};

export const checkRelentlessTraitReducesFatiguePenalty = () => {
  const template = Object.values(initGameData('Arsenal').players)[0];
  assert(template, 'Expected player template for fatigue trait regression');

  const tiredPlayer = buildTestPlayer(template!, 'tired-control', 'trait-team', 'FWD', 70, {
    energy: 20,
    morale: 70,
    playerTraits: [],
    stats: {
      ...template!.stats,
      pace: 70,
      shooting: 70,
      passing: 70,
      dribbling: 70,
      defending: 40,
      physical: 70,
    },
  } as Partial<Player>);
  const relentlessPlayer = {
    ...tiredPlayer,
    id: 'tired-relentless',
    playerTraits: ['Relentless'],
  };

  const [scaledControl] = scaleLineupForMatch([tiredPlayer], 1, 1);
  const [scaledRelentless] = scaleLineupForMatch([relentlessPlayer], 1, 1);

  assert(
    scaledRelentless.stats.pace > scaledControl.stats.pace,
    'Relentless should soften fatigue penalties on physical match stats'
  );
};

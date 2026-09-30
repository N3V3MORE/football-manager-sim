import {
  assert,
  buildTestPlayer,
  buildTestTeam,
  computeWeeklyProgression,
  initGameData,
  Player,
} from './shared';
import { generateYouthPlayer } from '../../src/core/youthIntake';
import { computeWeeklyTraining, GOALKEEPER_TRAINING_STATS } from '../../src/core/trainingEngine';
import { sanitizePersistedState } from '../../src/store/persistence';

export const checkGoalkeeperTrainingUsesKeeperStats = () => {
  const data = initGameData();
  const template = Object.values(data.players).find(player => player.position === 'GK')!;
  const team = data.teams[template.teamId];
  const player = { ...template, age: 18, overallRating: 60, potential: 90, trainingXp: 99,
    trainingStatProgress: 2, trainingStatGains: {}, playerTraits: [],
    stats: { ...template.stats, gk_speed: 70, gk_reflexes: 70, gk_kicking: 70,
      gk_handling: 70, gk_positioning: 70, gk_diving: 70 } };
  for (const [focus, key] of Object.entries(GOALKEEPER_TRAINING_STATS)) {
    const patch = computeWeeklyTraining(player, team, 2, () => 0.5, { focusOverride: focus as keyof typeof GOALKEEPER_TRAINING_STATS });
    assert(patch.stats![key] === 71 && patch.trainingStatGains![key] === 1, 'Existing keeper focuses must train the mapped attribute');
    assert(patch.stats!.passing === player.stats.passing && patch.stats!.shooting === player.stats.shooting, 'Keeper training must leave outfield attributes unchanged');
    assert(patch.overallRating! > 60 && patch.overallRating! <= 90, 'Keeper overall must use keeper attributes and respect potential');
  }
  const balanced = computeWeeklyTraining(player, team, 2, () => 0.5, { focusOverride: null });
  assert(Object.keys(balanced.trainingStatGains!).every(key => key.startsWith('gk_')), 'Balanced keeper training must train keeper attributes');
  const capped = { ...player, stats: { ...player.stats, gk_reflexes: 99 }, trainingFocus: 'shooting' as const };
  const cappedPatch = computeWeeklyTraining(capped, team, 2, () => 0.5);
  assert(!cappedPatch.trainingStatGains?.gk_reflexes && !cappedPatch.stats, 'A capped attribute must not record a fictitious gain');
  const reloaded = sanitizePersistedState({ ...data, players: { [player.id]: { ...player, ...balanced, trainingFocus: 'shooting' } } });
  assert(reloaded.players![player.id].trainingStatGains?.gk_handling === 1, 'Save hydration must preserve keeper stat gains');
  assert(reloaded.players![player.id].trainingFocus === 'shooting', 'Legacy focus values must remain compatible');
};

const createStaticRng = (value: number) => ({ next: () => value });

export const checkWeeklyTrainingFocusRaisesFocusedStat = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for weekly training regression');

  const team = buildTestTeam(templateTeam, 'training-user', 'Training User');
  const trainee = buildTestPlayer(templatePlayer, 'training-forward', team.id, 'FWD', 64, {
    age: 18,
    morale: 80,
    energy: 100,
    potential: 82,
    trainingFocus: 'shooting',
    trainingXp: 96,
    stats: {
      ...templatePlayer.stats,
      pace: 64,
      shooting: 58,
      passing: 60,
      dribbling: 62,
      defending: 40,
      physical: 61,
    },
  } as Partial<Player>);

  const result = computeWeeklyProgression(
    2,
    { [trainee.id]: trainee },
    { [team.id]: team },
    {},
    [],
    team.id,
    createStaticRng(0.5),
    38
  );

  const nextPlayer = result.players[trainee.id];
  assert(nextPlayer.stats.shooting === trainee.stats.shooting + 1, 'Focused weekly training should raise the selected stat');
  assert((nextPlayer.trainingXp ?? 0) < 100, 'Weekly training should carry XP remainder after a stat gain');
  assert(nextPlayer.trainingStatGains?.shooting === 1, 'Weekly training should track stat gains this season');
};

export const checkTrainingRespectsPotentialCap = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for training potential cap regression');

  const team = buildTestTeam(templateTeam, 'capped-user', 'Capped User');
  const cappedPlayer = buildTestPlayer(templatePlayer, 'capped-mid', team.id, 'MID', 70, {
    age: 19,
    morale: 90,
    energy: 100,
    potential: 70,
    trainingFocus: 'passing',
    trainingXp: 99,
    stats: {
      ...templatePlayer.stats,
      pace: 70,
      shooting: 64,
      passing: 70,
      dribbling: 70,
      defending: 62,
      physical: 68,
    },
  } as Partial<Player>);

  const result = computeWeeklyProgression(
    2,
    { [cappedPlayer.id]: cappedPlayer },
    { [team.id]: team },
    {},
    [],
    team.id,
    createStaticRng(0.5),
    38
  );

  const nextPlayer = result.players[cappedPlayer.id];
  assert(nextPlayer.overallRating <= cappedPlayer.potential!, 'Training should not raise overall above hidden potential');
  assert((nextPlayer.trainingXp ?? 0) < 100, 'Capped training should still resolve accumulated XP');
};

export const checkSeasonEndProgressionRespectsPotentialCap = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for season-end potential cap regression');

  const team = buildTestTeam(templateTeam, 'season-cap-user', 'Season Cap User', { played: 1 });
  const cappedPlayer = buildTestPlayer(templatePlayer, 'season-capped-forward', team.id, 'FWD', 70, {
    age: 18,
    potential: 70,
    minutesPlayed: 90,
    matchRatingHistory: [8.4, 8.1, 8.0],
    trainingXp: 0,
  });

  const result = computeWeeklyProgression(
    38,
    { [cappedPlayer.id]: cappedPlayer },
    { [team.id]: team },
    {},
    [],
    team.id,
    createStaticRng(0),
    38
  );

  assert(
    result.players[cappedPlayer.id].overallRating === cappedPlayer.potential,
    'Season-end progression should not push a player above hidden potential'
  );
};

export const checkYouthIntakeAssignsHiddenPotential = () => {
  const youth = generateYouthPlayer('youth-potential', 'academy-team', 'MID', createStaticRng(0.4).next);

  assert(typeof youth.potential === 'number', 'Generated youth players should receive hidden potential');
  assert(youth.potential! > youth.overallRating, 'Generated youth potential should sit above current rating');
  assert(youth.potential! <= 95, 'Generated youth potential should stay within the academy ceiling');
};

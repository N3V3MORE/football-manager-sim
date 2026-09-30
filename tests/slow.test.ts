import test from 'node:test';
import { checkSeededSeasons, runCareer } from './regression/season';
import { useGameStore } from '../src/store/gameStore';
test('three seeded seasons: balance, cards, tactical diversity and weekly invariants', { concurrency: false }, checkSeededSeasons);
test('continuous five-season career: store progression, population, save hydration and recovery', { concurrency: false }, async () => {
  await useGameStore.persist.rehydrate();
  await runCareer(5, 12091, 'T1');
});

import { runtimeChecks } from './regression/runtime';
import { createSeededRandomGenerator } from '../src/core/random';
import test, { before } from 'node:test';
import { useGameStore } from '../src/store/gameStore';
import { domainChecks } from './regression/run';
import { worldChecks } from './regression/world';
import { lifecycleChecks } from './regression/lifecycle';
import { saveChecks } from './regression/save';
import { agentInteractionChecks, checkAgentRuntimeBridge } from './regression/agent';

before(async () => { await useGameStore.persist.rehydrate(); });
for (const check of [...domainChecks, ...worldChecks, ...lifecycleChecks, ...saveChecks, ...runtimeChecks, ...agentInteractionChecks,
  { name: 'agent: seeded commands, validation and cleanup', run: checkAgentRuntimeBridge }]) {
  test(check.name, { concurrency: false }, async () => {
    const originalRandom = Math.random;
    Math.random = createSeededRandomGenerator(20260513).next;
    try { await check.run(); } finally { Math.random = originalRandom; }
  });
}

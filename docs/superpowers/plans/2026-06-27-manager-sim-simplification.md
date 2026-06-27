# Manager Sim Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the core simulation code easier to understand without changing game behavior.

**Architecture:** Keep the existing pure-core/store/UI boundaries. Prefer extracting duplicated match-flow responsibilities from `src/core/matchEngine.ts` into focused pure helpers that are actually called by production code. Leave unrelated editor/tooling files unstaged unless they become directly relevant to the refactor.

**Tech Stack:** TypeScript, Expo/React Native, Zustand, custom `tsx` regression scripts.

---

### Task 1: Reuse Administrative Fixture Finalization

**Files:**
- Modify: `src/core/matchEngine.ts`
- Create: `src/core/matchFinalization.ts`
- Test: `scripts/agent_game_check.ts`

- [x] **Step 1: Replace the duplicated pre-match invalid-XI branch**

In `src/core/matchEngine.ts`, import `resolveAdministrativeFixture` from `./matchFinalization` and replace the direct `getAdministrativeFixtureOutcome` / team-stat update branch inside `quickSimMatch` with:

```ts
const finalized = resolveAdministrativeFixture(
  fixture,
  homeValidation.ok,
  awayValidation.ok,
  updatedTeams,
  updatedPlayers,
  homeStarters.map(player => player.id),
  awayStarters.map(player => player.id)
);
```

Return `finalized.players`, `finalized.teams`, and `finalized.fixture`, preserving the existing event text:

```ts
const eventPrefix = finalized.isVoid ? 'Fixture cannot be played' : 'Fixture resolved by forfeit';
matchEvents.push(`${eventPrefix}: ${homeValidation.reason || 'home XI legal'}; ${awayValidation.reason || 'away XI legal'}.`);
return {
  players: finalized.players,
  teams: finalized.teams,
  fixture: finalized.fixture,
  events: matchEvents,
};
```

- [x] **Step 2: Remove now-unused imports**

In `src/core/matchEngine.ts`, remove `applyFixtureSuspensionService`, `buildVoidFixture`, and `getAdministrativeFixtureOutcome` from the `./fixtureLifecycle` import if they are no longer referenced. They are still used by the live-match continuation and final quick-sim return path, so no import removal was correct for this slice.

- [x] **Step 3: Validate the slice**

Run:

```bash
npm run -s typecheck
npm run -s lint
npm run -s check:agent
```

Expected: all commands exit 0.

- [x] **Step 4: Commit**

Stage only the files in this task and commit:

```bash
git add src/core/matchEngine.ts docs/superpowers/plans/2026-06-27-manager-sim-simplification.md
git commit -m "refactor: reuse administrative fixture finalization"
```

### Task 2: Move Quick-Sim Substitution State Out Of Match Engine

**Files:**
- Modify: `src/core/matchEngine.ts`
- Modify: `src/core/matchSubstitutions.ts`
- Test: `scripts/agent_game_check.ts`

- [x] **Step 1: Export the shared state helpers**

In `src/core/matchSubstitutions.ts`, export the existing `SubstitutionState`, `createSubstitutionState`, and two state helpers:

```ts
export const canUseSubstitutionWindow = (state: SubstitutionState) => (
  state.substitutesUsed < state.maxSubstitutes && state.substitutionWindowsUsed < state.maxWindows
);

export const recordSubstitution = (state: SubstitutionState) => {
  state.substitutesUsed += 1;
  state.substitutionWindowsUsed += 1;
};
```

- [x] **Step 2: Use the shared helpers in quick simulation**

In `src/core/matchEngine.ts`, import:

```ts
import {
  applySubstitutions,
  canUseSubstitutionWindow,
  createSubstitutionState,
  recordSubstitution,
} from './matchSubstitutions';
```

Then remove the local `MatchSubstitutionState`, `createSubstitutionState`, `canUseSubstitutionWindow`, and `recordSubstitution` definitions.

- [x] **Step 3: Validate the slice**

Run:

```bash
npm run -s typecheck
npm run -s lint
npm run -s check:agent
```

Expected: all commands exit 0.

- [x] **Step 4: Commit**

Stage only the files in this task and commit:

```bash
git add src/core/matchEngine.ts src/core/matchSubstitutions.ts
git commit -m "refactor: share match substitution state helpers"
```

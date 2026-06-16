# v4 Roadmap

Updated: 2026-06-16

This roadmap is England-first and backend-first.

Core rule:
- Do not ship UI for systems that do not have real persistent backend state.

Primary source files for roadmap work:
- `src/models/types.ts`
- `src/store/gameStore.ts`
- `src/core/leagueUtils.ts`
- `src/core/competitionEngine.ts`
- `src/core/boardEngine.ts`

## Status Snapshot

| Track | Status | Notes |
| --- | --- | --- |
| `v4.0.x` stabilization | Active patch lane | Released `v4.0.1` |
| `v4.1.0` competitions backend | Release-ready | Backend complete; UI, persistence, and inbox audit done |
| `v4.2.0` board / manager / club depth | Release-ready | Backend complete; audit pass done across all three layers |
| `v4.3.0` transfers / contracts / squad planning | Not started | Depends on v4.1/v4.2 release |
| `v4.4.0` matchday and live sim depth | Not started | Depends on clearer event/state model |
| `v4.5.0` world-ready architecture | Not started | Depends on stable competition and board layers |

## Principles

- Keep core simulation state in pure engine modules.
- Keep the Zustand store as the single source of truth for persisted game state.
- Every persistent-state change needs an explicit migration path.
- Every subsystem needs deterministic regression coverage before release.
- Patch versions are for fixes, balancing, save safety, and presentation cleanup only.

## `v4.0.x` Patch Lane

Goal:
- Stabilize the current shipped experience without inventing placeholder systems.

Progress:
- Career flow, inbox wiring, squad/tactics presentation, and regression coverage improved in `v4.0.1`.
- Comprehensive audit pass completed in June 2026 covering core engines, store/state management, and UI integration.

Exit criteria:
- `typecheck`, `lint`, `test:ci`, `test:regression`, and `check:save` stay green on every patch.
- No shipped feature relies on a known-fake placeholder state.

## `v4.1.0` Real Competitions Backend

Goal:
- Make domestic cups and Europe real backend competitions instead of UI inference.

Progress already in workspace:
- Competition state exists for league, FA Cup, Carabao Cup, and Europe.
- Fixtures now carry competition identity, round metadata, knockout flags, and winner resolution.
- Season bootstrap and rollover now use a competition engine rather than league-only fixture setup.
- Hub and career flows now read competition state from one source of truth.
- Deterministic regression checks cover competition bootstrap, progression, Europe qualification, and fixture collisions.

Completed (June 2026):
- Full UI audit — no screen falls back to old placeholder wording for competitions.
- Persistence audit — mid-competition state survives save/load and older save migration.
- Competition-driven inbox and board phrasing verified.

Exit criteria:
- Cup draws and round progression are deterministic under seeded runs.
- No team receives overlapping fixtures in the same week.
- Europe qualification persists across save/load and season rollover.
- All competition-facing UI is backed by real competition state.

## `v4.2.0` Board, Manager, and Club Identity Depth

Goal:
- Replace the flat approval model with club-specific board context and manager-pressure logic.

Progress already in workspace:
- Every club now has `boardProfile` state covering ambition, patience, transfer discipline, and target competitions.
- Managers now track contract years remaining, pressure score, and replacement risk.
- A dedicated board engine now builds competition-aware objectives and runs board reviews.
- Weekly board review now updates approval, trust, security, pressure, and replacement risk together.
- Season rollover can now replace failing AI managers.
- AI replacement hiring now has seeded identity and contract variety instead of near-generic appointments.
- Sack warnings, season reviews, and job offers now explain decisions using board pressure and replacement-risk context.
- Board review now includes first-pass squad-age, wage-posture, and registration-depth pressure signals.
- Job-offer candidate selection now applies trajectory weighting for strong-season vs weak-season outcomes.
- The Board Room now shows board context and manager standing instead of only the approval bar.

Completed (June 2026):
- Comprehensive engine and store audit including board-review idempotency, form approval deltas, squad-context NaN guards, and `getReviewVerdict` deduplication.
- Persistence and UI audit covering board/career surfaces.

Still required before release:
- Stronger differentiation between big-club, promotion-club, and survival-club job-market behavior over multiple seasons.
- Tune board signal weights and expose clearer board telemetry for squad age, wage posture, and registration pressure.

Exit criteria:
- Different clubs produce meaningfully different objective sets and pressure curves.
- Sack and job-offer outcomes are explainable from stored club and manager state.
- AI manager changes do not corrupt team identity, tactics, or save state.
- Older saves migrate cleanly into the richer board and manager model.

## `v4.3.0` Transfers, Contracts, and Squad Planning

Goal:
- Add real squad-planning pressure and smarter recruitment behavior.

Planned scope:
- Positional need and depth evaluation.
- Wage structure and board wage posture.
- Contract renewal and expiry logic tied to role, value, and club ambition.
- Transfer-window behavior that respects squad size, wage budget, and role redundancy.
- Assistant and board messaging that points to concrete transfer or contract actions.

Dependencies:
- `v4.2` board and club context must be stable first.

Exit criteria:
- AI teams stop making obviously irrational transfer choices.
- Contract behavior reflects role, wage structure, and club ambition.
- Squad-planning state stays consistent across transfers, season rollover, and job changes.

## `v4.4.0` Matchday and Live Simulation Depth

Goal:
- Make matchday more legible and tactically responsive without splitting the simulation model in two.

Planned scope:
- Typed match-event taxonomy for commentary and reporting.
- Limited live tactical controls with real downstream impact.
- Better post-match explanation built from structured events instead of scoreline-only summaries.
- Clearer tactical identity in the event flow.

Dependencies:
- `v4.3` squad and contract logic should exist first so tactical choices happen in a richer team context.

Exit criteria:
- Quick sim and live sim remain statistically aligned.
- Commentary feels more varied without contradicting the actual match state.
- Tactical changes produce observable event and result differences.

## `v4.5.0` World-Ready Architecture

Goal:
- Remove hardcoded England assumptions from the core architecture without shipping full multi-country gameplay yet.

Planned scope:
- Typed competition and league-rule configs.
- Config-driven seasonal bootstrap.
- Stricter save metadata and validation.
- Cleaner country/competition boundaries in engine code.

Dependencies:
- Competition and board systems need to be stable first.

Exit criteria:
- Core systems can bootstrap from config without implicit England-only branches.
- Existing England saves still migrate and load cleanly.
- Future country support becomes a content/config problem instead of a core rewrite.

## Release Gates

Required checks for every release candidate:
- `npx tsc --noEmit`
- `npm run -s lint`
- `npm run -s test:ci`
- `npm run -s test:regression`
- `npm run -s check:save`
- `npm run -s check:agent`

Required scenario coverage by phase:
- `v4.1.0`: cup draw, cup progression, Europe qualification, season rollover, save/load mid-competition
- `v4.2.0`: board approval shifts, sack warnings, AI manager replacement, career transition after strong and weak seasons
- `v4.3.0`: contract expiry, renewal, AI transfer windows, wage-pressure decisions, squad-size enforcement
- `v4.4.0`: live tactical changes, commentary integrity, quick/live parity, event-to-report consistency
- `v4.5.0`: config-driven bootstrap, migration compatibility, no hardcoded England-only paths in core flows

## Immediate Next Steps

- Cut `v4.1.1` or `v4.2.0` release after final save/load verification on real device.
- Begin `v4.3.0` transfers and squad-planning work: positional need evaluation, wage structure, squad-size enforcement.
- Keep patch-lane fixes separate from new subsystem work.

What should not happen next:
- No fake cup or Europe UI.
- No version bump until the release criteria are actually met.
- No multi-country expansion before the England-first backend work is stable.

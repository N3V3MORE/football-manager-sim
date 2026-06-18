# v4 Roadmap

Updated: 2026-06-18

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
| `v4.0.x` stabilization | Stable patch lane | Released `v4.0.1`; superseded by the `v4.3.0` freeze |
| `v4.1.0` competitions backend | Stable | Backend, UI, persistence, and inbox checks satisfied |
| `v4.2.0` board / manager / club depth | Stable | Stability satisfied after the `v4.3.0` freeze checks |
| `v4.3.0` transfers / contracts / squad planning | Stable/frozen | Squad planning, transfer-window behavior, and release hygiene locked |
| `v4.4.0` matchday and live sim depth | Paused/not started | Depends on a clean `v4.3.0` release |
| `v4.5.0` world-ready architecture | Paused/not started | Depends on stable competition, board, and squad-planning layers |

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
- Full UI audit - no screen falls back to old placeholder wording for competitions.
- Persistence audit - mid-competition state survives save/load and older save migration.
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
- Board review now exposes structured signal telemetry for squad age profile, wage posture, and registration depth.
- Job-offer candidate selection now applies trajectory weighting for strong-season vs weak-season outcomes.
- The Board Room now shows board context and manager standing instead of only the approval bar.

Completed (June 2026):
- Comprehensive engine and store audit including board-review idempotency, form approval deltas, squad-context NaN guards, and `getReviewVerdict` deduplication.
- Persistence and UI audit covering board/career surfaces.
- Structured board signal telemetry added for squad age, wage posture, and registration pressure.
- Stability satisfied after the `v4.3.0` freeze checks.

Freeze monitoring:
- Multi-season board and job-market checks must stay explainable across big-club, promotion-club, and survival-club contexts.
- If those checks drift, tune constants only; do not add new board or job-market systems during the stable freeze.

Exit criteria:
- Different clubs produce meaningfully different objective sets and pressure curves.
- Sack and job-offer outcomes are explainable from stored club and manager state.
- AI manager changes do not corrupt team identity, tactics, or save state.
- Older saves migrate cleanly into the richer board and manager model.

## `v4.3.0` Transfers, Contracts, and Squad Planning

Goal:
- Add real squad-planning pressure and smarter recruitment behavior.

Status:
- Stable/frozen for `v4.3.0`.

Stable scope:
- Positional need and depth evaluation.
- Wage structure and board wage posture.
- Contract renewal and expiry logic tied to role, value, and club ambition.
- Transfer-window behavior that respects squad size, wage budget, and role redundancy.
- Assistant and board messaging that points to concrete transfer or contract actions.

Completed for stable freeze:
- Added a pure squad-planning engine with `SquadNeed`, `ContractDecision`, and `SquadPlan` outputs.
- Assistant contract warnings and recruitment notes now trace back to squad-planning output.
- AI weekly transfer movement now respects transfer windows and uses squad needs/contract decisions for first-pass listing and buying.
- AI transfer listing and buying now emits explainable decision logs with squad need, contract risk, board ambition, transfer discipline, and manager transfer identity.
- Strict and aggressive boards now diverge in wage-heavy backup contract decisions.

Transfer listing design:
- The managed club can list owned players anytime as sale intent.
- AI listing pools are refreshed by the weekly transfer engine; stale AI listings expire when the transfer window is closed.
- Player movement only happens inside transfer windows.

Dependencies:
- `v4.2` board and club context are stable for this freeze.

Exit criteria:
- AI teams stop making obviously irrational transfer choices.
- Contract behavior reflects role, wage structure, and club ambition.
- Squad-planning state stays consistent across transfers, season rollover, and job changes.
- Managed-club listings can update outside transfer windows; buying and selling players cannot.

## `v4.4.0` Matchday and Live Simulation Depth

Goal:
- Make matchday more legible and tactically responsive without splitting the simulation model in two.

Status:
- Paused/not started.

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

Status:
- Paused/not started.

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

Required commands for every release candidate:
- `npm ci`
- `npm run ci`
- `npm run gate:release`

Required scenario coverage by phase:
- `v4.1.0`: cup draw, cup progression, Europe qualification, season rollover, save/load mid-competition
- `v4.2.0`: board approval shifts, sack warnings, AI manager replacement, career transition after strong and weak seasons
- `v4.3.0`: contract expiry, renewal, AI transfer windows, wage-pressure decisions, squad-size enforcement
- `v4.4.0`: live tactical changes, commentary integrity, quick/live parity, event-to-report consistency
- `v4.5.0`: config-driven bootstrap, migration compatibility, no hardcoded England-only paths in core flows

## Immediate Next Steps

- Hold the `v4.3.0` stable freeze and run the release gate before tagging.
- Keep `v4.4` and `v4.5` paused until the `v4.3.0` release is clean.
- Keep patch-lane fixes separate from new subsystem work.

What should not happen next:
- No fake cup or Europe UI.
- No version bump beyond `v4.3.0` during the stable freeze.
- No multi-country expansion before the England-first backend work is stable.

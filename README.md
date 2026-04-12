# Football Manager Sim

Custom football manager simulation built with React Native, Expo, and Zustand.

The project is England-first and backend-first. The current codebase already covers league simulation, career progression, inbox flows, and squad/tactics control, and is now moving into real competition state plus deeper board and manager systems.

## Status

- Current tagged release: `v4.0.1`
- Current development line in this workspace: `v4.1` and `v4.2` foundation work
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Roadmap: [ROADMAP.md](./ROADMAP.md)

## Current State

- The English pyramid is playable across Premier League, Championship, League One, and League Two.
- League, FA Cup, Carabao Cup, and Europe now exist as first-class competition state in the backend rather than hub-only placeholders.
- Fixtures carry competition identity, round metadata, knockout flags, and winner resolution.
- Quick sim and live sim share the same underlying tactical and shape inputs to reduce drift.
- AI teams can adapt formations and tactics over time, including back-3, back-4, and back-5 structures.
- Player availability tracks injuries, suspensions, contracts, morale, energy, and inbox-triggered squad issues.
- The inbox handles assistant advice, board updates, system news, post-match reports, contract pressure, sack warnings, job offers, and career milestones.

## Career, Board, and Club Layer

- Career history persists across seasons with reputation, honours, season summaries, and a rolling record.
- Clubs now carry persistent board context: ambition, patience, transfer discipline, and target competitions.
- Managers now track trust, security, pressure, replacement risk, contract years remaining, and board-driven expectations.
- Weekly board reviews now consider objectives, form, league position versus target, competition outcomes, and spending discipline together.
- Season rollover can now replace failing AI managers instead of leaving every club static year after year.
- The Board Room screen exposes board context, manager standing, approval, pressure, and career history directly from persisted state.

## Roadmap Direction

The v4 path is now:

1. `v4.0.x` stabilization and regressions only
2. `v4.1.0` real competitions backend
3. `v4.2.0` board, manager, and club-context depth
4. `v4.3.0` transfers, contracts, and squad-planning depth
5. `v4.4.0` matchday and live-sim depth
6. `v4.5.0` world-ready architecture without full multi-country expansion

The detailed progress tracker and exit criteria live in [ROADMAP.md](./ROADMAP.md).

## Gameplay

- Pick a club and manage the starting XI from the pitch grid.
- Switch between Starting XI and Tactics inside the Squad tab.
- Use Settings for current-team controls, contract pressure, and squad availability.
- Review competition state from the hub and deeper club/career state from the Board Room.
- Play fixtures live or quick sim them.
- Manage budgets, transfers, morale, energy, injuries, suspensions, contracts, inbox flows, and multi-season career progression.

## Scripts

```bash
npm run start
npm run lint
npm run analyze
npm run track:season
npm run qa
npm run turbo
npm run test:ci
npm run test:regression
npm run check:save
npm run gate:release
```

- `analyze` runs a detailed single-season simulation report.
- `track:season` runs season integrity and tactical tracking. Set `SEASON_TRACKER_SEASONS=10` for larger batches.
- `qa` runs the autonomous store-level QA stress script.
- `turbo` runs fast multi-season simulation. Set `TURBO_SEASONS=50` to override the default.
- `test:ci` runs deterministic progression, career, competition, inbox, and state-consistency regression checks.
- `test:regression` runs deterministic engine regression checks.
- `check:save` audits persisted save shape after season skip and formation-map recovery.
- `gate:release` runs the full release gate: `tsc`, `lint`, `test:ci`, `test:regression`, and `check:save`.

## Setup

Requirements:

- Node.js 18+
- Expo Go, Android emulator, iOS simulator, or web target

```bash
git clone https://github.com/N3V3MORE/football-manager-sim.git
cd football-manager-sim
npm install
npm run start
```

## Versioning

- `package.json` and `app.json` should only move when a real release is cut.
- In-progress work is tracked in `CHANGELOG.md` under `Unreleased`.
- Roadmap status and implementation goals live in `ROADMAP.md`.

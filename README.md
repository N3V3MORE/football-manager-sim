# Football Manager Sim

Custom football manager simulation built with React Native, Expo, and Zustand.

The project is England-first and backend-first. The simulation covers league play, cup competitions, career progression, board and manager pressure systems, squad management, transfers, contracts, and an assistant inbox.

## Status

- Current tagged release: `v4.0.1`
- Active development: `v4.1` (competitions backend) and `v4.2` (board/manager depth) — foundation complete, nearing release
- Full version history: [CHANGELOG.md](./CHANGELOG.md)
- Detailed plan: [ROADMAP.md](./ROADMAP.md)

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

## Scripts

```bash
npm run start              # Start the Expo dev server
npm run typecheck          # tsc --noEmit
npm run lint               # ESLint
npm run analyze            # Detailed single-season simulation report
npm run track:season       # Season integrity and tactical tracking
npm run qa                 # Autonomous store-level QA stress test
npm run turbo              # Fast multi-season simulation (default 500 seasons)
npm run test:ci            # Deterministic progression, career, competition, inbox, and state-consistency checks
npm run test:regression    # Deterministic engine regression checks
npm run check:save         # Audits persisted save shape and formation-map recovery
npm run check:agent        # Agent-driven init, live match, quick sim, and weekly advance
npm run check:season       # Full-season agent playthrough
npm run test:news          # News-generation output test
npm run ci                 # Full CI: typecheck + lint + test:ci + test:regression + check:save + check:agent
npm run gate:release       # Alias for ci
```

### Analysis and tracking

- `turbo` defaults to 500 seasons. Override with `TURBO_SEASONS=50`.
- `track:season` defaults to 1 season. Override with `SEASON_TRACKER_SEASONS=10`.
- `gate:release` runs the full release gate before tagging a version.

## Versioning

- `package.json` and `app.json` version numbers only move when a release is cut.
- In-progress work is tracked in [CHANGELOG.md](./CHANGELOG.md) under `Unreleased`.
- Implementation goals and exit criteria live in [ROADMAP.md](./ROADMAP.md).

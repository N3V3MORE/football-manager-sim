# Football Manager Sim

Custom football manager sim built with React Native, Expo, and Zustand.

The current focus is a fast, inspectable match engine that can run full-season and multi-season simulations for tuning team/player realism.

## Current Engine

- Slot-aware formations feed into possession phases, so shape affects build-up support, central shielding, width, final-third access, and box presence.
- AI teams can adapt tactics and formations over the season, including back-3, back-4, and back-5 structures.
- Quick sim and live sim share the same tactical-shape inputs to reduce behavior drift.
- Card accounting tracks first yellows, second-yellow reds, straight reds, suspensions, and red-card event logs.
- Clean sheets are awarded from player on-pitch windows against conceded goal minutes, with a 60-minute qualification to avoid short defensive cameos skewing player stats.
- Season tracker audits score-log consistency, red-card logs, multi-yellow matches, formation usage, tactical changes, and player/team stat leaders.

## Gameplay

- Pick a club and set a starting XI with the pitch grid.
- Use 7-player benches and formation maps for manual lineup continuity.
- Run live match minutes or quick-sim fixtures.
- Track league table, player stats, awards, budgets, transfers, morale, energy, suspensions, and weekly news.

## Scripts

```bash
npm run start
npm run lint
npm run analyze
npm run track:season
npm run qa
npm run turbo
npm run test:regression
```

- `analyze` runs a detailed single-season simulation report.
- `track:season` runs season integrity and tactical tracking; set `SEASON_TRACKER_SEASONS=10` for larger batches.
- `qa` runs the autonomous store-level QA stress script.
- `turbo` runs fast multi-season simulation; set `TURBO_SEASONS=50` to override the default.
- `test:regression` runs deterministic engine regression checks.

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

## Version

Current version: `v3.1.0`

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

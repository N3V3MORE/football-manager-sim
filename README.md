# Football Manager Sim

Custom football manager sim built with React Native, Expo, and Zustand.

The current focus is a fast, inspectable match engine that can run full-season and multi-season simulations for tuning team/player realism.

## Current Engine

- Slot-aware formations feed into possession phases, so shape affects build-up support, central shielding, width, final-third access, and box presence.
- Leagues and competitions now use canonical registry ids, so world structure can be extended without screen-level string branching.
- The English pyramid is bootstrapped from local JSON data in `src/data/english_league_players.json`, with Premier League, Championship, League One, and League Two each running their own fixture list and table.
- FA Cup and Carabao Cup fixtures are also generated from the English clubs, and the calendar/match screens show competition and round labels.
- The league screen now uses a country pager plus a vertical division reel, so future countries can be added without changing the screen structure again.
- Shared simulation runtime caches now back week/season progression and long-run engine scripts.
- Every club now has a manager profile with reputation, trust, job security, preferred formations, tactical identity, and transfer style.
- AI teams can adapt tactics and formations over the season, including back-3, back-4, and back-5 structures.
- Expanded preset formations now include 3-4-2-1, 4-5-1, 4-2-2-2, and 3-2-4-1 alongside the existing shapes.
- Quick sim and live sim share the same tactical-shape inputs to reduce behavior drift.
- Card accounting tracks first yellows, second-yellow reds, straight reds, suspensions, and red-card event logs.
- Clean sheets are awarded from player on-pitch windows against conceded goal minutes, with a 60-minute qualification to avoid short defensive cameos skewing player stats.
- Player season stats are now tracked per league or cup scope, and completed seasons keep their original competition buckets even after promotion or relegation.
- Season tracker audits score-log consistency, red-card logs, multi-yellow matches, formation usage, tactical changes, and player/team stat leaders.

## Gameplay

- Pick a club and set a starting XI with the pitch grid.
- Switch between Starting XI and Tactics inside the Squad tab.
- Use the Settings tab for current-team controls and temporary dev tools.
- League and hub table views are filtered by the active league.
- Use the Stats screen scope chips to switch between league and cup leaderboards for the active or most recently completed season.
- Use 7-player benches and formation maps for manual lineup continuity.
- Run live match minutes or quick-sim fixtures.
- Advance the week directly with the quick-sim week action when you want all fixtures in that round to resolve together.
- Track league table, player stats, awards, budgets, transfers, morale, energy, suspensions, weekly news, trophies, and season finishes.

## Scripts

```bash
npm run start
npm run lint
npm run analyze
npm run track:season
npm run qa
npm run turbo
npm run bench:engine
npm run test:regression
npm run check:save
```

- `analyze` runs a detailed single-season simulation report.
- `track:season` runs season integrity and tactical tracking; set `SEASON_TRACKER_SEASONS=10` for larger batches.
- `qa` runs the autonomous store-level QA stress script.
- `turbo` runs fast multi-season simulation; set `TURBO_SEASONS=50` to override the default.
- `bench:engine` runs deterministic phase timing for match sim, progression, transfers, and season transition work.
- `test:regression` runs deterministic engine regression checks.
- `check:save` audits save-shaped state after season skip, formation-map recovery, and canonical save persistence.
- `season_tracker`, `turbo`, and regression scripts now run against the full multi-division season length.

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

Current version: `v3.2.4`

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

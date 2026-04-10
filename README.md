# Football Manager Sim

Custom football manager sim built with React Native, Expo, and Zustand.

The current focus is a fast, inspectable match engine that can run full-season and multi-season simulations for tuning team/player realism, with a full career meta-layer that persists across seasons.

## Current Engine

- Slot-aware formations feed into possession phases, so shape affects build-up support, central shielding, width, final-third access, and box presence.
- The English pyramid is bootstrapped from local JSON data in `src/data/english_league_players.json`, with Premier League, Championship, League One, and League Two each running their own fixture list and table.
- The league screen now uses a country pager plus a vertical division reel, so future countries can be added without changing the screen structure again.
- Every club now has a manager profile with reputation, trust, job security, preferred formations, tactical identity, and transfer style.
- AI teams can adapt tactics and formations over the season, including back-3, back-4, and back-5 structures.
- Expanded preset formations now include 3-4-2-1, 4-5-1, 4-2-2-2, and 3-2-4-1 alongside the existing shapes.
- Quick sim and live sim share the same tactical-shape inputs to reduce behavior drift.
- Card accounting tracks first yellows, second-yellow reds, straight reds, suspensions, and red-card event logs.
- Clean sheets are awarded from player on-pitch windows against conceded goal minutes, with a 60-minute qualification to avoid short defensive cameos skewing player stats.
- Player availability now tracks injuries and suspensions directly through weekly progression, squad selection, and season rollover.
- The assistant coach inbox now carries pre-match advice, post-match reports, board/system updates, contract warnings, recovery notes, sack warnings, job offers, and career milestones.
- Season tracker audits score-log consistency, red-card logs, multi-yellow matches, formation usage, tactical changes, and player/team stat leaders.

## Career Mode

Manager reputation (0–100) is a live stat that changes with results: +8 for winning a division, +4 for promotion, −10 for relegation, −5 for being sacked, +2 for a winning-record season.

Board approval below 20% for 3 consecutive weeks triggers a formal inbox warning; at 4+ weeks the board signals they will not renew your contract. At season end, if approval is still critical, you are sacked and offered jobs at clubs in an appropriate division tier.

Strong seasons generate unsolicited job offers from higher-division clubs delivered through the inbox. Accepting a job offer hands over your current team to AI management and starts the next season at the new club with your reputation intact.

The Board Room screen tracks your full career: seasons managed, W/D/L totals and bar, reputation, trophy cabinet (division titles and promotions), and a 10-season history with outcome pills.

## Gameplay

- Pick a club and set a starting XI with the pitch grid.
- Switch between Starting XI and Tactics inside the Squad tab.
- Use the Settings tab for current-team controls and temporary dev tools.
- Review contract pressure and unavailable players from Settings via Contract Watch and Availability Watch.
- League and hub table views are filtered by the active division.
- Use 7-player benches and formation maps for manual lineup continuity.
- Run live match minutes or quick-sim fixtures.
- Track league table, player stats, awards, budgets, transfers, morale, energy, injuries, suspensions, contracts, and inbox reports.
- Build a multi-season career: manage board pressure, take job offers, accumulate trophies, and grow your reputation across divisions.

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
```

- `analyze` runs a detailed single-season simulation report.
- `track:season` runs season integrity and tactical tracking; set `SEASON_TRACKER_SEASONS=10` for larger batches.
- `qa` runs the autonomous store-level QA stress script.
- `turbo` runs fast multi-season simulation; set `TURBO_SEASONS=50` to override the default.
- `test:ci` runs the deterministic inbox, progression, and state-consistency regression suite.
- `test:regression` runs deterministic engine regression checks.
- `check:save` audits save-shaped state after season skip and formation-map recovery.
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

Current version: `v4.0.1`

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

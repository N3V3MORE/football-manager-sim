# Football Manager Sim

Custom football manager simulation built with React Native, Expo, and Zustand.

The project is England-first and backend-first. The simulation covers league play, cup competitions, career progression, board and manager pressure systems, squad management, transfers, contracts, and an assistant inbox.

## Status

- Current release: `v4.3.0` stable freeze
- Release gate: `npm run gate:release`
- Next tracks: `v4.4` and `v4.5` are paused/not started
- Full version history: [CHANGELOG.md](./CHANGELOG.md)
- Detailed plan: [ROADMAP.md](./ROADMAP.md)

## Setup

Requirements:
- Node.js 20.19.4+ (Node 22 used in CI)
- Expo Go, Android emulator, iOS simulator, or web target

```bash
git clone https://github.com/N3V3MORE/football-manager-sim.git
cd football-manager-sim
npm install
npm run start
```

## Scripts

```bash
npm start                  # Expo dev server
npm run typecheck          # TypeScript
npm run lint               # ESLint, no warnings
npm test                   # Fast behavioral tests, serial execution
npm test -- --test-name-pattern="transfer"  # Target named cases
npm run test:slow          # Three seeded world seasons + continuous five-year career
npm run simulate -- --mode=career --seasons=3 --seed=12091
npm run simulate -- --mode=world --seasons=1 --seed=20260513
npm run bench -- --samples=7 --warmups=2 --seed=12091
npm run check:deadcode     # Unused exports
npm run doctor:release    # Expo Doctor gate
npm run ci                # Typecheck + lint + fast tests
npm run gate:release      # CI + slow tests + dead-code + Doctor + all-platform export
```

Simulation runs are sequential CPU workloads, bounded to ten seasons. Benchmarks cover matches, week advancement, rollover (including expiring contracts), youth intake, and Sim & Exit. They are bounded to thirty samples and compare seeded fingerprints, RNG draws, RNG continuation, timings, and save counts; use `--scenario=rollover` or `--scenario=youth` to target those cases. Caches are transient and do not change the save schema. Sim & Exit saves once at completion; interrupted completion resumes from the pre-exit autosave.

Pull requests and pushes to main run fast CI once. Release tags (`v*`) and manual workflow runs execute the complete release gate once.

## Versioning

- `package.json` and `app.json` are aligned on `4.3.0`.
- Post-freeze work is tracked in [CHANGELOG.md](./CHANGELOG.md) under `Unreleased`.
- Implementation goals and exit criteria live in [ROADMAP.md](./ROADMAP.md).

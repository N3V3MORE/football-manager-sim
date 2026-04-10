# Changelog

## v3.2.3 - Fix backend accounting and modularize the frontend

What changed:
- Fixed live-match post-processing so starters do not lose energy twice compared with quick sim.
- Corrected substitute minute tracking so players only get credit for the interval they actually played.
- Fixed board-objective progression so generated `position` and `spend` objectives are evaluated properly.
- Stopped `position` objectives from completing permanently off early tied-table ordering before the season meaningfully settles.
- Split the Hub, Squad, Transfers, Calendar, Stats, and Settings screens into smaller feature components without changing the existing design.
- Centralized repeated team-colour fallback handling and trimmed duplicated screen-level render code.
- Added extra CI stress checks for live-match energy, board-objective repeat-award guards, full-season state consistency, and clamped weekly budgets so they cannot fall below zero.

Notes:
- Re-ran `lint`, `tsc`, `test:ci`, and regression/QA checks after the cleanup passes to keep the refactor honest.

## v3.2.2 - Polish the league navigation

What changed:
- Added a reusable page header with an explicit `Hub` back action so the root pages no longer rely on the default navigator label.
- Tightened the board, calendar, stats, and league headers so the top of each screen uses less empty space.
- Reworked the league screen into a proper two-axis layout: horizontal country paging and vertical division reels inside each country.
- Added a return-to-top button for each country section to make long tables easier to navigate.
- Cleaned the remaining label encoding issue in the page headers by switching them to plain ASCII text.

## v3.2.1 - Merge squad and tactics

What changed:
- Combined Starting XI and Tactics into one Squad tab with a top switcher.
- Added a Settings tab for current-team controls and temporary dev tools.
- Moved change-team and season-skip dev controls out of the Hub.
- Hid the old Tactics tab route from the tab bar while keeping the route available.
- Added missing tab icon mappings so the new Settings tab and existing tab icons render correctly.

## v3.2.0 - Fix lineup views and player ordering

What changed:
- Added shared formation-map cleanup so stale maps cannot put players in impossible slots like a striker at GK or a keeper at LW.
- Reworked the last-starting-XI modal into a compact pitch view, with substitutes listed underneath.
- Standardized player list ordering to GK, DEF, MID, FWD across squad, match, league lineup, and transfer screens.
- Mirrored the away side of the next-fixture card so its team colours and AWAY tag sit on the away side.
- Added regression coverage for wrong-position formation maps.

## v3.1.0 - Clean up the squad screen

What changed:
- Fixed squad pitch drag-and-drop so players snap to the nearest slot instead of hitting overlapping drop boxes on narrow phones.
- Improved Android drag layering by lifting the active player with state-driven `zIndex` and `elevation`.
- Stopped the swapped player from flying back across the screen after a successful drag swap.
- Spread formation rows more evenly over the pitch and tightened the dot/name/rating alignment.
- Added recovery for stale formation maps so starters do not disappear from the pitch and reserves after a season skip.
- Kept AI tactical/formation adaptation away from the user team during weekly progression.
- Replaced native transfer prompts with in-app bid/listing modals and cleaned up a few rough UI labels.

## v3.0.2 - Stabilize the sim and tidy the code

What changed:
- Added regression checks for clean-sheet windows, live red-card minutes, second-yellow accounting, quick/live shape parity, and formation diversity.
- Added a 60-minute clean-sheet qualification so short substitute appearances do not inflate defender/keeper leaderboards.
- Added package scripts for `qa`, `turbo`, and `test:regression`.
- Updated the README with the current repo name, setup steps, version, and engine notes.
- Split large match-engine code into smaller files for lineup selection, shape profiling, substitutions, match utilities, and post-match accounting.
- Split weekly progression code so transfers and tactical adaptation live in their own modules.
- Cleaned broken/garbled console output in the QA and turbo scripts.
- Made turbo sim season count configurable with `TURBO_SEASONS`.
- Updated detailed sim report wording so the goal-volume reference range matches current calibration.

## v3.0.1 - Fix match accounting and tactical behaviour

What changed:
- Formation slots now feed into possession simulation, so shape affects width, central cover, build-up support, final-third pressure, and box presence.
- Quick-sim substitutions now react to match state instead of swapping players at random.
- Added season tracking output for score/log integrity, red-card logs, tactical changes, and formation usage.
- AI teams can now adapt formations over a season instead of staying locked to back-four setups.

Fixes:
- Fixed second-yellow reds so the second booking is counted as a yellow before the red.
- Fixed live-match red-card minutes so sent-off players no longer get automatic 90-minute appearances.
- Fixed clean-sheet attribution so it checks whether a player was on the pitch when goals were conceded.
- Kept quick sim and live sim on the same tactical-shape inputs.

Notes:
- Added `tsx` for the simulation scripts.
- Ignored generated simulation reports.
- Rebalanced engine constants after the shape/tactics changes so goal volume stayed reasonable.

## v3.0.0 - Move the match engine out of the store

What changed:
- Moved match simulation into a pure engine path so it can run without the Zustand store.
- Added fast long-run simulation tooling with `turbo_sim.ts`.
- Added detailed season analysis tooling with `detailed_season_sim.ts`.
- Tuned scoring toward a realistic league-wide goals-per-match range.
- Reworked midfield/build-up/chance creation logic so lower-rated teams are not locked out of matches by rating gaps alone.
- Tuned foul and card volume closer to professional match levels.

## v2.0.0 - Improve the basic game loop

What changed:
- Reworked the match engine so top players can have a bigger impact without one player dominating every stat.
- Fixed missing-team data issues so the league has the expected 20 teams.
- Added fallback squad generation when source data is thin.
- Updated awards naming and filtered Golden Glove candidates to goalkeepers.
- Reworked pitch-grid layout and player labels.

Fixes:
- Reduced assist hoarding from individual creators.
- Fixed league-table wrapping when goal difference was very large.
- Simplified player IDs.

## v1.0.0 - First playable version

What changed:
- Added manual squad selection.
- Added a 7-player bench.
- Added basic match tuning for more reasonable season totals.
- Added AI lineup auto-fill so simulated teams can field an XI.
- Cleaned position labels.
- Added simple tactical controls.

Fixes:
- Stopped matches from running against empty AI lineups.
- Reduced goalkeeper card frequency.
- Fixed left/right wide-position mapping on the pitch.

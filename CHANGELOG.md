# Changelog

## Unreleased

### v4.1 foundation - Real competitions backend

What changed:
- Added first-class competition state for league, FA Cup, Carabao Cup, and Europe instead of treating domestic cups and Europe as hub placeholders.
- Extended fixtures with competition identity, round metadata, knockout flags, and winner resolution so non-league competitions can progress cleanly.
- Added a dedicated competition engine to bootstrap season competitions, resolve knockout rounds, expose team-facing competition panels, and carry Europe qualification into the next season.
- Updated season rollover, match resolution, inbox messaging, career history, and board logic to consume competition state from one source of truth.
- Added deterministic regression coverage for competition bootstrap, knockout progression, Europe qualification, and no-overlap fixture scheduling.

Notes:
- This work is in the codebase but not released as a tagged version yet.

### v4.2 foundation - Board, manager, and club-context depth

What changed:
- Added persistent `boardProfile` state to every club covering ambition, patience, transfer discipline, and target competitions.
- Expanded manager state with contract years remaining, pressure score, and replacement risk so sack/job logic is not driven by approval alone.
- Added a pure board engine to generate competition-aware board objectives, evaluate season reviews, calculate board pressure, and decide when AI clubs replace managers.
- Reworked weekly board reviews so approval, trust, security, pressure, and replacement risk move together instead of using a flat objective-plus-form delta.
- Updated season rollover so every club gets a board review, next-division board profile, and possible AI manager replacement before the new season is built.
- Added seeded AI replacement-manager generation with varied identity, tactical profile, contract length, and initial pressure context.
- Extended the Board Room screen and inbox/career messaging to show real club context, board expectations, and manager pressure.
- Expanded career and board inbox explanations so sack warnings, season verdicts, and job offers include explicit pressure/replacement-risk context.
- Added first-pass board-pressure context from squad age profile, wage posture, and registration depth so review outcomes are less flat.
- Started trajectory-based job-market weighting so strong seasons skew toward ambitious openings and weak seasons skew toward survival/stability openings.
- Hardened save migration and season rollover from mid-season states, including competition persistence and managed-team lineup reseeding.
- Tightened tactical adaptation behavior under pressure and added tactical-spread guardrails in CI.
- Added deterministic regression coverage for board-profile objective shape, elite-vs-survival pressure behavior, AI manager replacement, competition progression, migration integrity, tactical spread, and red-card event consistency.

Notes:
- This is active `v4.2` work. Package and app versions remain `v4.0.1` until a release is cut.

## v4.0.1 - Career flow fixes and presentation pass

What changed:
- Fixed the season-end career loop so titles, job offers, team changes, board objectives, and inbox context stay consistent through sack/re-hire transitions.
- Restored the settings and inbox surfaces after the v4 integration pass, including career inbox actions and safer managed-team message pruning.
- Tightened the squad and tactics presentation: pitch markers are aligned, the compact last-starting-XI pitch is smaller and cleaner, and the broader square-edge pass is now consistent across the shared squad UI.
- Brought back the Hub competition watch panes for Carabao Cup, FA Cup, and Europe while keeping the current backend limitations explicit instead of faking round progression.
- Expanded live match commentary plus assistant and board inbox phrasing so match flow and weekly communication feel less repetitive.
- Added regression coverage for title handling, job-offer objective wiring, and the wider v4 state-transition path.

Notes:
- Re-ran `tsc`, `lint`, `test:ci`, and `test:regression` before release.

## v4.0.0 - Manager career mode

What changed:
- Added a persistent `CareerRecord` that survives `advanceSeason`: seasons managed, total W/D/L/GF/GA, reputation (0-100), trophy cabinet, and a rolling 10-season history.
- Reputation now moves dynamically: +8 for winning a division, +4 for promotion, -10 for relegation, -5 for being sacked, +2 for a winning-record season. Previously `Manager.reputation` was a static initialisation value.
- Added sacking-risk tracking: `consecutiveLowApprovalWeeks` increments each week board approval stays below 20%. At 3 consecutive weeks the board issues a formal warning in the inbox; at 4+ the board declares they will not renew the contract at season end.
- At season end the career engine evaluates the final table position, writes a `SeasonSummary`, updates the career record, and generates up to 2 job offer inbox messages from candidate clubs in an appropriate division tier. Accepting a job offer changes the managed team immediately, dismisses all other pending offers, and resets the sacking counter.
- Added `TrophyEntry`, `SeasonSummary`, and `CareerRecord` types to `src/models/types.ts`. Extended `GameState` with `careerRecord`. Added `career_sack_warning`, `career_job_offer`, and `career_milestone` inbox categories and an `accept_job_offer` inbox action.
- Added `src/core/careerEngine.ts` with `createDefaultCareerRecord`, `buildSeasonSummary`, `applySeasonEndToCareer`, `evaluateSackingRisk`, and `generateJobOfferCandidates`.
- Added `generateCareerInboxMessages` and `generateSackWarningMessage` to `src/store/inboxHelpers.ts`.
- Expanded the Board Room screen with a Career Summary panel (W/D/L bar, reputation, honours count), a Trophy Cabinet section, and a Season History list with outcome pills.
- Added `components/hub/career-stats-card.tsx`: a compact Hub card showing seasons managed, honours, win rate, and titles. Appears on the Hub after the first season completes.
- Bumped Zustand persist version to 6; existing saves migrate cleanly through `sanitizePersistedState`.
- Added `runCareerEngineChecks` to `scripts/ci_regression.ts` covering default state shape, season summary derivation, reputation delta math, reputation clamping, season history cap, and sacking-risk thresholds.

Notes:
- Re-ran `test:ci` after all changes; all four check groups pass.

## v3.4.0 - Add player availability and contract pressure

What changed:
- Added injury state, weekly recovery, and availability gating so injured or suspended players cannot leak into lineup, bench, or match selection.
- Added contract-expiry handling, one-tap renewals, and season-rollover departures for user players whose deals are allowed to expire.
- Extended the assistant coach inbox with recovery updates, contract warnings, renewal recommendations, and post-match injury notes.
- Added a contract-management surface in Settings with Contract Watch and Availability Watch cards so squad issues are visible outside the inbox.
- Kept direct renewals and inbox renewal actions on the same store path so stale contract warnings are cleared instead of lingering as bad actions.
- Expanded deterministic regression coverage for injury recovery, availability enforcement, contract renewal, and season-end departures.

Notes:
- Re-ran `lint`, `tsc`, `test:ci`, `test:regression`, and `qa` after the v3.4 work.

## v3.3.0 - Add the assistant coach inbox

What changed:
- Replaced the old latest-news feed with a structured inbox and a Hub inbox preview.
- Added mixed inbox messages for assistant coach advice, system news, board updates, and post-match reports.
- Added actionable assistant items for lineup and tactic suggestions, with transfer notes staying advice-only.
- Added save-safe inbox persistence, legacy `news` migration, message dedupe, and inbox size capping.
- Added a dedicated Inbox screen and reusable inbox message cards without changing the main tab structure.
- Expanded CI regression coverage for inbox migration, dedupe, action application, post-match reporting, and seeded stress runs with inbox generation enabled.

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

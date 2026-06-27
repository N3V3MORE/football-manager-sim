# Changelog

## Unreleased

What changed:
- Added a five-season agent regression gate and dead-code check to the release path.
- Tightened the release gate to run Expo Doctor and export before publishing.
- Removed an unused match-substitution facade so the engine-facing module stays smaller.

## v4.3.0 - Stable freeze

### Board telemetry and squad planning

What changed:
- Added structured `BoardSignalBreakdown` telemetry for squad age profile, wage posture, and registration depth while preserving existing board-review approval/pressure behavior.
- Added a pure `squadPlanningEngine` that evaluates positional needs and contract decisions from squad depth, availability, age, wage load, board ambition, and contract risk.
- Updated assistant contract warnings and recruitment notes to use squad-planning decisions instead of ad hoc weak-position checks.
- Updated AI transfers to respect transfer windows when weekly progression runs, and to buy/list from squad needs and contract decisions rather than only weak-starter heuristics.
- Added explainable AI transfer decision logs for listed and bought players, including squad need, contract decision, board ambition, transfer discipline, manager transfer identity, and reason text.
- Tuned squad planning so strict boards react earlier to wage-heavy backups while aggressive boards tolerate higher wage load.
- Added deterministic regression coverage for board signal breakdowns, squad-planning severity, contract renewal decisions, board-discipline wage behavior, transfer-window no-op/open-window need-led purchases, and transfer-decision rationale.

### Comprehensive audit pass

What changed:
- Fixed live-match idempotency: processed minutes are tracked so replaying a minute does not double-drain energy or replay possessions.
- Fixed live-match score safety: `finishLiveMatchState` now explicitly writes `homeScore` and `awayScore` on the fixture so post-match reports and persistence never see null scores.
- Fixed stale live-match recovery: persisted live matches are dropped when they point to missing, played, wrong-week, or invalid-team fixtures.
- Fixed direct live-match finish safety: direct `finishLiveMatchState` calls now process unprocessed minutes before final accounting instead of creating artificial 0-0 finishes.
- Added a dev recovery action to clear invalid stuck live-match state from settings and the agent bridge.
- Fixed formation-map preservation: `setFormationState` now uses `split('-')` instead of `split(' ')` so switching between formations with the same defender count preserves player assignments.
- Fixed board-review idempotency: `boardReviewAppliedWeek` guard prevents double-evaluation from manual `checkBoardObjectives` after the weekly lifecycle already ran.
- Fixed injury/suspension off-by-one: `suspensionAppliedWeek` and `injuryAppliedWeek` track the week of application so durations are not decremented in the same week the card/injury was handed out.
- Fixed transfer-sale gap: AI teams can now buy user-listed players, and `buyPlayerState` validates that the player is transfer-listed, the player is not on the user's team, and the asking price is finite.
- Fixed `advanceWeek` live-match guard: fixtures with an active live-match state are skipped during weekly quick-sim to prevent double-processing.
- Fixed `initializeGame` mutation: player objects from `initGameData` are now spread-copied instead of mutated in place.
- Fixed transfer double-run: `transfersAppliedWeek` guard prevents `processWeeklyTransfers` from running twice when called both manually and inside `advanceWeek`.
- Fixed `accept_job_offer` error handling: accepting a job for a nonexistent team now marks the triggering message as read instead of silently failing.
- Fixed date-format mismatch: `calculateAgeFromDob` now handles both `DD/MM/YYYY` and `YYYY-MM-DD` formats, fixing NaN age calculations for generic and replacement managers.
- Fixed `impactCoefficient` NaN propagation: defaulted to `1.0` with null-coalescing so missing values don't produce NaN match ratings.
- Fixed `overallRating` bounds: player ratings are clamped to `[1, 99]` during end-of-season progression.
- Fixed `clampBoardMetric` rounding: now uses `Math.round` consistently with `clampMetric` in `managerUtils`.
- Fixed `getReviewVerdict` duplication: exported from `boardEngine` and reused in `careerEngine` instead of being defined twice.
- Fixed form approval delta: `getFormApprovalDelta` now considers the last 3 results instead of only the most recent match.
- Fixed competition penalty for non-entrants: teams not entered in a competition are no longer penalized for missing cup-round objectives.
- Fixed Continental division normalization: `buildBoardObjectives` early-return for Continental teams no longer blocked in `seasonTransition`.
- Fixed shape-engine GK/outfield assignment: fallback slot assignment now prevents goalkeepers from filling outfield roles and vice versa.
- Fixed third-pass formation-map rebuild: positional compatibility checked before assigning leftover starters to slots.
- Fixed transfer depth accounting: `depthByPosition` now counts all squad players, not just non-transfer-listed ones, preventing overselling a position.
- Fixed injury chance calculation: `getTeamInjuryChance` now filters to healthy players before computing high-load percentages.
- Fixed match-screen memory leak: `minuteRef` resets on fixture change and a mounted guard prevents state updates after unmount.
- Fixed squad formation loop: `rebuildLockRef` prevents recursive `setFormation` calls from the auto-rebuild effect.
- Fixed hardcoded season dates: Hub and Calendar now import `SEASON_START` and `getWindowStatus` from `calendar.ts`.
- Fixed transfer-window guard: `handleSubmitDialog` re-checks window status at submit time, not just on tap.
- Fixed `skipToEndOfSeason` guard: increased iteration margin from `+2` to `+20` and wrapped in try/catch.
- Fixed `skipToEndOfSeason` failure visibility: development failures now warn instead of being silently swallowed.
- Fixed `renew_contract` inbox action: triggering message is now marked as read and its action cleared, consistent with other action branches.
- Fixed persistence migration: `suspensionAppliedWeek`, `injuryAppliedWeek`, `tactics`, `matchRatingHistory`, `contractLeft`, and stat fields now receive safe defaults during sanitization.
- Fixed `safeStorage`: save/remove errors now logged via `console.warn` instead of silently swallowed.
- Fixed LiveMatchState persistence: entries missing required `homeStarterIds` or `awayStarterIds` are dropped on rehydration.
- Fixed `getLeagueCountry` and `getLeagueCountryIndex`: defensive fallback for empty `LEAGUE_COUNTRIES` array, and unknown country IDs return `-1` instead of silently mapping to `0`.
- Fixed `weightedPick` caller safety: `||` replaced with `??` in `resolveRandom`, and `minutesShare` clamped to `[0, 1]` in transfer engine.
- Fixed `player.position` NaN guard in `buildSquadContextSignal`: only increments known position keys.
- Fixed `shouldReplaceManagerAfterReview` fallback: uses `reasons.find()` instead of brittle `reasons[0] ||` pattern.
- Fixed `getGenericManagerIdentity` missing League Two case: added explicit identity config.
- Fixed `getCompetitionResultForTeam`: teams still active in a competition no longer receive premature round-finish credit.
- Fixed `getCompetitionPanelForTeam`: empty rounds array is guarded before access.
- Fixed `buildRoundRobinFixtures`: throws `RangeError` on insufficient `weekSlots` length instead of producing week-number collisions.
- Fixed `clampToMatchMinutes` duplication: exported from `minuteMapUtils`, imported in `postMatchAccounting`.
- Updated `shouldRenewContract`: players aged 33+ with `overallRating < 80` are now excluded from renewal recommendations.
- Updated `getFormApprovalDelta`: considers last 3 form tokens (W/D/L), returning `wins - losses` instead of a single-match delta.

Notes:
- Added GitHub Actions release-gate enforcement for pull requests and `v*` tag pushes.
- Release gate coverage is `npm run ci` followed by `npm run gate:release`.
- Package and app versions are aligned on `4.3.0`.

### v4.1 foundation - Real competitions backend

What changed:
- Added first-class competition state for league, FA Cup, Carabao Cup, and Europe instead of treating domestic cups and Europe as hub placeholders.
- Extended fixtures with competition identity, round metadata, knockout flags, and winner resolution so non-league competitions can progress cleanly.
- Added a dedicated competition engine to bootstrap season competitions, resolve knockout rounds, expose team-facing competition panels, and carry Europe qualification into the next season.
- Updated season rollover, match resolution, inbox messaging, career history, and board logic to consume competition state from one source of truth.
- Added deterministic regression coverage for competition bootstrap, knockout progression, Europe qualification, and no-overlap fixture scheduling.

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

## v4.0.1 - Career flow fixes and presentation pass

What changed:
- Fixed the season-end career loop so titles, job offers, team changes, board objectives, and inbox context stay consistent through sack/re-hire transitions.
- Restored the settings and inbox surfaces after the v4 integration pass, including career inbox actions and safer managed-team message pruning.
- Tightened the squad and tactics presentation: pitch markers are aligned, the compact last-starting-XI pitch is smaller and cleaner, and the broader square-edge pass is now consistent across the shared squad UI.
- Brought back the Hub competition watch panes for Carabao Cup, FA Cup, and Europe while keeping the current backend limitations explicit instead of faking round progression.
- Expanded live match commentary plus assistant and board inbox phrasing so match flow and weekly communication feel less repetitive.
- Added regression coverage for title handling, job-offer objective wiring, and the wider v4 state-transition path.

## v4.0.0 - Manager career mode

What changed:
- Added a persistent `CareerRecord` that survives `advanceSeason`: seasons managed, total W/D/L/GF/GA, reputation (0-100), trophy cabinet, and a rolling 10-season history.
- Reputation now moves dynamically: +8 for winning a division, +4 for promotion, -10 for relegation, -5 for being sacked, +2 for a winning-record season.
- Added sacking-risk tracking: `consecutiveLowApprovalWeeks` increments each week board approval stays below threshold. At 3 consecutive weeks a formal warning is issued; at 4+ the board declares non-renewal at season end.
- At season end the career engine evaluates the final table position, writes a `SeasonSummary`, updates the career record, and generates up to 2 job offer inbox messages from candidate clubs in an appropriate division tier. Accepting a job offer changes the managed team immediately.
- Added `TrophyEntry`, `SeasonSummary`, and `CareerRecord` types. Extended `GameState` with `careerRecord`. Added `career_sack_warning`, `career_job_offer`, and `career_milestone` inbox categories and an `accept_job_offer` inbox action.
- Added `src/core/careerEngine.ts` with `createDefaultCareerRecord`, `buildSeasonSummary`, `applySeasonEndToCareer`, `evaluateSackingRisk`, and `generateJobOfferCandidates`.
- Added `generateCareerInboxMessages` and `generateSackWarningMessage` to inbox helpers.
- Expanded the Board Room screen with a Career Summary panel, a Trophy Cabinet section, and a Season History list with outcome pills.
- Added `components/hub/career-stats-card.tsx`: a compact Hub card showing seasons managed, honours, win rate, and titles.
- Bumped Zustand persist version to 6; existing saves migrate cleanly through `sanitizePersistedState`.
- Added `runCareerEngineChecks` to CI regression covering default state, season summary derivation, reputation deltas, clamping, and sacking-risk thresholds.

## v3.4.0 - Add player availability and contract pressure

What changed:
- Added injury state, weekly recovery, and availability gating so injured or suspended players cannot leak into lineup, bench, or match selection.
- Added contract-expiry handling, one-tap renewals, and season-rollover departures for user players whose deals are allowed to expire.
- Extended the assistant coach inbox with recovery updates, contract warnings, renewal recommendations, and post-match injury notes.
- Added a contract-management surface in Settings with Contract Watch and Availability Watch cards so squad issues are visible outside the inbox.
- Expanded deterministic regression coverage for injury recovery, availability enforcement, contract renewal, and season-end departures.

## v3.3.0 - Add the assistant coach inbox

What changed:
- Replaced the old latest-news feed with a structured inbox and a Hub inbox preview.
- Added mixed inbox messages for assistant coach advice, system news, board updates, and post-match reports.
- Added actionable assistant items for lineup and tactic suggestions.
- Added save-safe inbox persistence, legacy `news` migration, message dedupe, and inbox size capping.

## v3.2.3 - Fix backend accounting and modularize the frontend

What changed:
- Fixed live-match post-processing so starters do not lose energy twice compared with quick sim.
- Corrected substitute minute tracking so players only get credit for the interval they actually played.
- Fixed board-objective progression so generated `position` and `spend` objectives are evaluated properly.
- Split the Hub, Squad, Transfers, Calendar, Stats, and Settings screens into smaller feature components without changing the existing design.
- Added extra CI stress checks for live-match energy, board-objective repeat-award guards, full-season state consistency, and clamped weekly budgets.

## v3.2.2 - Polish the league navigation

What changed:
- Added a reusable page header with an explicit Hub back action.
- Reworked the league screen into a proper two-axis layout: horizontal country paging and vertical division reels inside each country.

## v3.2.1 - Merge squad and tactics

What changed:
- Combined Starting XI and Tactics into one Squad tab with a top switcher.
- Added a Settings tab for current-team controls and dev tools.
- Moved change-team and season-skip dev controls out of the Hub.

## v3.2.0 - Fix lineup views and player ordering

What changed:
- Added shared formation-map cleanup so stale maps cannot put players in impossible slots.
- Reworked the last-starting-XI modal into a compact pitch view.
- Standardized player list ordering to GK, DEF, MID, FWD across all screens.

## v3.1.0 - Clean up the squad screen

What changed:
- Fixed squad pitch drag-and-drop so players snap to the nearest slot.
- Improved Android drag layering with state-driven zIndex and elevation.
- Added recovery for stale formation maps so starters do not disappear after a season skip.
- Kept AI tactical/formation adaptation away from the user team during weekly progression.

## v3.0.2 - Stabilize the sim and tidy the code

What changed:
- Added regression checks for clean-sheet windows, live red-card minutes, second-yellow accounting, quick/live shape parity, and formation diversity.
- Added package scripts for `qa`, `turbo`, and `test:regression`.
- Split large match-engine code into smaller files for lineup selection, shape profiling, substitutions, match utilities, and post-match accounting.

## v3.0.1 - Fix match accounting and tactical behaviour

What changed:
- Formation slots now feed into possession simulation, so shape affects width, central cover, build-up support, final-third pressure, and box presence.
- Quick-sim substitutions now react to match state instead of swapping players at random.
- AI teams can now adapt formations over a season instead of staying locked to back-four setups.

## v3.0.0 - Move the match engine out of the store

What changed:
- Moved match simulation into a pure engine path so it can run without the Zustand store.
- Added fast long-run simulation tooling with `turbo_sim.ts` and `detailed_season_sim.ts`.
- Tuned scoring toward a realistic league-wide goals-per-match range.

## v2.0.0 - Improve the basic game loop

What changed:
- Reworked the match engine so top players can have a bigger impact without one player dominating every stat.
- Fixed missing-team data issues so the league has the expected 20 teams.
- Added fallback squad generation when source data is thin.

## v1.0.0 - First playable version

What changed:
- Added manual squad selection, 7-player bench, basic match tuning, AI lineup auto-fill, and simple tactical controls.

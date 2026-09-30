import { checkAiAutoplayCommandProducesReport } from './aiAutoplay';
import { checkFormationSlotLookupUsesExactFormation, checkFormationMapRejectsWrongPositions, checkRosterSizeConstraints, checkUnavailableBenchPlayersCanBeRemoved, checkRecoveredSelectedBenchDoesNotOverflow, checkLineupActionsPreserveBenchLimit, checkLineupInboxActionFiltersStaleFormationMap, checkTacticalAdaptationRunsOncePerPlayedCount, checkTacticalAdaptationIgnoresUnavailablePlayers } from './squad';
import { checkAdministrativeResultsAreExcludedFromScoreLogMismatch, checkCleanSheetWindows, checkQuickSimMatchSummaryIncludesStatsAndRatings, checkMatchRatingsIncludeIndividualOutput, checkCleanSheetRatingsUsePlayerWindow, checkPenaltyShootoutUsesIndividualKicks, checkQuickSimKnockoutUsesExtraTimeBeforePenalties, checkLeaguePlayoffFixtureDoesNotChangeTableStats } from './match';
import { checkLiveSentOffMinutes, checkLiveSubstitutionsApplyBeforeFullTime, checkUserAiDoesNotSpendLiveSubstitutions, checkManualLiveSubstitutionAndShapeAreMatchLocal, checkManualLiveSubstitutionValidation, checkLiveMatchSummaryIncludesStatsAndRatings, checkLiveKnockoutExtraTimeTransition, checkActiveLiveMatchBlocksWeekAdvance, checkStaleLiveMatchRecovery, checkDirectFinishCompletesUnprocessedLiveMatch, checkZustandStoreLiveMatchCleanup } from './live-match';
import { checkCompetitionPanelHandlesMissingTeam, checkDivisionBootstrap, checkPromotionRelegation, checkSeasonEndProgressionUpdatesMatchAbility, checkSeasonRolloverReplenishesMinimumSquadAndGoalkeepers, checkEflPlayoffsAreScheduledAfterRegularSeason, checkEflPlayoffSemiFinalsUseAggregateTiebreak, checkRolloverWaitsForPlayoffFinal } from './calendar';
import { checkUserTeamProgressionDoesNotAdaptFormation, checkManagerProfilesLoaded, checkActiveCupRoundCountsAsReached, checkBoardObjectiveIdsAreStable, checkMidSeasonSackingTerminatesImmediately, checkNonTerminalSackingWarningDoesNotDismiss, checkInitialGameSetupCanBeSeeded, checkStoreInitializesSelectedTeamDefaults } from './board';
import { checkAcceptCounterMovesPlayerAndMarksNegotiationAccepted, checkApproachCoreNeededPlayerRejectsWithoutNegotiation, checkApproachUnlistedBackupCreatesPendingNegotiation, checkListedUnderAskCreatesCounterNegotiationWithoutMove, checkManualTransfersRespectWindow, checkManualTransfersRejectNonFiniteMoney, checkManualFreeAgentSigningMovesPlayerDuringWindow, checkManualFreeAgentSigningWorksOutsideWindow, checkManualFreeAgentSigningRejectsFullSquad, checkRivalBidWinsWhenUserDoesNotMatch, checkWeeklyNegotiationsExpireAfterDeadline, checkAiTransferListingsExpireOutsideWindow, checkAiBuyerAtMaximumSquadSizeCannotBuy, checkAiSignsFreeAgentForUrgentSquadNeed, checkAiStaleListedTargetIsRevalidated, checkEliteAiRejectsUnderStandardTarget, checkExperiencedAiPrefersOlderEqualTarget, checkAiTransferRespectsOperatingWageAffordability, checkContractDeparturesPreferViableDestinations, checkSimultaneousExpiriesRecomputeAgainstProvisionalSquad } from './transfer';
import { checkFreeAgentSaveReloadEquivalence } from './persistence';
import { checkWeeklyTrainingFocusRaisesFocusedStat, checkTrainingRespectsPotentialCap, checkSeasonEndProgressionRespectsPotentialCap, checkYouthIntakeAssignsHiddenPotential } from './training';
import { checkPlayerRoleCompatibilityMatrix, checkPlayerRoleEnergyDrainModifiers, checkSlotKeyedPlayerRoleLookup, checkPlayerRolesAdjustShapeProfile } from './roles';
import { checkRelentlessTraitReducesFatiguePenalty, checkSeededPlayersNormalizeTraits, checkTraitBonusesExposeMechanicalEffects, checkTraitRegistryCoversSeededTraits, checkTraitTrainingFocusAddsXp } from './traits';
import { checkWeeklyProgressionAppliesRevenueBreakdown, checkWeeklyRevenueUsesDivisionAndSponsorRates } from './finance';
import { checkPlayerRatingUtilsPreserveSharedCurves } from './playerRatingUtils';
import { checkAppendFixtureResultToStatePreservesPostMatchPatch } from './fixtureResolution';
import { checkAiAutoplayRotationDoesNotReuseBenchPlayer } from './aiAutoplay';
import { checkNegotiationsRevalidateCurrentState } from './transfer';
import { checkSeasonRunnerIgnoresSackingAndBoundsErrors } from './aiAutoplay';
import { checkQuickSimAbandonmentStopsImmediately, checkZeroMoraleRemainsZeroAfterLoss } from './match';
import { checkQuickLineupKeepsBackupKeeperOutfieldFree, checkSeededGoalkeeperAttributes, checkAssistantRotationPreservesFullLineup } from './squad';
import { checkAggregateLiveAndVoidRecovery } from './calendar';
import { checkUnemployedCareerRecovery } from './board';
import { checkGoalkeeperTrainingUsesKeeperStats } from './training';
import { checkAiGoalkeeperTrainingAvoidsCappedStats } from './aiAutoplay';
import { checkEmergencyGoalkeeperCanContinueAndSubstitute } from './live-match';

export const domainChecks = [
  { name: 'agent: autoplay command report schema', run: checkAiAutoplayCommandProducesReport },
  { name: 'transfer: Negotiations Revalidate Current State', run: checkNegotiationsRevalidateCurrentState },
  { name: 'match: Zero Morale Remains Zero After Loss', run: checkZeroMoraleRemainsZeroAfterLoss },
  { name: 'match: Quick Sim Abandonment Stops Immediately', run: checkQuickSimAbandonmentStopsImmediately },
  { name: 'calendar: Aggregate Live And Void Recovery', run: checkAggregateLiveAndVoidRecovery },
  { name: 'board: Unemployed Career Recovery', run: checkUnemployedCareerRecovery },
  { name: 'training: Goalkeeper Training Uses Keeper Stats', run: checkGoalkeeperTrainingUsesKeeperStats },
  { name: 'aiAutoplay: Ai Goalkeeper Training Avoids Capped Stats', run: checkAiGoalkeeperTrainingAvoidsCappedStats },
  { name: 'live-match: Emergency Goalkeeper Can Continue And Substitute', run: checkEmergencyGoalkeeperCanContinueAndSubstitute },
  { name: 'squad: Quick Lineup Keeps Backup Keeper Outfield Free', run: checkQuickLineupKeepsBackupKeeperOutfieldFree },
  { name: 'squad: Seeded Goalkeeper Attributes', run: checkSeededGoalkeeperAttributes },
  { name: 'squad: Assistant Rotation Preserves Full Lineup', run: checkAssistantRotationPreservesFullLineup },
  { name: 'aiAutoplay: Season Runner Ignores Sacking And Bounds Errors', run: checkSeasonRunnerIgnoresSackingAndBoundsErrors },
  { name: 'squad: Formation Slot Lookup Uses Exact Formation', run: checkFormationSlotLookupUsesExactFormation },
  { name: 'match: Clean Sheet Windows', run: checkCleanSheetWindows },
  { name: 'live-match: Live Sent Off Minutes', run: checkLiveSentOffMinutes },
  { name: 'match: Administrative Results Are Excluded From Score Log Mismatch', run: checkAdministrativeResultsAreExcludedFromScoreLogMismatch },
  { name: 'live-match: Live Substitutions Apply Before Full Time', run: checkLiveSubstitutionsApplyBeforeFullTime },
  { name: 'live-match: User Ai Does Not Spend Live Substitutions', run: checkUserAiDoesNotSpendLiveSubstitutions },
  { name: 'live-match: Manual Live Substitution And Shape Are Match Local', run: checkManualLiveSubstitutionAndShapeAreMatchLocal },
  { name: 'live-match: Manual Live Substitution Validation', run: checkManualLiveSubstitutionValidation },
  { name: 'live-match: Live Match Summary Includes Stats And Ratings', run: checkLiveMatchSummaryIncludesStatsAndRatings },
  { name: 'live-match: Live Knockout Extra Time Transition', run: checkLiveKnockoutExtraTimeTransition },
  { name: 'live-match: Active Live Match Blocks Week Advance', run: checkActiveLiveMatchBlocksWeekAdvance },
  { name: 'live-match: Stale Live Match Recovery', run: checkStaleLiveMatchRecovery },
  { name: 'live-match: Direct Finish Completes Unprocessed Live Match', run: checkDirectFinishCompletesUnprocessedLiveMatch },
  { name: 'calendar: Competition Panel Handles Missing Team', run: checkCompetitionPanelHandlesMissingTeam },
  { name: 'board: User Team Progression Does Not Adapt Formation', run: checkUserTeamProgressionDoesNotAdaptFormation },
  { name: 'aiAutoplay: Ai Autoplay Rotation Does Not Reuse Bench Player', run: checkAiAutoplayRotationDoesNotReuseBenchPlayer },
  { name: 'board: Manager Profiles Loaded', run: checkManagerProfilesLoaded },
  { name: 'calendar: Division Bootstrap', run: checkDivisionBootstrap },
  { name: 'calendar: Promotion Relegation', run: checkPromotionRelegation },
  { name: 'calendar: Efl Playoffs Are Scheduled After Regular Season', run: checkEflPlayoffsAreScheduledAfterRegularSeason },
  { name: 'calendar: Efl Playoff Semi Finals Use Aggregate Tiebreak', run: checkEflPlayoffSemiFinalsUseAggregateTiebreak },
  { name: 'calendar: Rollover Waits For Playoff Final', run: checkRolloverWaitsForPlayoffFinal },
  { name: 'squad: Formation Map Rejects Wrong Positions', run: checkFormationMapRejectsWrongPositions },
  { name: 'board: Active Cup Round Counts As Reached', run: checkActiveCupRoundCountsAsReached },
  { name: 'board: Board Objective Ids Are Stable', run: checkBoardObjectiveIdsAreStable },
  { name: 'board: Mid Season Sacking Terminates Immediately', run: checkMidSeasonSackingTerminatesImmediately },
  { name: 'board: Non Terminal Sacking Warning Does Not Dismiss', run: checkNonTerminalSackingWarningDoesNotDismiss },
  { name: 'match: Quick Sim Match Summary Includes Stats And Ratings', run: checkQuickSimMatchSummaryIncludesStatsAndRatings },
  { name: 'fixtureResolution: Append Fixture Result To State Preserves Post Match Patch', run: checkAppendFixtureResultToStatePreservesPostMatchPatch },
  { name: 'match: Penalty Shootout Uses Individual Kicks', run: checkPenaltyShootoutUsesIndividualKicks },
  { name: 'match: Quick Sim Knockout Uses Extra Time Before Penalties', run: checkQuickSimKnockoutUsesExtraTimeBeforePenalties },
  { name: 'match: League Playoff Fixture Does Not Change Table Stats', run: checkLeaguePlayoffFixtureDoesNotChangeTableStats },
  { name: 'live-match: Zustand Store Live Match Cleanup', run: checkZustandStoreLiveMatchCleanup },
  { name: 'squad: Roster Size Constraints', run: checkRosterSizeConstraints },
  { name: 'transfer: Manual Transfers Respect Window', run: checkManualTransfersRespectWindow },
  { name: 'transfer: Manual Transfers Reject Non Finite Money', run: checkManualTransfersRejectNonFiniteMoney },
  { name: 'transfer: Approach Unlisted Backup Creates Pending Negotiation', run: checkApproachUnlistedBackupCreatesPendingNegotiation },
  { name: 'transfer: Approach Core Needed Player Rejects Without Negotiation', run: checkApproachCoreNeededPlayerRejectsWithoutNegotiation },
  { name: 'transfer: Listed Under Ask Creates Counter Negotiation Without Move', run: checkListedUnderAskCreatesCounterNegotiationWithoutMove },
  { name: 'transfer: Accept Counter Moves Player And Marks Negotiation Accepted', run: checkAcceptCounterMovesPlayerAndMarksNegotiationAccepted },
  { name: 'transfer: Weekly Negotiations Expire After Deadline', run: checkWeeklyNegotiationsExpireAfterDeadline },
  { name: 'transfer: Rival Bid Wins When User Does Not Match', run: checkRivalBidWinsWhenUserDoesNotMatch },
  { name: 'transfer: Manual Free Agent Signing Moves Player During Window', run: checkManualFreeAgentSigningMovesPlayerDuringWindow },
  { name: 'transfer: Manual Free Agent Signing Works Outside Window', run: checkManualFreeAgentSigningWorksOutsideWindow },
  { name: 'transfer: Manual Free Agent Signing Rejects Full Squad', run: checkManualFreeAgentSigningRejectsFullSquad },
  { name: 'squad: Unavailable Bench Players Can Be Removed', run: checkUnavailableBenchPlayersCanBeRemoved },
  { name: 'squad: Recovered Selected Bench Does Not Overflow', run: checkRecoveredSelectedBenchDoesNotOverflow },
  { name: 'squad: Lineup Actions Preserve Bench Limit', run: checkLineupActionsPreserveBenchLimit },
  { name: 'roles: Player Role Compatibility Matrix', run: checkPlayerRoleCompatibilityMatrix },
  { name: 'roles: Slot Keyed Player Role Lookup', run: checkSlotKeyedPlayerRoleLookup },
  { name: 'roles: Player Roles Adjust Shape Profile', run: checkPlayerRolesAdjustShapeProfile },
  { name: 'roles: Player Role Energy Drain Modifiers', run: checkPlayerRoleEnergyDrainModifiers },
  { name: 'squad: Lineup Inbox Action Filters Stale Formation Map', run: checkLineupInboxActionFiltersStaleFormationMap },
  { name: 'transfer: Ai Transfer Listings Expire Outside Window', run: checkAiTransferListingsExpireOutsideWindow },
  { name: 'transfer: Ai Buyer At Maximum Squad Size Cannot Buy', run: checkAiBuyerAtMaximumSquadSizeCannotBuy },
  { name: 'transfer: Ai Signs Free Agent For Urgent Squad Need', run: checkAiSignsFreeAgentForUrgentSquadNeed },
  { name: 'transfer: Ai Stale Listed Target Is Revalidated', run: checkAiStaleListedTargetIsRevalidated },
  { name: 'transfer: Elite Ai Rejects Under Standard Target', run: checkEliteAiRejectsUnderStandardTarget },
  { name: 'transfer: Experienced Ai Prefers Older Equal Target', run: checkExperiencedAiPrefersOlderEqualTarget },
  { name: 'transfer: Ai Transfer Respects Operating Wage Affordability', run: checkAiTransferRespectsOperatingWageAffordability },
  { name: 'calendar: Season End Progression Updates Match Ability', run: checkSeasonEndProgressionUpdatesMatchAbility },
  { name: 'training: Weekly Training Focus Raises Focused Stat', run: checkWeeklyTrainingFocusRaisesFocusedStat },
  { name: 'training: Training Respects Potential Cap', run: checkTrainingRespectsPotentialCap },
  { name: 'training: Season End Progression Respects Potential Cap', run: checkSeasonEndProgressionRespectsPotentialCap },
  { name: 'training: Youth Intake Assigns Hidden Potential', run: checkYouthIntakeAssignsHiddenPotential },
  { name: 'playerRatingUtils: Player Rating Utils Preserve Shared Curves', run: checkPlayerRatingUtilsPreserveSharedCurves },
  { name: 'traits: Seeded Players Normalize Traits', run: checkSeededPlayersNormalizeTraits },
  { name: 'traits: Trait Registry Covers Seeded Traits', run: checkTraitRegistryCoversSeededTraits },
  { name: 'traits: Trait Bonuses Expose Mechanical Effects', run: checkTraitBonusesExposeMechanicalEffects },
  { name: 'traits: Trait Training Focus Adds Xp', run: checkTraitTrainingFocusAddsXp },
  { name: 'traits: Relentless Trait Reduces Fatigue Penalty', run: checkRelentlessTraitReducesFatiguePenalty },
  { name: 'finance: Weekly Revenue Uses Division And Sponsor Rates', run: checkWeeklyRevenueUsesDivisionAndSponsorRates },
  { name: 'finance: Weekly Progression Applies Revenue Breakdown', run: checkWeeklyProgressionAppliesRevenueBreakdown },
  { name: 'transfer: Contract Departures Prefer Viable Destinations', run: checkContractDeparturesPreferViableDestinations },
  { name: 'persistence: Free Agent Save Reload Equivalence', run: checkFreeAgentSaveReloadEquivalence },
  { name: 'calendar: Season Rollover Replenishes Minimum Squad And Goalkeepers', run: checkSeasonRolloverReplenishesMinimumSquadAndGoalkeepers },
  { name: 'transfer: Simultaneous Expiries Recompute Against Provisional Squad', run: checkSimultaneousExpiriesRecomputeAgainstProvisionalSquad },
  { name: 'board: Initial Game Setup Can Be Seeded', run: checkInitialGameSetupCanBeSeeded },
  { name: 'board: Store Initializes Selected Team Defaults', run: checkStoreInitializesSelectedTeamDefaults },
  { name: 'squad: Tactical Adaptation Runs Once Per Played Count', run: checkTacticalAdaptationRunsOncePerPlayedCount },
  { name: 'squad: Tactical Adaptation Ignores Unavailable Players', run: checkTacticalAdaptationIgnoresUnavailablePlayers },
  { name: 'match: Match Ratings Include Individual Output', run: checkMatchRatingsIncludeIndividualOutput },
  { name: 'match: Clean Sheet Ratings Use Player Window', run: checkCleanSheetRatingsUsePlayerWindow },
];

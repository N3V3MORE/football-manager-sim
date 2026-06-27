// Inbox message generation is split by category:
//   inboxCore        — shared helpers, types, id/merge utilities
//   inboxSystem      — system / news / team-switch messages
//   inboxAssistant   — assistant week messages, post-match reports
//   inboxCareerBoard — career milestones, job offers, sack warnings, board updates
//
// This file re-exports the full public surface so existing callers
// (`./inboxHelpers`) continue to work unchanged.
export {
  MAX_INBOX_MESSAGES,
  getInboxSeason,
  mergeInboxMessages,
  pruneInboxMessagesForManagedTeam,
} from './inboxCore';

export {
  buildLegacyInboxMessages,
  generateSystemInboxMessages,
  generateTeamSwitchMessage,
} from './inboxSystem';

export {
  generateAssistantWeekMessages,
  generatePostMatchReportMessage,
} from './inboxAssistant';

export {
  generateBoardInboxMessages,
  generateCareerInboxMessages,
  generateSackWarningMessage,
} from './inboxCareerBoard';

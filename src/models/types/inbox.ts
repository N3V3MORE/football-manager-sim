import type { TeamTactics } from './player';

type InboxMessageSource = 'assistant' | 'system';

export type InboxMessageCategory =
  | 'system_news'
  | 'competition_update'
  | 'season_update'
  | 'board_update'
  | 'injury_update'
  | 'pre_match_energy'
  | 'pre_match_availability'
  | 'lineup_suggestion'
  | 'tactic_suggestion'
  | 'post_match_report'
  | 'transfer_advice'
  | 'squad_warning'
  | 'contract_warning'
  | 'career_sack_warning'
  | 'career_job_offer'
  | 'career_milestone';

export type InboxAction =
  | {
      type: 'apply_lineup';
      payload: {
        teamId: string;
        formationMap: Record<string, string>;
        startingIds: string[];
        subIds: string[];
      };
    }
  | {
      type: 'apply_tactics';
      payload: {
        teamId: string;
        tactics: Partial<TeamTactics>;
      };
    }
  | {
      type: 'renew_contract';
      payload: {
        playerId: string;
        years: number;
        wage: number;
      };
    }
  | {
      type: 'accept_job_offer';
      payload: {
        teamId: string;
      };
    }
  | {
      type: 'accept_transfer_counter';
      payload: {
        negotiationId: string;
      };
    }
  | {
      type: 'withdraw_transfer_negotiation';
      payload: {
        negotiationId: string;
      };
    };

export interface InboxMessage {
  id: string;
  week: number;
  /** Season number (1-indexed). Optional for backward compatibility with older saves. */
  season?: number;
  source: InboxMessageSource;
  category: InboxMessageCategory;
  title: string;
  body: string;
  isRead: boolean;
  action?: InboxAction;
  fixtureId?: string;
  playerId?: string;
  teamId?: string;
}

import { GameState, InboxMessage, Player } from '../models/types';
import { getRenewalOffer } from '../core/contractUtils';

export type StoreActionResult = {
  success: boolean;
  message: string;
};

type ContractActionState = Pick<GameState, 'players' | 'teams' | 'userTeamId' | 'inboxMessages'>;
type ContractActionPatch = Partial<Pick<GameState, 'players' | 'inboxMessages'>> | ContractActionState;

export const buildRenewedPlayer = (player: Player, years: number, wage: number): Player => ({
  ...player,
  contractLeft: years,
  wage,
  morale: Math.min(100, player.morale + 6),
});

export const clearContractWarningMessages = (messages: InboxMessage[], playerId: string) => (
  messages.map(message => (
    message.category === 'contract_warning' && message.playerId === playerId
      ? { ...message, isRead: true, action: undefined }
      : message
  ))
);

const MAX_CONTRACT_WAGE = 1000;

/** Rejects NaN, Infinity, non-integer years, and implausible values. */
export const isValidContractTerms = (years: number, wage: number): boolean => {
  if (!Number.isFinite(years) || !Number.isInteger(years)) return false;
  if (years < 1 || years > 5) return false;
  if (!Number.isFinite(wage) || wage <= 0 || wage > MAX_CONTRACT_WAGE) return false;
  return true;
};

export const renewPlayerContractState = (
  state: ContractActionState,
  playerId: string,
  years: number,
  wage: number
): { patch: ContractActionPatch; result: StoreActionResult } => {
  const player = state.players[playerId];
  const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;

  if (!player || !userTeam || player.teamId !== userTeam.id) {
    return {
      patch: state,
      result: { success: false, message: 'Player is not in your squad.' },
    };
  }

  if (!isValidContractTerms(years, wage)) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid contract terms.' },
    };
  }

  const renewalOffer = getRenewalOffer(player);
  const minimumAcceptableWage = Math.max(1, Math.round(renewalOffer.wage * 0.9));
  if (wage < minimumAcceptableWage || years < Math.max(1, renewalOffer.years - 1)) {
    return {
      patch: state,
      result: { success: false, message: `${player.name} rejected terms below his expected renewal package.` },
    };
  }

  const operatingBudget = userTeam.operatingBudget !== undefined ? userTeam.operatingBudget : userTeam.budget;
  const annualWageCost = (wage * 52) / 1000;
  if (!Number.isFinite(operatingBudget) || operatingBudget < annualWageCost) {
    return {
      patch: state,
      result: { success: false, message: 'The club cannot responsibly fund that wage commitment.' },
    };
  }

  return {
    patch: {
      players: {
        ...state.players,
        [playerId]: buildRenewedPlayer(player, years, wage),
      },
      inboxMessages: clearContractWarningMessages(state.inboxMessages, playerId),
    },
    result: {
      success: true,
      message: `${player.name} signs a new ${years}-year deal at GBP ${wage}k/w.`,
    },
  };
};

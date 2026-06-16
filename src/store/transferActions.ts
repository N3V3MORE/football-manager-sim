import { GameState, Player } from '../models/types';
import { removePlayerFromTeamSelections } from '../core/formationMapUtils';
import { computeWeeklyTransfers } from '../core/progressionEngine';
import { StoreActionResult } from './contractActions';

type TransferActionState = Pick<GameState, 'players' | 'teams' | 'userTeamId'>;
type TransferActionPatch = Partial<Pick<GameState, 'players' | 'teams'>> | TransferActionState;

const updateTransferListingState = (
  players: Record<string, Player>,
  playerId: string,
  isTransferListed: boolean,
  askingPrice: number
) => {
  const player = players[playerId];
  if (!player) return null;

  return {
    ...players,
    [playerId]: { ...player, isTransferListed, askingPrice },
  };
};

export const buyPlayerState = (
  state: TransferActionState,
  playerId: string,
  fee: number,
  wageOffered: number
): { patch: TransferActionPatch; result: StoreActionResult } => {
  const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;
  const player = state.players[playerId];

  if (!userTeam || !player) {
    return {
      patch: {},
      result: { success: false, message: 'Invalid team or player.' },
    };
  }

  if (userTeam.budget < fee) {
    return {
      patch: {},
      result: { success: false, message: 'Insufficient transfer funds.' },
    };
  }

  if (fee < player.askingPrice * 0.85) {
    return {
      patch: {},
      result: { success: false, message: `The club rejected your bid of GBP ${fee}m.` },
    };
  }

  if (wageOffered > 0 && wageOffered < player.wage * 0.9) {
    return {
      patch: {},
      result: { success: false, message: `${player.name} rejected your wage offer of GBP ${wageOffered}k/w.` },
    };
  }

  const isSelfTransfer = player.teamId === userTeam.id;
  if (isSelfTransfer) {
    return {
      patch: {},
      result: { success: false, message: 'Player is already at your club.' },
    };
  }

  const sellingTeam = state.teams[player.teamId];
  const updatedUserTeam = {
    ...userTeam,
    budget: userTeam.budget - fee,
    transferSpend: userTeam.transferSpend + fee,
  };
  const updatedSellingTeam = sellingTeam
    ? removePlayerFromTeamSelections({ ...sellingTeam, budget: sellingTeam.budget + fee }, player.id)
    : undefined;
  const updatedPlayer = {
    ...player,
    teamId: userTeam.id,
    wage: wageOffered > 0 ? wageOffered : player.wage,
    isStarting: false,
    isSub: false,
    isTransferListed: false,
    askingPrice: 0,
    contractLeft: Math.max(player.contractLeft, 3),
  };

  return {
    patch: {
      teams: {
        ...state.teams,
        [userTeam.id]: updatedUserTeam,
        ...(updatedSellingTeam ? { [player.teamId]: updatedSellingTeam } : {}),
      },
      players: { ...state.players, [playerId]: updatedPlayer },
    },
    result: { success: true, message: `Successfully purchased ${player.name} for GBP ${fee}m.` },
  };
};

export const listPlayerForSaleState = (
  state: TransferActionState,
  playerId: string,
  askingPrice: number
): TransferActionPatch => {
  const players = updateTransferListingState(state.players, playerId, true, askingPrice);
  return players ? { players } : state;
};

export const unlistPlayerState = (
  state: TransferActionState,
  playerId: string
): TransferActionPatch => {
  const players = updateTransferListingState(state.players, playerId, false, 0);
  return players ? { players } : state;
};

export const processWeeklyTransfersState = (state: TransferActionState): TransferActionPatch => (
  computeWeeklyTransfers(state.players, state.teams, state.userTeamId)
);

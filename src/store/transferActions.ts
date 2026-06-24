import { GameState, Player } from '../models/types';
import { computeWeeklyTransfers } from '../core/progressionEngine';
import { StoreActionResult } from './contractActions';
import { isTransferWindowOpen } from '../utils/calendar';
import { isWageOfferAccepted } from '../core/transferFinance';
import { movePlayerToTeam } from '../core/playerMovement';
import { getSquadPolicy } from '../core/squadPolicy';

type TransferActionState = Pick<GameState, 'currentWeek' | 'players' | 'teams' | 'userTeamId'>;
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
      patch: state,
      result: { success: false, message: 'Invalid team or player.' },
    };
  }

  if (!isTransferWindowOpen(state.currentWeek)) {
    return {
      patch: state,
      result: { success: false, message: 'You cannot buy players outside of the transfer window.' },
    };
  }

  if (player.teamId === userTeam.id) {
    return {
      patch: state,
      result: { success: false, message: 'You cannot buy your own player.' },
    };
  }

  if (!player.isTransferListed) {
    return {
      patch: state,
      result: { success: false, message: 'This player is not listed for sale.' },
    };
  }

  if (
    !Number.isFinite(fee) ||
    fee <= 0 ||
    !Number.isFinite(wageOffered) ||
    wageOffered < 0 ||
    !Number.isFinite(player.askingPrice) ||
    player.askingPrice <= 0 ||
    !Number.isFinite(userTeam.budget) ||
    !Number.isFinite(userTeam.transferSpend)
  ) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid transfer finances.' },
    };
  }

  if (userTeam.budget < fee) {
    return {
      patch: state,
      result: { success: false, message: 'Insufficient transfer funds.' },
    };
  }

  const userSquadSize = Object.values(state.players).filter(candidate => candidate.teamId === userTeam.id).length;
  if (userSquadSize >= getSquadPolicy(userTeam).maximumSquadSize) {
    return {
      patch: state,
      result: { success: false, message: 'Your squad is already at the registration capacity.' },
    };
  }

  if (fee < player.askingPrice * 0.85) {
    return {
      patch: state,
      result: { success: false, message: `The club rejected your bid of GBP ${fee}m.` },
    };
  }

  if (wageOffered > 0 && !isWageOfferAccepted(player, wageOffered)) {
    return {
      patch: state,
      result: { success: false, message: `${player.name} rejected your wage offer of GBP ${wageOffered}k/w.` },
    };
  }

  const moved = movePlayerToTeam(
    state.players,
    state.teams,
    playerId,
    userTeam.id,
    { wage: wageOffered > 0 ? wageOffered : player.wage, contractLeft: Math.max(player.contractLeft, 3) },
    { budget: (state.teams[player.teamId]?.budget || 0) + fee },
    { budget: userTeam.budget - fee, transferSpend: userTeam.transferSpend + fee }
  );

  return {
    patch: {
      teams: moved.teams,
      players: moved.players,
    },
    result: { success: true, message: `Successfully purchased ${player.name} for GBP ${fee}m.` },
  };
};

export const listPlayerForSaleState = (
  state: TransferActionState,
  playerId: string,
  askingPrice: number
): TransferActionPatch => {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) return state;
  if (!Number.isFinite(askingPrice) || askingPrice <= 0) return state;
  const players = updateTransferListingState(state.players, playerId, true, askingPrice);
  return players ? { players } : state;
};

export const unlistPlayerState = (
  state: TransferActionState,
  playerId: string
): TransferActionPatch => {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) return state;
  const players = updateTransferListingState(state.players, playerId, false, 0);
  return players ? { players } : state;
};

export const processWeeklyTransfersState = (state: TransferActionState): TransferActionPatch => (
  computeWeeklyTransfers(state.players, state.teams, state.userTeamId, undefined, state.currentWeek)
);

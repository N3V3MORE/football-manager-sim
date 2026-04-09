import { StoreApi } from 'zustand';
import { removePlayerFromTeamSelections } from '../../core/formationMapUtils';
import { computeWeeklyTransfers } from '../../core/progressionEngine';
import { GameStore } from '../types';

type SetState = StoreApi<GameStore>['setState'];
type GetState = StoreApi<GameStore>['getState'];

export const createTransferActions = (set: SetState, _get: GetState): Pick<GameStore, 'buyPlayer' | 'listPlayerForSale' | 'unlistPlayer' | 'processWeeklyTransfers'> => ({
  buyPlayer: (playerId: string, fee: number, wageOffered: number) => {
    let result = { success: false, message: '' };
    set(state => {
      const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;
      const player = state.players[playerId];

      if (!userTeam || !player) {
        result = { success: false, message: 'Invalid team or player.' };
        return state;
      }
      if (userTeam.budget < fee) {
        result = { success: false, message: 'Insufficient transfer funds.' };
        return state;
      }

      if (fee < player.askingPrice * 0.85) {
        result = { success: false, message: `The club rejected your bid of GBP ${fee}m.` };
        return state;
      }

      if (wageOffered > 0 && wageOffered < player.wage * 0.9) {
        result = { success: false, message: `${player.name} rejected your wage offer of GBP ${wageOffered}k/w.` };
        return state;
      }

      const sellingTeam = state.teams[player.teamId];
      const updatedUserTeam = { ...userTeam, budget: userTeam.budget - fee };
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
      };

      result = { success: true, message: `Successfully purchased ${player.name} for GBP ${fee}m.` };

      return {
        teams: {
          ...state.teams,
          [userTeam.id]: updatedUserTeam,
          ...(updatedSellingTeam ? { [sellingTeam.id]: updatedSellingTeam } : {}),
        },
        players: { ...state.players, [playerId]: updatedPlayer },
      };
    });
    return result;
  },

  listPlayerForSale: (playerId: string, askingPrice: number) => {
    set(state => {
      const player = state.players[playerId];
      if (!player) return state;
      return {
        players: { ...state.players, [playerId]: { ...player, isTransferListed: true, askingPrice } },
      };
    });
  },

  unlistPlayer: (playerId: string) => {
    set(state => {
      const player = state.players[playerId];
      if (!player) return state;
      return {
        players: { ...state.players, [playerId]: { ...player, isTransferListed: false, askingPrice: 0 } },
      };
    });
  },

  processWeeklyTransfers: () => {
    set(state => computeWeeklyTransfers(state.players, state.teams, state.userTeamId));
  },
});

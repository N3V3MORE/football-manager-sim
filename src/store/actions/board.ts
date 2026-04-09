import { StoreApi } from 'zustand';
import { evaluateBoardObjectives } from '../../core/boardUtils';
import { GameStore } from '../types';

type SetState = StoreApi<GameStore>['setState'];
type GetState = StoreApi<GameStore>['getState'];

export const createBoardActions = (set: SetState, _get: GetState): Pick<GameStore, 'checkBoardObjectives'> => ({
  checkBoardObjectives: () => {
    set(state => evaluateBoardObjectives(state.teams, state.boardObjectives, state.userTeamId));
  },
});

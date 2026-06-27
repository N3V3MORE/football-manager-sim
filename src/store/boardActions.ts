import { runBoardReview } from '../core/boardEngine';
import { getSeasonWeekLimit } from '../core/leagueUtils';
import type { WeeklyLifecycleState } from './fixtureResolution';

export const checkBoardObjectivesState = (
  state: WeeklyLifecycleState
): Partial<WeeklyLifecycleState> => {
  if (!state.userTeamId) return state;
  if (state.boardReviewAppliedWeek === state.currentWeek) return state;
  const myTeam = state.teams[state.userTeamId];
  if (!myTeam) return state;
  const seasonWeekLimit = getSeasonWeekLimit(state.fixtures, state.competitions);
  const review = runBoardReview(
    myTeam,
    state.teams,
    state.boardObjectives,
    {
      isSeasonComplete: state.currentWeek > seasonWeekLimit,
      competitions: state.competitions,
      players: state.players,
    }
  );
  return {
    teams: {
      ...state.teams,
      [myTeam.id]: {
        ...myTeam,
        boardApproval: review.nextApproval,
        manager: review.nextManager,
      },
    },
    boardObjectives: review.updatedObjectives,
    boardReviewAppliedWeek: state.currentWeek,
  };
};

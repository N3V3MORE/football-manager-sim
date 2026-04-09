import { BoardObjective, Team } from '../models/types';

export const evaluateBoardObjectives = (
  teams: Record<string, Team>,
  boardObjectives: BoardObjective[],
  userTeamId: string | null
): { teams: Record<string, Team>; boardObjectives: BoardObjective[] } => {
  if (!userTeamId) {
    return { teams, boardObjectives };
  }

  const myTeam = teams[userTeamId];
  if (!myTeam) {
    return { teams, boardObjectives };
  }

  const manager = myTeam.manager;
  let approvalChange = 0;
  const updatedObjectives = boardObjectives.map(objective => {
    let isMet = objective.met;

    switch (objective.type) {
      case 'wins':
        if (myTeam.wins >= objective.target && !isMet) {
          isMet = true;
          approvalChange += 10;
        }
        break;
      case 'position':
      default:
        break;
    }

    return { ...objective, met: isMet };
  });

  if (myTeam.form && myTeam.form[myTeam.form.length - 1] === 'L') {
    approvalChange -= 2;
  } else if (myTeam.form && myTeam.form[myTeam.form.length - 1] === 'W') {
    approvalChange += 1;
  }

  const updatedTeam = {
    ...myTeam,
    boardApproval: Math.min(100, Math.max(0, myTeam.boardApproval + approvalChange)),
    manager: {
      ...manager,
      boardTrust: Math.min(100, Math.max(0, manager.boardTrust + approvalChange)),
      jobSecurity: Math.min(100, Math.max(0, manager.jobSecurity + Math.round(approvalChange / 2))),
    },
  };

  return {
    teams: { ...teams, [myTeam.id]: updatedTeam },
    boardObjectives: updatedObjectives,
  };
};

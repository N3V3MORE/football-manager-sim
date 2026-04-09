import { BoardObjective, Team } from '../models/types';
import { sortTeamsByTable } from '../core/leagueUtils';

type ObjectiveResult = {
  objective: BoardObjective;
  approvalDelta: number;
};

type BoardObjectiveContext = {
  isSeasonComplete?: boolean;
};

const getTeamPosition = (team: Team, teams: Record<string, Team>) => {
  const divisionTable = sortTeamsByTable(
    Object.values(teams).filter(candidate => candidate.division === team.division)
  );
  const position = divisionTable.findIndex(candidate => candidate.id === team.id);
  return position >= 0 ? position + 1 : null;
};

const evaluateObjective = (
  objective: BoardObjective,
  team: Team,
  teams: Record<string, Team>,
  context?: BoardObjectiveContext
): ObjectiveResult => {
  let met = objective.met;
  let approvalDelta = 0;
  const isSeasonComplete = Boolean(context?.isSeasonComplete);

  switch (objective.type) {
    case 'position': {
      // "Finish Top N" should only be resolved on final standings.
      if (!isSeasonComplete) {
        met = false;
        break;
      }
      const position = getTeamPosition(team, teams);
      if (position !== null && position <= objective.target && !met) {
        met = true;
        approvalDelta += 10;
      }
      break;
    }
    case 'wins':
      if (team.wins >= objective.target && !met) {
        met = true;
        approvalDelta += 10;
      }
      break;
    case 'spend':
      if ((team.transferSpend || 0) >= objective.target && !met) {
        met = true;
        approvalDelta += 10;
      }
      break;
    // Future objective types can be evaluated here without changing store logic.
    case 'goalDiff':
    default:
      break;
  }

  return { objective: { ...objective, met }, approvalDelta };
};

export const evaluateBoardObjectives = (
  objectives: BoardObjective[],
  team: Team,
  teams: Record<string, Team>,
  context?: BoardObjectiveContext
) => {
  let approvalChange = 0;
  const updatedObjectives = objectives.map(objective => {
    const result = evaluateObjective(objective, team, teams, context);
    approvalChange += result.approvalDelta;
    return result.objective;
  });

  return { updatedObjectives, approvalChange };
};

export const getFormApprovalDelta = (form: string[]) => {
  if (!form || form.length === 0) return 0;
  const last = form[form.length - 1];
  if (last === 'L') return -2;
  if (last === 'W') return 1;
  return 0;
};

export const clampBoardMetric = (value: number) => Math.min(100, Math.max(0, value));

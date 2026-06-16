import { CompetitionState, LeagueDivision, Team } from '../models/types';
import { buildBoardObjectives, buildBoardProfile } from '../core/boardEngine';

const getActiveCompetitionIdsForTeam = (
  teamId: string,
  competitions: Record<string, CompetitionState>
) => (
  Object.values(competitions)
    .filter(competition => competition.entrantTeamIds.includes(teamId))
    .map(competition => competition.id)
);

export const buildManagedTeamObjectives = (
  team: Team | undefined,
  competitions: Record<string, CompetitionState> = {}
) => {
  if (!team || team.division === 'Continental') return [];

  return buildBoardObjectives(
    team.clubClass || 'C',
    team.division as LeagueDivision,
    team.boardProfile || buildBoardProfile(team.clubClass || 'C', team.division, Boolean(team.isExternal)),
    getActiveCompetitionIdsForTeam(team.id, competitions)
  );
};

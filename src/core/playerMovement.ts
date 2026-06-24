import { Player, Team } from '../models/types';
import { removePlayerFromTeamSelections } from './formationMapUtils';

export const buildMovedPlayer = (
  player: Player,
  teamId: string,
  updates: Partial<Player> = {}
): Player => ({
  ...player,
  ...updates,
  teamId,
  isStarting: false,
  isSub: false,
  isTransferListed: false,
  askingPrice: 0,
});

export const movePlayerToTeam = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  playerId: string,
  destinationTeamId: string,
  updates: Partial<Player> = {},
  sourceTeamPatch?: Partial<Team>,
  destinationTeamPatch?: Partial<Team>
) => {
  const player = players[playerId];
  if (!player) return { players, teams };

  const sourceTeam = teams[player.teamId];
  const destinationTeam = teams[destinationTeamId];
  const nextTeams = { ...teams };
  if (sourceTeam) {
    nextTeams[sourceTeam.id] = removePlayerFromTeamSelections({ ...sourceTeam, ...(sourceTeamPatch || {}) }, player.id);
  }
  if (destinationTeam) {
    nextTeams[destinationTeam.id] = { ...destinationTeam, ...(destinationTeamPatch || {}) };
  }

  return {
    players: {
      ...players,
      [playerId]: buildMovedPlayer(player, destinationTeamId, updates),
    },
    teams: nextTeams,
  };
};

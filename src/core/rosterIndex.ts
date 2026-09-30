import { Player } from '../models/types';

// Action-local IDs keep roster order stable while resolving the latest player objects.
export const createRosterIndex = (players: Record<string, Player>) => {
  const rosterIds = new Map<string, string[]>();
  const order = new Map<string, number>();
  Object.values(players).forEach((player, rank) => {
    order.set(player.id, rank);
    const ids = rosterIds.get(player.teamId) ?? [];
    ids.push(player.id);
    rosterIds.set(player.teamId, ids);
  });
  return {
    getPlayers(teamId: string, currentPlayers: Record<string, Player>): Player[] {
      return (rosterIds.get(teamId) ?? []).map(id => currentPlayers[id]).filter(Boolean);
    },
    movePlayer(playerId: string, fromTeamId: string, toTeamId: string) {
      if (fromTeamId === toTeamId) return;
      rosterIds.set(fromTeamId, (rosterIds.get(fromTeamId) ?? []).filter(id => id !== playerId));
      const destination = rosterIds.get(toTeamId) ?? [];
      const rank = order.get(playerId)!;
      const insertAt = destination.findIndex(id => order.get(id)! > rank);
      destination.splice(insertAt < 0 ? destination.length : insertAt, 0, playerId);
      rosterIds.set(toTeamId, destination);
    },
  };
};

export type RosterIndex = ReturnType<typeof createRosterIndex>;

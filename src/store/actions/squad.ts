import { StoreApi } from 'zustand';
import { getSlotsForFormation } from '../../constants/formations';
import { rebuildFormationMap } from '../../core/formationMapUtils';
import { TeamTactics } from '../../models/types';
import { GameStore } from '../types';

type SetState = StoreApi<GameStore>['setState'];
type GetState = StoreApi<GameStore>['getState'];

export const createSquadActions = (set: SetState, _get: GetState): Pick<GameStore, 'setFormation' | 'setTactics' | 'toggleStarting' | 'markAsSub' | 'swapPlayer' | 'swapStartingSlots'> => ({
  setFormation: (teamId, formation) => {
    set((state) => {
      const team = state.teams[teamId];
      if (!team) return state;

      const baseNew = formation.split(' ')[0];
      const baseOld = (team.activeFormation || '').split(' ')[0];
      const existingMap = team.formationMap || {};
      const hasExistingMap = Object.keys(existingMap).length > 0;

      if (baseNew === baseOld && hasExistingMap) {
        const teamStarters = Object.values(state.players)
          .filter(player => player.teamId === teamId && player.isStarting && player.matchesSuspended === 0);
        const formationMap = rebuildFormationMap(getSlotsForFormation(formation), teamStarters, existingMap);
        return {
          teams: { ...state.teams, [teamId]: { ...team, activeFormation: formation, formationMap } },
        };
      }

      const updatedTeam = { ...team, activeFormation: formation };
      const teamPlayers = Object.values(state.players)
        .filter(player => player.teamId === teamId)
        .sort((a, b) => b.overallRating - a.overallRating);
      const updatedPlayers = { ...state.players };

      teamPlayers.forEach(player => {
        updatedPlayers[player.id] = { ...player, isStarting: false, isSub: false };
      });

      const formationMap: Record<string, string> = {};
      const slots = getSlotsForFormation(formation);
      const assignedIds = new Set<string>();
      let assignedCount = 0;

      slots.forEach((row, rowIdx) => {
        row.forEach((slot, colIdx) => {
          let candidate = teamPlayers.find(player => player.subPosition === slot.label && !assignedIds.has(player.id));
          if (!candidate) candidate = teamPlayers.find(player => player.position === slot.pos && !assignedIds.has(player.id));
          if (!candidate) return;

          updatedPlayers[candidate.id] = { ...updatedPlayers[candidate.id], isStarting: true, isSub: false };
          formationMap[`${rowIdx}-${colIdx}`] = candidate.id;
          assignedIds.add(candidate.id);
          assignedCount += 1;
        });
      });

      if (assignedCount < 11) {
        slots.forEach((row, rowIdx) => {
          row.forEach((_, colIdx) => {
            if (formationMap[`${rowIdx}-${colIdx}`]) return;
            const fallback = teamPlayers.find(player => !assignedIds.has(player.id));
            if (!fallback) return;

            updatedPlayers[fallback.id] = { ...updatedPlayers[fallback.id], isStarting: true, isSub: false };
            formationMap[`${rowIdx}-${colIdx}`] = fallback.id;
            assignedIds.add(fallback.id);
            assignedCount += 1;
          });
        });
      }

      updatedTeam.formationMap = formationMap;
      return {
        teams: { ...state.teams, [teamId]: updatedTeam },
        players: updatedPlayers,
      };
    });
  },

  setTactics: (teamId: string, tactics: Partial<TeamTactics>) => {
    set((state) => {
      const team = state.teams[teamId];
      if (!team) return state;
      return {
        teams: { ...state.teams, [teamId]: { ...team, tactics: { ...team.tactics, ...tactics } } },
      };
    });
  },

  toggleStarting: (playerId: string) => {
    set((state) => {
      const player = state.players[playerId];
      if (!player) return state;

      const teamPlayers = Object.values(state.players).filter(item => item.teamId === player.teamId);
      const starters = teamPlayers.filter(item => item.isStarting);
      let updatedTeams = state.teams;

      const removeFromMap = (removedPlayerId: string) => {
        const team = state.teams[player.teamId];
        if (!team || !team.formationMap) return;
        const newMap = { ...team.formationMap };
        for (const key in newMap) {
          if (newMap[key] === removedPlayerId) delete newMap[key];
        }
        updatedTeams = { ...state.teams, [team.id]: { ...team, formationMap: newMap } };
      };

      if (player.isStarting) {
        removeFromMap(playerId);
        return {
          players: { ...state.players, [playerId]: { ...player, isStarting: false, isSub: true } },
          teams: updatedTeams,
        };
      }

      if (starters.length >= 11) {
        const positionalSwap = starters
          .filter(item => item.position === player.position)
          .sort((a, b) => a.overallRating - b.overallRating)[0];
        const fallbackSwap = [...starters].sort((a, b) => a.overallRating - b.overallRating)[0];
        const toSwap = positionalSwap || fallbackSwap;
        if (!toSwap) return state;
        removeFromMap(toSwap.id);
        return {
          players: {
            ...state.players,
            [toSwap.id]: { ...toSwap, isStarting: false, isSub: true },
            [playerId]: { ...player, isStarting: true, isSub: false },
          },
          teams: updatedTeams,
        };
      }

      return {
        players: { ...state.players, [playerId]: { ...player, isStarting: true, isSub: false } },
      };
    });
  },

  markAsSub: (playerId: string) => {
    set((state) => {
      const player = state.players[playerId];
      if (!player || player.isStarting) return state;
      return {
        players: {
          ...state.players,
          [playerId]: { ...player, isSub: !player.isSub },
        },
      };
    });
  },

  swapPlayer: (removeId: string | null, addId: string, slotKey?: string) => {
    set(state => {
      const updates: Record<string, typeof state.players[string]> = {};
      if (removeId && state.players[removeId]) {
        updates[removeId] = { ...state.players[removeId], isStarting: false };
      }
      if (state.players[addId]) {
        updates[addId] = { ...state.players[addId], isStarting: true, isSub: false };
      }

      let updatedTeams = state.teams;
      if (slotKey && state.userTeamId) {
        const team = state.teams[state.userTeamId];
        const map = { ...(team.formationMap || {}) };
        map[slotKey] = addId;
        updatedTeams = { ...state.teams, [state.userTeamId]: { ...team, formationMap: map } };
      }

      return { players: { ...state.players, ...updates }, teams: updatedTeams };
    });
  },

  swapStartingSlots: (teamId: string, slotA: string, slotB: string) => {
    set(state => {
      const team = state.teams[teamId];
      if (!team || !team.formationMap) return state;
      const map = { ...team.formationMap };
      const playerA = map[slotA];
      const playerB = map[slotB];

      if (playerA) map[slotB] = playerA;
      else delete map[slotB];

      if (playerB) map[slotA] = playerB;
      else delete map[slotA];

      return { teams: { ...state.teams, [teamId]: { ...team, formationMap: map } } };
    });
  },
});

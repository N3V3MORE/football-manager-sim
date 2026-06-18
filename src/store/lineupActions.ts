import { getSlotsForFormation } from '../constants/formations';
import { Formation, GameState, Player, TeamTactics } from '../models/types';
import { rebuildFormationMap } from '../core/formationMapUtils';
import { isPlayerUnavailable } from '../core/playerStatusUtils';

type LineupActionState = Pick<GameState, 'players' | 'teams' | 'userTeamId'>;
type LineupActionResult = LineupActionState | Partial<Pick<GameState, 'players' | 'teams'>>;

export const applyLineupSuggestionToTeam = (
  allPlayers: Record<string, Player>,
  teamId: string,
  startingIds: string[],
  subIds: string[]
) => {
  const nextPlayers = { ...allPlayers };
  const teamPlayers = Object.values(allPlayers).filter(player => player.teamId === teamId);
  const eligibleIds = new Set(teamPlayers
    .filter(player => !isPlayerUnavailable(player))
    .map(player => player.id));
  const startingSet = new Set(startingIds
    .filter(playerId => eligibleIds.has(playerId))
    .slice(0, 11));
  const subSet = new Set(subIds
    .filter(playerId => eligibleIds.has(playerId) && !startingSet.has(playerId))
    .slice(0, 7));

  teamPlayers.forEach(player => {
    nextPlayers[player.id] = {
      ...player,
      isStarting: startingSet.has(player.id),
      isSub: subSet.has(player.id),
    };
  });

  return nextPlayers;
};

export const setFormationState = (
  state: LineupActionState,
  teamId: string,
  formation: Formation
): LineupActionResult => {
  const team = state.teams[teamId];
  if (!team) return state;

  const baseNew = formation.split('-')[0];
  const baseOld = (team.activeFormation || '').split('-')[0];
  const existingMap = team.formationMap || {};
  const hasExistingMap = Object.keys(existingMap).length > 0;

  if (baseNew === baseOld && hasExistingMap) {
    const teamStarters = Object.values(state.players)
      .filter(player => player.teamId === teamId && player.isStarting && !isPlayerUnavailable(player));
    const formationMap = rebuildFormationMap(getSlotsForFormation(formation), teamStarters, existingMap);
    return {
      teams: { ...state.teams, [teamId]: { ...team, activeFormation: formation, formationMap } },
    };
  }

  const updatedTeam = { ...team, activeFormation: formation };
  const teamPlayers = Object.values(state.players)
    .filter(player => player.teamId === teamId)
    .sort((a, b) => b.overallRating - a.overallRating);
  const eligibleTeamPlayers = teamPlayers.filter(player => !isPlayerUnavailable(player));
  const updatedPlayers = { ...state.players };

  teamPlayers.forEach(player => {
    updatedPlayers[player.id] = { ...player, isStarting: false, isSub: false };
  });

  const formationMap: Record<string, string> = {};
  const slots = getSlotsForFormation(formation);
  const assignedIds = new Set<string>();

  slots.forEach((row, rowIdx) => {
    row.forEach((slot, colIdx) => {
      const candidate = eligibleTeamPlayers.find(player => (
        player.subPosition === slot.label && !assignedIds.has(player.id)
      )) || eligibleTeamPlayers.find(player => (
        player.position === slot.pos && !assignedIds.has(player.id)
      ));

      if (!candidate) return;
      updatedPlayers[candidate.id] = { ...updatedPlayers[candidate.id], isStarting: true, isSub: false };
      formationMap[`${rowIdx}-${colIdx}`] = candidate.id;
      assignedIds.add(candidate.id);
    });
  });

  if (assignedIds.size < 11) {
    slots.forEach((row, rowIdx) => {
      row.forEach((_, colIdx) => {
        const slotKey = `${rowIdx}-${colIdx}`;
        if (formationMap[slotKey]) return;
        const player = eligibleTeamPlayers.find(candidate => !assignedIds.has(candidate.id));
        if (!player) return;

        updatedPlayers[player.id] = { ...updatedPlayers[player.id], isStarting: true, isSub: false };
        formationMap[slotKey] = player.id;
        assignedIds.add(player.id);
      });
    });
  }

  updatedTeam.formationMap = formationMap;

  return {
    teams: { ...state.teams, [teamId]: updatedTeam },
    players: updatedPlayers,
  };
};

export const setTacticsState = (
  state: LineupActionState,
  teamId: string,
  tactics: Partial<TeamTactics>
): LineupActionResult => {
  const team = state.teams[teamId];
  if (!team) return state;

  return {
    teams: {
      ...state.teams,
      [teamId]: { ...team, tactics: { ...team.tactics, ...tactics } },
    },
  };
};

export const toggleStartingState = (
  state: LineupActionState,
  playerId: string
): LineupActionResult => {
  const player = state.players[playerId];
  if (!player || isPlayerUnavailable(player)) return state;

  const teamPlayers = Object.values(state.players).filter(candidate => candidate.teamId === player.teamId);
  const starters = teamPlayers.filter(candidate => candidate.isStarting && !isPlayerUnavailable(candidate));
  let updatedTeams = state.teams;

  const removeFromMap = (removedPlayerId: string) => {
    const team = state.teams[player.teamId];
    if (!team?.formationMap) return;

    const newMap = { ...team.formationMap };
    Object.keys(newMap).forEach(key => {
      if (newMap[key] === removedPlayerId) delete newMap[key];
    });
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
    const toSwap = starters.filter(candidate => candidate.position === player.position)
      .sort((a, b) => a.overallRating - b.overallRating)[0]
      || starters.sort((a, b) => a.overallRating - b.overallRating)[0];
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
};

export const markAsSubState = (
  state: LineupActionState,
  playerId: string
): LineupActionResult => {
  const player = state.players[playerId];
  if (!player || player.isStarting || isPlayerUnavailable(player)) return state;

  return {
    players: {
      ...state.players,
      [playerId]: { ...player, isSub: !player.isSub },
    },
  };
};

export const swapPlayerState = (
  state: LineupActionState,
  removeId: string | null,
  addId: string,
  slotKey?: string
): LineupActionResult => {
  const addPlayer = state.players[addId];
  if (!addPlayer || isPlayerUnavailable(addPlayer)) return state;
  if (addPlayer.teamId !== state.userTeamId) return state;

  const removePlayer = removeId ? state.players[removeId] : null;
  if (removeId && !removePlayer) return state;
  if (removePlayer && removePlayer.teamId !== state.userTeamId) return state;

  if (addPlayer.isStarting && removePlayer?.isStarting && slotKey && state.userTeamId) {
    const team = state.teams[state.userTeamId];
    const map = { ...(team.formationMap || {}) };
    const existingSlotKey = Object.entries(map).find(([, playerId]) => playerId === addId)?.[0];
    if (existingSlotKey && existingSlotKey !== slotKey) {
      map[existingSlotKey] = removePlayer.id;
      map[slotKey] = addId;
      return {
        players: state.players,
        teams: { ...state.teams, [state.userTeamId]: { ...team, formationMap: map } },
      };
    }
  }

  if (!removeId || !removePlayer?.isStarting) {
    const currentStarters = Object.values(state.players).filter(
      p => p.teamId === state.userTeamId && p.isStarting && !isPlayerUnavailable(p) && p.id !== removeId
    );
    if (!addPlayer.isStarting && currentStarters.length >= 11) return state;
  }

  const updates: Record<string, Player> = {
    [addId]: { ...addPlayer, isStarting: true, isSub: false },
  };
  if (removeId && state.players[removeId]) {
    updates[removeId] = { ...state.players[removeId], isStarting: false, isSub: true };
  }

  let updatedTeams = state.teams;
  if (slotKey && state.userTeamId) {
    const team = state.teams[state.userTeamId];
    const map = { ...(team.formationMap || {}) };
    Object.entries(map).forEach(([key, playerId]) => {
      if (playerId === addId && key !== slotKey) delete map[key];
    });
    map[slotKey] = addId;
    updatedTeams = { ...state.teams, [state.userTeamId]: { ...team, formationMap: map } };
  }

  return { players: { ...state.players, ...updates }, teams: updatedTeams };
};

export const swapStartingSlotsState = (
  state: LineupActionState,
  teamId: string,
  slotA: string,
  slotB: string
): LineupActionResult => {
  const team = state.teams[teamId];
  if (!team?.formationMap) return state;

  const map = { ...team.formationMap };
  const playerA = map[slotA];
  const playerB = map[slotB];

  if (playerA) map[slotB] = playerA;
  else delete map[slotB];

  if (playerB) map[slotA] = playerB;
  else delete map[slotA];

  return { teams: { ...state.teams, [teamId]: { ...team, formationMap: map } } };
};

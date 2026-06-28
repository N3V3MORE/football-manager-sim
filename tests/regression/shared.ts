import * as fs from 'fs';
import * as path from 'path';
import { initGameData } from '../../src/utils/initGame';
import { quickSimMatch } from '../../src/core/matchEngine';
import { simulatePenaltyShootout } from '../../src/core/matchTieResolution';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../../src/core/leagueUtils';
import { BASE_FORMATION_SLOTS, getSlotsForFormation } from '../../src/constants/formations';
import { rebuildFormationMap, rebuildFormationSlotPlayers } from '../../src/core/formationMapUtils';
import { getCompetitionPanelForTeam, hasReachedCompetitionRound, resolveCompetitionProgression } from '../../src/core/competitionEngine';
import { buildBoardObjectives, buildBoardProfile } from '../../src/core/boardEngine';
import {
  applySharedPostMatchAccounting,
  didConcedeInWindow,
  applyWindowedCleanSheets,
  qualifiesForWindowedCleanSheet,
} from '../../src/core/postMatchAccounting';
import { advanceSeason } from '../../src/core/seasonTransition';
import { applyTacticalAdaptation } from '../../src/core/tacticalAdaptationEngine';
import { Fixture, Formation, InboxMessage, Player, Position, Team } from '../../src/models/types';
import { useGameStore } from '../../src/store/gameStore';
import { markAsSubState, toggleStartingState } from '../../src/store/lineupActions';
import {
  acceptTransferCounterState,
  approachPlayerState,
  buyPlayerState,
  resolveWeeklyNegotiationsState,
  signFreeAgentState,
} from '../../src/store/transferActions';
import { computeMarketValue } from '../../src/utils/calendar';
import { applyInboxActionState } from '../../src/store/inboxActions';
import { advanceWeekState } from '../../src/store/weekLifecycle';
import { finishLiveMatchState, makeLiveSubstitutionsState, processLiveMatchMinuteState, setLiveMatchFormationState } from '../../src/store/liveMatchActions';
import { sanitizePersistedState } from '../../src/store/persistence';
import { isPlayerUnavailable } from '../../src/core/playerStatusUtils';
import { FREE_AGENT_TEAM_ID, createFreeAgentTeam } from '../../src/core/freeAgentPool';
import { getSquadPolicy } from '../../src/core/squadPolicy';
import { applySackingRisk } from '../../src/store/weeklyAccounting';

export const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

export const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const readSource = (filePath: string) => fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');

export const POSITION_META: Record<Position, { subPosition: string; altPositions: string[] }> = {
  GK: { subPosition: 'GK', altPositions: ['GK'] },
  DEF: { subPosition: 'CB', altPositions: ['CB', 'RB', 'LB'] },
  MID: { subPosition: 'CM', altPositions: ['CM', 'CDM', 'CAM'] },
  FWD: { subPosition: 'ST', altPositions: ['ST', 'LW', 'RW'] },
};

export type TestTeamOverrides = Partial<Omit<Team, 'boardProfile' | 'manager'>> & {
  boardProfile?: Partial<Team['boardProfile']>;
  manager?: Partial<Team['manager']>;
};

export const buildTestTeam = (template: Team, id: string, name: string, overrides: TestTeamOverrides = {}): Team => {
  const { boardProfile: boardProfileOverrides, manager: managerOverrides, ...teamOverrides } = overrides;
  const boardProfile = { ...template.boardProfile, ...boardProfileOverrides };
  return {
    ...template,
    ...teamOverrides,
    id,
    name,
    division: teamOverrides.division || 'Premier League',
    isExternal: teamOverrides.isExternal ?? false,
    clubClass: teamOverrides.clubClass || 'C',
    boardProfile,
    manager: {
      ...template.manager,
      ...managerOverrides,
      id: managerOverrides?.id || `${id}-manager`,
      teamId: id,
      teamName: name,
    },
    budget: teamOverrides.budget ?? 100,
    operatingBudget: teamOverrides.operatingBudget ?? teamOverrides.budget ?? 100,
    transferSpend: teamOverrides.transferSpend ?? 0,
    played: teamOverrides.played ?? 1,
    activeFormation: teamOverrides.activeFormation || '4-3-3',
  };
};

export const buildTestPlayer = (
  template: Player,
  id: string,
  teamId: string,
  position: Position,
  rating: number,
  overrides: Partial<Player> = {}
): Player => ({
  ...template,
  ...overrides,
  id,
  name: overrides.name || id,
  teamId,
  position,
  subPosition: overrides.subPosition || POSITION_META[position].subPosition,
  altPositions: overrides.altPositions || POSITION_META[position].altPositions,
  overallRating: rating,
  marketValue: overrides.marketValue ?? Math.max(1, Math.round((rating - 45) / 2)),
  age: overrides.age ?? 25,
  morale: overrides.morale ?? 70,
  energy: overrides.energy ?? 95,
  isStarting: overrides.isStarting ?? false,
  isSub: overrides.isSub ?? false,
  isTransferListed: overrides.isTransferListed ?? false,
  askingPrice: overrides.askingPrice ?? 0,
  matchesSuspended: overrides.matchesSuspended ?? 0,
  injuryWeeks: overrides.injuryWeeks ?? 0,
  wage: overrides.wage ?? 20,
  contractLeft: overrides.contractLeft ?? 3,
  impactCoefficient: overrides.impactCoefficient ?? 1,
  matchRatingHistory: overrides.matchRatingHistory ?? [],
  minutesPlayed: overrides.minutesPlayed ?? 0,
  goals: overrides.goals ?? 0,
  assists: overrides.assists ?? 0,
  cleanSheets: overrides.cleanSheets ?? 0,
  yellowCards: overrides.yellowCards ?? 0,
  redCards: overrides.redCards ?? 0,
  nationality: overrides.nationality || 'English',
});

export const addSquadPlayers = (
  players: Record<string, Player>,
  template: Player,
  teamId: string,
  prefix: string,
  counts: Record<Position, number>,
  options: {
    rating?: number;
    positionRatings?: Partial<Record<Position, number>>;
    starterCounts?: Partial<Record<Position, number>>;
    wage?: number;
    age?: number;
  } = {}
) => {
  (Object.keys(counts) as Position[]).forEach(position => {
    for (let index = 0; index < counts[position]; index += 1) {
      const id = `${prefix}-${position.toLowerCase()}-${index}`;
      players[id] = buildTestPlayer(
        template,
        id,
        teamId,
        position,
        options.positionRatings?.[position] ?? options.rating ?? 70,
        {
          age: options.age,
          wage: options.wage,
          isStarting: index < (options.starterCounts?.[position] || 0),
        }
      );
    }
  });
};

export {
  initGameData, quickSimMatch, simulatePenaltyShootout, computeWeeklyProgression, computeWeeklyTransfers, getSeasonWeekLimit, BASE_FORMATION_SLOTS, getSlotsForFormation, rebuildFormationMap, rebuildFormationSlotPlayers, getCompetitionPanelForTeam, hasReachedCompetitionRound, resolveCompetitionProgression, buildBoardObjectives, buildBoardProfile, applySharedPostMatchAccounting, didConcedeInWindow, applyWindowedCleanSheets, qualifiesForWindowedCleanSheet, advanceSeason, applyTacticalAdaptation, Fixture, Formation, InboxMessage, Player, Position, Team, useGameStore, markAsSubState, toggleStartingState, acceptTransferCounterState, approachPlayerState, buyPlayerState, resolveWeeklyNegotiationsState, signFreeAgentState, computeMarketValue, applyInboxActionState, advanceWeekState, finishLiveMatchState, makeLiveSubstitutionsState, processLiveMatchMinuteState, setLiveMatchFormationState, sanitizePersistedState, isPlayerUnavailable, FREE_AGENT_TEAM_ID, createFreeAgentTeam, getSquadPolicy, applySackingRisk,
};

import { Player, Team } from '../models/types';
import { applySubstitutions } from './substitutionEngine';
import { RandomGenerator } from './random';

export { applySubstitutions } from './substitutionEngine';
export { removePlayerFromTeamSelections } from './formationMapUtils';

export type SubstitutionState = {
  substitutesUsed: number;
  substitutionWindowsUsed: number;
  maxSubstitutes: number;
  maxWindows: number;
};

export const createSubstitutionState = (): SubstitutionState => ({
  substitutesUsed: 0,
  substitutionWindowsUsed: 0,
  maxSubstitutes: 5,
  maxWindows: 3,
});

export const canUseSubstitutionWindow = (state: SubstitutionState) => (
  state.substitutesUsed < state.maxSubstitutes && state.substitutionWindowsUsed < state.maxWindows
);

export const recordSubstitution = (state: SubstitutionState) => {
  state.substitutesUsed += 1;
  state.substitutionWindowsUsed += 1;
};

export type ApplyMatchSubstitutionsOptions = {
  rng?: RandomGenerator;
  maxSubsOverride?: number;
  minuteOverride?: number;
  onSubstitution?: (offPlayer: Player, onPlayer: Player, minute: number) => void;
  playerEntryMinutes?: Record<string, number>;
  substitutionState?: SubstitutionState;
};

export const applyMatchSubstitutions = (
  starters: Player[],
  bench: Player[],
  sentOffPlayers: Set<string>,
  playerMinutes: Record<string, number>,
  team: Team,
  goalsFor: number,
  goalsAgainst: number,
  options?: ApplyMatchSubstitutionsOptions
) => {
  const subState = options?.substitutionState ?? createSubstitutionState();

  applySubstitutions(
    starters,
    bench,
    sentOffPlayers,
    playerMinutes,
    team,
    goalsFor,
    goalsAgainst,
    options?.rng,
    {
      maxSubsOverride: options?.maxSubsOverride,
      minuteOverride: options?.minuteOverride,
      onSubstitution: options?.onSubstitution,
      playerEntryMinutes: options?.playerEntryMinutes,
      substitutionState: subState,
    }
  );
};

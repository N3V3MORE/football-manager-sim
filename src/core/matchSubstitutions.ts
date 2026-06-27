export { applySubstitutions } from './substitutionEngine';

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

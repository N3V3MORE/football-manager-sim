import { GameStore } from '../types';

const stripLegacyTeamFields = (team: GameStore['teams'][string]) => {
  const { division: _division, ...rest } = team;
  return rest;
};

const stripLegacyFixtureFields = (fixture: GameStore['fixtures'][string]) => {
  const { competition: _competition, division: _division, ...rest } = fixture;
  return rest;
};

const stripLegacyCupFields = (cup: GameStore['cups'][string]) => {
  const { competition: _competition, ...rest } = cup;
  return rest;
};

const stripLegacyTrophyHistoryFields = (entry: GameStore['trophyHistory'][number]) => {
  const { competition: _competition, ...rest } = entry;
  return rest;
};

export const sanitizeStateForPersistence = (state: GameStore) => ({
  ...state,
  teams: Object.fromEntries(
    Object.entries(state.teams).map(([teamId, team]) => [teamId, stripLegacyTeamFields(team)])
  ),
  fixtures: Object.fromEntries(
    Object.entries(state.fixtures).map(([fixtureId, fixture]) => [fixtureId, stripLegacyFixtureFields(fixture)])
  ),
  cups: Object.fromEntries(
    Object.entries(state.cups).map(([competitionId, cup]) => [competitionId, stripLegacyCupFields(cup)])
  ),
  trophyHistory: state.trophyHistory.map(stripLegacyTrophyHistoryFields),
});

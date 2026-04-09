import { Fixture, Team } from '../models/types';
import { buildRoundRobinFixtures, DIVISION_ORDER } from './leagueUtils';
import { buildInitialCupFixtures } from './cupUtils';
import { getTeamLeagueId } from './domainRegistry';

export const buildSeasonFixtures = (
  teams: Record<string, Team>,
  fixtureCounterStart = 1
) => {
  let fixtures: Record<string, Fixture> = {};
  let fixtureCounter = fixtureCounterStart;

  DIVISION_ORDER.forEach(division => {
    const divisionTeamIds = Object.values(teams)
      .filter(team => getTeamLeagueId(team) === division)
      .map(team => team.id);
    const generated = buildRoundRobinFixtures(divisionTeamIds, division, fixtureCounter);
    fixtures = { ...fixtures, ...generated.fixtures };
    fixtureCounter = generated.nextCounter;
  });

  const cupBundle = buildInitialCupFixtures(teams, fixtureCounter);
  fixtures = { ...fixtures, ...cupBundle.fixtures };
  fixtureCounter = cupBundle.nextCounter;

  return {
    fixtures,
    cups: cupBundle.cupStates,
    nextCounter: fixtureCounter,
  };
};

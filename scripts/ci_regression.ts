import assert from 'node:assert/strict';
import { initGameData } from '../src/utils/initGame';
import {
  getSeasonEuropeQualifiedTeamIds,
  resolveCompetitionProgression,
} from '../src/core/competitionEngine';
import { LeagueDivision } from '../src/models/types';
import { advanceSeason } from '../src/core/seasonTransition';

import { run as runCleanSheets } from './regression/cleanSheets';
import { run as runSeason } from './regression/seasons';
import { run as runFormationChecks } from './regression/formations';
import { run as runTransferStress } from './regression/transfers';
import { run as runContractChecks } from './regression/contracts';

const runCompetitionBackendChecks = () => {
  const data = initGameData();
  const teams = data.teams;
  const competitions = data.competitions;
  const fixtures = data.fixtures;

  const premierLeagueTeams = Object.values(teams).filter(team => team.division === 'Premier League');
  assert.ok(premierLeagueTeams.length >= 18, 'Expected at least 18 Premier League teams');

  assert.ok(competitions['premier-league'], 'Expected premier-league competition');
  assert.ok(competitions.championship, 'Expected championship competition');
  assert.ok(competitions['league-one'], 'Expected league-one competition');
  assert.ok(competitions['league-two'], 'Expected league-two competition');
  assert.ok(competitions['carabao-cup'], 'Expected carabao-cup competition');
  assert.ok(competitions['fa-cup'], 'Expected fa-cup competition');
  assert.ok(competitions.europe, 'Expected europe competition');

  assert.ok(competitions['carabao-cup']!.type === 'domestic_cup', 'Carabao Cup should be domestic_cup');
  assert.ok(competitions['fa-cup']!.type === 'domestic_cup', 'FA Cup should be domestic_cup');
  assert.ok(competitions.europe!.type === 'continental', 'Europe should be continental');

  assert.ok(competitions['premier-league']!.entrantTeamIds.length >= 18, 'Premier League should have >= 18 entrants');
  assert.ok(competitions['carabao-cup']!.rounds.length > 0, 'Carabao Cup should have rounds');
  assert.ok(competitions['fa-cup']!.rounds.length > 0, 'FA Cup should have rounds');
  assert.ok(competitions.europe!.rounds.length > 0, 'Europe should have rounds');

  const englishClubIds = Object.values(teams)
    .filter(team => !team.isExternal && team.countryId === 'england')
    .map(team => team.id);
  englishClubIds.forEach(teamId => {
    assert.ok(competitions['carabao-cup']!.entrantTeamIds.includes(teamId), `English team ${teamId} should be in Carabao Cup`);
    assert.ok(competitions['fa-cup']!.entrantTeamIds.includes(teamId), `English team ${teamId} should be in FA Cup`);
  });

  const europeEntrants = getSeasonEuropeQualifiedTeamIds(teams, competitions);
  assert.ok(europeEntrants.length === 8, `Europe should have exactly 8 entrants, got ${europeEntrants.length}`);

  const playedFixtures: Record<string, typeof fixtures[string]> = {};
  const simData = initGameData();
  const simFixtures = simData.fixtures;
  Object.keys(simFixtures).slice(0, 10).forEach(fixtureId => {
    const fixture = simFixtures[fixtureId]!;
    playedFixtures[fixtureId] = { ...fixture, isPlayed: true, homeScore: 1, awayScore: 0, winnerTeamId: fixture.homeTeamId };
  });

  const result = resolveCompetitionProgression({ ...simFixtures, ...playedFixtures }, simData.competitions, simData.teams);
  assert.ok(Object.keys(result.fixtures).length > 0, 'Expected fixtures after progression');
  assert.ok(result.competitions, 'Expected competitions after progression');

  const simulatedCompetitions = resolveCompetitionProgression(simData.fixtures, simData.competitions, simData.teams);
  assert.ok(simulatedCompetitions.generatedNews, 'Expected generated news from competition progression');

  const allLeagueFixtures = Object.values(simFixtures).filter(fixture => fixture.competitionType === 'league');
  assert.ok(allLeagueFixtures.length > 0, 'Expected league fixtures');

  const nextSeason = advanceSeason(simData.players, simData.teams, simData.competitions, 'T1', []);
  assert.ok(nextSeason.currentWeek === 1, `Season advance should reset to week 1, got ${nextSeason.currentWeek}`);
  assert.ok(nextSeason.fixtures, 'Season advance should produce fixtures');
  assert.ok(nextSeason.competitions, 'Season advance should produce competitions');

  const promotedTeams = Object.values(nextSeason.teams).filter(team => team.division === 'Premier League');
  assert.ok(promotedTeams.length <= 20, `Premier League should have no more than 20 teams after season advance, got ${promotedTeams.length}`);

  const leagueNames: LeagueDivision[] = ['Championship', 'League One', 'League Two'];
  leagueNames.forEach(division => {
    const divisionTeams = Object.values(nextSeason.teams).filter(team => team.division === division);
    assert.ok(divisionTeams.length > 0, `Expected teams in ${division} after season advance`);
  });
};

const run = () => {
  console.log('--- CI REGRESSION CHECKS ---');
  runCleanSheets();
  console.log('[OK] Invariant checks passed');
  runFormationChecks(runSeason);
  console.log('[OK] Seasonal threshold checks passed');
  runTransferStress();
  console.log('[OK] State consistency stress checks passed');
  runContractChecks();
  console.log('[OK] Career engine checks passed');
  runCompetitionBackendChecks();
  console.log('[OK] Competition backend checks passed');
  console.log('--- CI REGRESSION COMPLETE ---');
};

run();

import assert from 'node:assert/strict';

export const run = (runSeason: (seed: number) => any) => {
const runThresholdChecks = () => {
  const seasons = [20260513, 20260514, 20260515].map(runSeason);
  const avgGoals = seasons.reduce((sum, season) => sum + season.avgGoalsPerMatch, 0) / seasons.length;
  const totalYellow = seasons.reduce((sum, season) => sum + season.yellowCards, 0);
  const totalRed = seasons.reduce((sum, season) => sum + season.redCards, 0);
  const redCardLogMismatches = seasons.reduce((sum, season) => sum + season.redCardLogMismatches, 0);
  const redCardEventsWithoutCard = seasons.reduce((sum, season) => sum + season.redCardEventsWithoutCard, 0);
  const avgTacticalChanges = seasons.reduce((sum, season) => sum + season.totalTacticalChanges, 0) / seasons.length;
  const avgTeamsWithNoTacticalChanges = seasons.reduce((sum, season) => sum + season.teamsWithNoTacticalChanges, 0) / seasons.length;
  const formationUsage = seasons.reduce(
    (acc, season) => ({
      back3: acc.back3 + season.formationUsage.back3,
      back4: acc.back4 + season.formationUsage.back4,
      back5: acc.back5 + season.formationUsage.back5,
    }),
    { back3: 0, back4: 0, back5: 0 }
  );

  assert.ok(avgGoals >= 2.3 && avgGoals <= 4.8, `Expected avg goals between 2.3 and 4.8, got ${avgGoals.toFixed(2)}`);
  assert.ok(totalYellow > 0, 'Expected at least one yellow card across threshold runs');
  assert.ok(totalRed > 0, 'Expected at least one red card across threshold runs');
  assert.equal(redCardLogMismatches, 0, 'Red cards should always produce an explicit red-card event message');
  assert.equal(redCardEventsWithoutCard, 0, 'Red-card event messages should only appear when a red card is recorded');
  assert.ok(avgTacticalChanges >= 110, `Expected average tactical changes >= 110, got ${avgTacticalChanges.toFixed(1)}`);
  assert.ok(avgTeamsWithNoTacticalChanges <= 35, `Expected average teams with no tactical changes <= 35, got ${avgTeamsWithNoTacticalChanges.toFixed(1)}`);
  assert.ok(formationUsage.back3 > 0, 'Expected some back-3 usage');
  assert.ok(formationUsage.back5 > 0, 'Expected some back-5 usage');
};
  runThresholdChecks();
};

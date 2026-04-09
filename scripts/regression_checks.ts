import * as fs from 'fs';
import * as path from 'path';
import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';
import { getSlotsForFormation } from '../src/constants/formations';
import { rebuildFormationMap, rebuildFormationSlotPlayers } from '../src/core/formationMapUtils';
import {
  COMPETITION_IDS,
  DEFAULT_COUNTRY_ID,
  LEAGUE_IDS,
  getFixtureCompetitionId,
  getTeamLeagueId,
  registerCompetitionDefinition,
  registerLeagueDefinition,
} from '../src/core/domainRegistry';
import {
  didConcedeInWindow,
  applyWindowedCleanSheets,
  qualifiesForWindowedCleanSheet,
} from '../src/core/postMatchAccounting';
import { advanceSeason } from '../src/core/seasonTransition';
import { createEmptyTrophyCabinet } from '../src/core/trophyUtils';
import { buildSimulationRuntime } from '../src/core/simulationRuntime';
import {
  compileMatchEffects,
  registerPlayerTraitEffectModule,
  registerTeamTacticEffectModule,
} from '../src/core/tacticalEffects';
import { Player } from '../src/models/types';
import { useGameStore } from '../src/store/gameStore';
import { normalizeHydratedState } from '../src/store/setup';

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const readSource = (filePath: string) => fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');

const collectSourceFiles = (rootPath: string): string[] => {
  const absoluteRoot = path.join(process.cwd(), rootPath);
  return fs.readdirSync(absoluteRoot, { withFileTypes: true }).flatMap(entry => {
    const resolvedPath = path.join(absoluteRoot, entry.name);
    const relativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
    if (entry.isDirectory()) return collectSourceFiles(relativePath);
    return /\.(ts|tsx)$/.test(entry.name) ? [relativePath] : [];
  });
};

const checkCleanSheetWindows = () => {
  assert(!didConcedeInWindow([], 0, 90, 0), 'Empty conceded-minute list with 0 conceded should be clean');
  assert(!didConcedeInWindow([30], 0, 29, 1), 'Player subbed before concession should keep clean sheet');
  assert(didConcedeInWindow([30], 0, 90, 1), 'Player on pitch for concession should not keep clean sheet');
  assert(
    !qualifiesForWindowedCleanSheet([61], 0, 29, 1),
    'Short defensive cameo should not qualify for clean-sheet stat'
  );
  assert(
    qualifiesForWindowedCleanSheet([61], 0, 60, 1),
    'Starter subbed after 60 minutes before concession should qualify for clean-sheet stat'
  );

  const basePlayer = Object.values(initGameData().players).find(player => player.position === 'DEF');
  assert(basePlayer, 'Regression setup needs a defender fixture player');

  const shortSubbedBeforeGoal: Player = { ...basePlayer!, id: 'cs-short', cleanSheets: 0, position: 'DEF' };
  const qualifiedBeforeGoal: Player = { ...basePlayer!, id: 'cs-qualified', cleanSheets: 0, position: 'DEF' };
  const playedThroughGoal: Player = { ...basePlayer!, id: 'cs-through', cleanSheets: 0, position: 'DEF' };
  const updatedPlayers = {
    [shortSubbedBeforeGoal.id]: shortSubbedBeforeGoal,
    [qualifiedBeforeGoal.id]: qualifiedBeforeGoal,
    [playedThroughGoal.id]: playedThroughGoal,
  };

  applyWindowedCleanSheets(
    [shortSubbedBeforeGoal, qualifiedBeforeGoal, playedThroughGoal],
    new Set([shortSubbedBeforeGoal.id, qualifiedBeforeGoal.id, playedThroughGoal.id]),
    { [shortSubbedBeforeGoal.id]: 29, [qualifiedBeforeGoal.id]: 60, [playedThroughGoal.id]: 90 },
    [61],
    1,
    updatedPlayers,
    LEAGUE_IDS.PREMIER_LEAGUE
  );

  assert(updatedPlayers[shortSubbedBeforeGoal.id].cleanSheets === 0, 'Short subbed-off player should not get clean sheet');
  assert(updatedPlayers[qualifiedBeforeGoal.id].cleanSheets === 1, 'Qualified subbed-off player before concession should get clean sheet');
  assert(updatedPlayers[playedThroughGoal.id].cleanSheets === 0, 'Player on pitch for concession should not get clean sheet');
};

const checkLiveSentOffMinutes = () => {
  useGameStore.getState().initializeGame('T1');
  const state = useGameStore.getState();
  const fixture = Object.values(state.fixtures)
    .find(item => item.homeTeamId !== 'T1' && item.awayTeamId !== 'T1');
  assert(fixture, 'Regression setup needs a non-user fixture');

  const homeStarterIds = Object.values(state.players)
    .filter(player => player.teamId === fixture!.homeTeamId && player.isStarting)
    .map(player => player.id);
  const awayStarterIds = Object.values(state.players)
    .filter(player => player.teamId === fixture!.awayTeamId && player.isStarting)
    .map(player => player.id);
  assert(homeStarterIds.length > 0 && awayStarterIds.length > 0, 'Regression setup needs live starters');

  const sentOffPlayerId = homeStarterIds[0];
  const beforeMinutes = state.players[sentOffPlayerId].minutesPlayed || 0;

  useGameStore.setState(prev => ({
    fixtures: {
      ...prev.fixtures,
      [fixture!.id]: { ...fixture!, homeScore: 0, awayScore: 0, isPlayed: false },
    },
    liveMatches: {
      ...(prev.liveMatches || {}),
      [fixture!.id]: {
        initialized: true,
        yellowCardPlayerIds: [],
        sentOffPlayerIds: [sentOffPlayerId],
        sentOffMinutes: { [sentOffPlayerId]: 42 },
        homeGoalMinutes: [],
        awayGoalMinutes: [],
        homeStarterIds,
        awayStarterIds,
      },
    },
  }));

  useGameStore.getState().finishLiveMatch(fixture!.id);
  const after = useGameStore.getState().players[sentOffPlayerId];
  assert(
    (after.minutesPlayed || 0) - beforeMinutes === 42,
    `Sent-off live player should receive 42 minutes, got ${(after.minutesPlayed || 0) - beforeMinutes}`
  );
};

const checkCupCompetitionIntegration = () => {
  const data = initGameData();
  const cupFixture = Object.values(data.fixtures).find(fixture => getFixtureCompetitionId(fixture) !== COMPETITION_IDS.LEAGUE);
  assert(cupFixture, 'Regression setup needs at least one cup fixture');

  const homeBefore = data.teams[cupFixture!.homeTeamId];
  const awayBefore = data.teams[cupFixture!.awayTeamId];
  const result = quickSimMatch(cupFixture!.id, data.players, data.teams, data.fixtures, null);
  const playedFixture = result.fixture;

  assert(getFixtureCompetitionId(playedFixture) !== COMPETITION_IDS.LEAGUE, 'Cup fixture should stay marked as a cup');
  assert(playedFixture.winnerTeamId, 'Cup fixture should resolve a winner');
  assert(
    result.teams[homeBefore.id].points === homeBefore.points &&
      result.teams[awayBefore.id].points === awayBefore.points,
    'Cup fixtures should not change league points'
  );
};

const checkBranchGuards = () => {
  const matchEngine = readSource('src/core/matchEngine.ts');
  const gameStore = readSource('src/store/gameStore.ts');
  const matchActions = readSource('src/store/actions/match.ts');
  const liveMatchSource = `${gameStore}\n${matchActions}`;

  assert(
    /if \(matchYellowCards\.has\(playerId\)\)[\s\S]*(addPlayerStat\(updatedPlayers, playerId, 'yellowCards'\)|incrementPlayerStatLocal\(playerId, 'yellowCards'\));[\s\S]*sendOffPlayer/.test(matchEngine),
    'Quick sim second-yellow branch must add yellow-card stat before red'
  );
  assert(
    /if \(matchYellowCards\.has\(playerId\)\)[\s\S]*(addPlayerStat\(updatedPlayers, playerId, 'yellowCards'\)|recordPlayerScopedStat\(updatedPlayers, playerId, statScopeId, 'yellowCards'\));[\s\S]*sendOffPlayer/.test(liveMatchSource),
    'Live sim second-yellow branch must add yellow-card stat before red'
  );
  assert(
    /simulatePossession\([\s\S]*attShape,[\s\S]*defShape[\s\S]*\)/.test(matchEngine),
    'Quick sim must pass formation shape into simulatePossession'
  );
  assert(
    /buildTeamShapeProfile\(homeTeam, homeStarters\)[\s\S]*simulatePossession\([\s\S]*attShape,[\s\S]*defShape[\s\S]*\)/.test(liveMatchSource),
    'Live sim must pass formation shape into simulatePossession'
  );
};

const checkUserTeamProgressionDoesNotAdaptFormation = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams)[0];
  const beforeFormation = userTeam.activeFormation;
  const beforeTactics = JSON.stringify(userTeam.tactics);

  const teams = {
    ...data.teams,
    [userTeam.id]: {
      ...userTeam,
      played: 6,
      goalsFor: 4,
      goalsAgainst: 14,
      form: ['L', 'L', 'L', 'L', 'L'],
    },
  };

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const result = computeWeeklyProgression(1, data.players, teams, data.fixtures, [], userTeam.id);
    assert(
      result.teams[userTeam.id].activeFormation === beforeFormation,
      'User team formation should not be changed by AI tactical adaptation'
    );
    assert(
      JSON.stringify(result.teams[userTeam.id].tactics) === beforeTactics,
      'User team tactics should not be changed by AI tactical adaptation'
    );
  } finally {
    Math.random = originalRandom;
  }
};

const checkManagerProfilesLoaded = () => {
  const data = initGameData();
  const teams = Object.values(data.teams);
  assert(teams.every(team => team.manager && team.manager.teamId === team.id), 'Every team should have a linked manager profile');
  assert(teams.every(team => team.manager.preferredFormations.length > 0), 'Every manager should have at least one preferred formation');
};

const checkDivisionBootstrap = () => {
  const data = initGameData();
  const counts = Object.values(data.teams).reduce<Record<string, number>>((acc, team) => {
    const leagueId = getTeamLeagueId(team);
    acc[leagueId] = (acc[leagueId] || 0) + 1;
    return acc;
  }, {});

  assert(counts[LEAGUE_IDS.PREMIER_LEAGUE] === 20, `Expected 20 Premier League teams, got ${counts[LEAGUE_IDS.PREMIER_LEAGUE] || 0}`);
  assert(counts[LEAGUE_IDS.CHAMPIONSHIP] === 24, `Expected 24 Championship teams, got ${counts[LEAGUE_IDS.CHAMPIONSHIP] || 0}`);
  assert(counts[LEAGUE_IDS.LEAGUE_ONE] === 24, `Expected 24 League One teams, got ${counts[LEAGUE_IDS.LEAGUE_ONE] || 0}`);
  assert(counts[LEAGUE_IDS.LEAGUE_TWO] === 24, `Expected 24 League Two teams, got ${counts[LEAGUE_IDS.LEAGUE_TWO] || 0}`);
};

const checkPromotionRelegation = () => {
  const data = initGameData();
  const teams = { ...data.teams };

  ([LEAGUE_IDS.PREMIER_LEAGUE, LEAGUE_IDS.CHAMPIONSHIP, LEAGUE_IDS.LEAGUE_ONE, LEAGUE_IDS.LEAGUE_TWO] as const).forEach(division => {
    const ordered = Object.values(teams)
      .filter(team => getTeamLeagueId(team) === division)
      .sort((a, b) => a.name.localeCompare(b.name));

    ordered.forEach((team, index) => {
      teams[team.id] = {
        ...team,
        points: 1000 - index,
        goalsFor: 1000 - index,
        goalsAgainst: index,
        wins: 30 - index,
        draws: 0,
        losses: index,
        played: 38,
      };
    });
  });

  const nextSeason = advanceSeason(
    data.players,
    teams,
    data.fixtures,
    data.cups,
    null,
    [],
    1,
    createEmptyTrophyCabinet(),
    [],
    []
  );
  const nextCounts = Object.values(nextSeason.teams).reduce<Record<string, number>>((acc, team) => {
    const leagueId = getTeamLeagueId(team);
    acc[leagueId] = (acc[leagueId] || 0) + 1;
    return acc;
  }, {});

  assert(nextSeason.currentWeek === 1, 'Season rollover should reset the week to 1');
  assert(nextCounts[LEAGUE_IDS.PREMIER_LEAGUE] === 20, 'Premier League should keep 20 teams after promotion/relegation');
  assert(nextCounts[LEAGUE_IDS.CHAMPIONSHIP] === 24, 'Championship should keep 24 teams after promotion/relegation');
  assert(nextCounts[LEAGUE_IDS.LEAGUE_ONE] === 24, 'League One should keep 24 teams after promotion/relegation');
  assert(nextCounts[LEAGUE_IDS.LEAGUE_TWO] === 24, 'League Two should keep 24 teams after promotion/relegation');

  const championshipTop = Object.values(teams)
    .filter(team => getTeamLeagueId(team) === LEAGUE_IDS.CHAMPIONSHIP)
    .sort((a, b) => b.points - a.points || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name))
    .slice(0, 3);
  const premierBottom = Object.values(teams)
    .filter(team => getTeamLeagueId(team) === LEAGUE_IDS.PREMIER_LEAGUE)
    .sort((a, b) => a.points - b.points || a.goalsFor - b.goalsFor || a.name.localeCompare(b.name))
    .slice(0, 3);

  assert(championshipTop.every(team => getTeamLeagueId(nextSeason.teams[team.id]) === LEAGUE_IDS.PREMIER_LEAGUE), 'Top Championship teams should be promoted');
  assert(premierBottom.every(team => getTeamLeagueId(nextSeason.teams[team.id]) === LEAGUE_IDS.CHAMPIONSHIP), 'Bottom Premier League teams should be relegated');
};

const checkRegistryBackedDefinitions = () => {
  registerLeagueDefinition({
    id: 'Test League',
    countryId: DEFAULT_COUNTRY_ID,
    displayName: 'Test League',
    tier: 99,
    teamCount: 10,
    roundsPerOpponent: 2,
    promotionSlots: 0,
    relegationSlots: 0,
    newsPriority: 1,
  });
  registerCompetitionDefinition({
    id: 'Test Shield',
    type: 'domestic-cup',
    displayName: 'Test Shield',
    countryScope: DEFAULT_COUNTRY_ID,
    trackedForTrophies: false,
    fixtureStrategy: 'inactive',
    roundNames: ['Final'],
    startWeek: 1,
    spacingWeeks: 1,
    sortPriority: 999,
  });

  const data = initGameData();
  assert(Object.values(data.teams).every(team => Boolean(team.leagueId)), 'Every team should have a leagueId');
  assert(Object.values(data.fixtures).every(fixture => Boolean(fixture.competitionId)), 'Every fixture should have a competitionId');

  const runtime = buildSimulationRuntime({
    teams: data.teams,
    players: data.players,
    fixtures: data.fixtures,
  });
  assert(runtime.leagueDefinitionsById['Test League'], 'Registered leagues should be visible in runtime definitions');
  assert(runtime.competitionDefinitionsById['Test Shield'], 'Registered competitions should be visible in runtime definitions');
  assert((runtime.teamsByLeague[LEAGUE_IDS.PREMIER_LEAGUE] || []).length === 20, 'Runtime should index Premier League teams');
  assert((runtime.fixturesByCompetition[COMPETITION_IDS.LEAGUE] || []).length > 0, 'Runtime should index league fixtures');
};

const checkTacticAndTraitModuleRegistration = () => {
  registerTeamTacticEffectModule({
    id: 'test-system-module',
    applies: ({ team }) => Boolean(team.tactics.systemIds?.includes('test-system')),
    apply: effects => {
      effects.chanceCreation.creatorBonusMultiplier *= 1.2;
    },
  });
  registerPlayerTraitEffectModule({
    id: 'test-trait-module',
    applies: ({ traitCounts }) => Boolean(traitCounts['Test Trait']),
    apply: effects => {
      effects.energyDrain.multiplier *= 0.9;
    },
  });

  const data = initGameData();
  const team = Object.values(data.teams)[0];
  const players = Object.values(data.players)
    .filter(player => player.teamId === team.id)
    .slice(0, 11);

  const baseEffects = compileMatchEffects(
    { ...team, tactics: { ...team.tactics, systemIds: [] } },
    players.map(player => ({ ...player, traitIds: [] }))
  );
  const extendedEffects = compileMatchEffects(
    { ...team, tactics: { ...team.tactics, systemIds: ['test-system'] } },
    players.map((player, index) => ({
      ...player,
      traitIds: index === 0 ? ['Test Trait'] : [],
    }))
  );

  assert(
    extendedEffects.chanceCreation.creatorBonusMultiplier > baseEffects.chanceCreation.creatorBonusMultiplier,
    'Registered team tactic modules should change compiled match effects'
  );
  assert(
    extendedEffects.energyDrain.multiplier < baseEffects.energyDrain.multiplier,
    'Registered player trait modules should change compiled match effects'
  );
};

const checkLegacyHydrationMapping = () => {
  const data = initGameData();
  const firstTeam = Object.values(data.teams)[0];
  const firstFixture = Object.values(data.fixtures)[0];
  assert(firstTeam && firstFixture, 'Hydration regression setup requires initial team and fixture data');

  const repaired = normalizeHydratedState(
    {
      teams: {
        [firstTeam.id]: {
          ...firstTeam,
          leagueId: undefined,
          division: 'Premier League',
        },
      },
      players: {},
      fixtures: {
        [firstFixture.id]: {
          ...firstFixture,
          competitionId: undefined,
          competition: 'League',
          leagueId: undefined,
          division: 'Premier League',
        },
      },
      cups: {
        'FA Cup': {
          competitionId: undefined as never,
          competition: 'FA Cup',
          roundNumber: 1,
          roundName: 'Round 1',
          entrants: [firstTeam.id],
          scheduledWeek: 2,
          completed: false,
        },
      } as never,
      trophyCabinet: { 'FA Cup': 2 } as never,
      trophyHistory: [
        {
          competitionId: undefined as never,
          competition: 'FA Cup',
          season: 1,
          teamId: firstTeam.id,
          teamName: firstTeam.name,
        },
      ],
      seasonResults: [
        {
          season: 1,
          teamId: firstTeam.id,
          teamName: firstTeam.name,
          competitions: {
            league: '1st (Premier League)',
            carabaoCup: 'Winners',
            faCup: 'Eliminated',
            ucl: 'Not active yet',
          },
        } as never,
      ],
    },
    useGameStore.getState()
  );

  assert(repaired.teams?.[firstTeam.id]?.leagueId === LEAGUE_IDS.PREMIER_LEAGUE, 'Legacy division names should map to canonical league ids');
  assert(repaired.fixtures?.[firstFixture.id]?.competitionId === COMPETITION_IDS.LEAGUE, 'Legacy competition names should map to canonical competition ids');
  assert(repaired.cups?.[COMPETITION_IDS.FA_CUP]?.competitionId === COMPETITION_IDS.FA_CUP, 'Legacy cup keys should map to canonical competition ids');
  assert(repaired.trophyCabinet?.[COMPETITION_IDS.FA_CUP] === 2, 'Legacy trophy cabinet keys should map to canonical ids');
  assert(repaired.trophyHistory?.[0]?.competitionId === COMPETITION_IDS.FA_CUP, 'Legacy trophy history should map to canonical ids');
  assert(repaired.seasonResults?.[0]?.leagueId === LEAGUE_IDS.PREMIER_LEAGUE, 'Legacy season results should map league labels to canonical ids');
};

const checkCanonicalWorldGuards = () => {
  const approvedLegacyReadFiles = new Set([
    'src/core/domainRegistry.ts',
    'src/store/setup/hydrationRepair.ts',
  ]);
  const approvedLiteralFiles = new Set([
    'src/core/domainRegistry.ts',
  ]);
  const legacyReadPattern = /\.(division|competition)\b/;
  const literalPattern = /['"](Premier League|Championship|League One|League Two|League|FA Cup|Carabao Cup|UEFA Champions League)['"]/;
  const sourceFiles = [...collectSourceFiles('src'), ...collectSourceFiles('app')];

  sourceFiles.forEach(filePath => {
    const source = readSource(filePath);
    if (!approvedLegacyReadFiles.has(filePath) && legacyReadPattern.test(source)) {
      throw new Error(`Legacy field read found outside compatibility boundary: ${filePath}`);
    }
    if (!approvedLiteralFiles.has(filePath) && literalPattern.test(source)) {
      throw new Error(`Hardcoded competition or league label found outside registry config: ${filePath}`);
    }
  });
};

const checkStaleFormationMapRecoveryModel = () => {
  const data = initGameData();
  const team = Object.values(data.teams)[0];
  const starters = Object.values(data.players).filter(player => player.teamId === team.id && player.isStarting);
  const slots = getSlotsForFormation('4-3-3');
  const staleMap: Record<string, string> = {
    '0-0': starters[0]?.id,
    '0-1': 'missing-player-id',
  };
  const mappedStarterIds = new Set<string>();
  const rendered = slots.map(row => row.map(() => null as string | null));

  slots.forEach((row, rowIndex) => {
    row.forEach((_, colIndex) => {
      const playerId = staleMap[`${rowIndex}-${colIndex}`];
      const mappedStarter = playerId ? starters.find(player => player.id === playerId) : null;
      if (mappedStarter) {
        rendered[rowIndex][colIndex] = mappedStarter.id;
        mappedStarterIds.add(mappedStarter.id);
      }
    });
  });

  const missingStarters = starters.filter(player => !mappedStarterIds.has(player.id));
  rendered.forEach(row => {
    row.forEach((playerId, colIndex) => {
      if (!playerId && missingStarters.length > 0) row[colIndex] = missingStarters.shift()?.id || null;
    });
  });

  const renderedIds = new Set(rendered.flat().filter(Boolean));
  assert(renderedIds.size === Math.min(starters.length, slots.flat().length), 'Stale formation maps should not hide starters');
};

const checkFormationMapRejectsWrongPositions = () => {
  const data = initGameData('Arsenal');
  const team = Object.values(data.teams).find(item => item.name === 'Arsenal');
  assert(team, 'Regression setup needs Arsenal');

  const squad = Object.values(data.players).filter(player => player.teamId === team!.id);
  const keeper = squad.find(player => player.position === 'GK');
  const striker = squad.find(player => player.subPosition === 'ST' || player.position === 'FWD');
  const midfielder = squad.find(player => player.position === 'MID');

  assert(keeper && striker && midfielder, 'Regression setup needs keeper, striker, and midfielder');

  const starters = squad.map(player => ({
    ...player,
    isStarting: [keeper!.id, striker!.id, midfielder!.id].includes(player.id) || player.overallRating >= 80,
  })).filter(player => player.isStarting).slice(0, 11);

  const slots = getSlotsForFormation('4-3-3');
  const corruptedMap = {
    '0-0': keeper!.id,
    '0-2': midfielder!.id,
    '3-0': striker!.id,
  };

  const rebuiltSlots = rebuildFormationSlotPlayers(slots, starters, corruptedMap);
  const rebuiltMap = rebuildFormationMap(slots, starters, corruptedMap);

  assert(rebuiltSlots[3][0]?.position === 'GK', 'Corrupted formation map should put a keeper back in GK');
  assert(rebuiltSlots[0].every(player => player?.position !== 'GK'), 'Corrupted formation map should not leave a keeper in the forward line');
  assert(rebuiltMap['3-0'] === rebuiltSlots[3][0]?.id, 'Rebuilt map should persist the corrected GK slot');
};

const checkSeededFormationDiversity = () => {
    const originalRandom = Math.random;
    Math.random = createSeededRandom(20260513);
    const formationUsage = { back3: 0, back4: 0, back5: 0 };

  try {
    for (let season = 1; season <= 5; season++) {
      const data = initGameData();
      let state = {
        players: data.players,
        teams: data.teams,
        fixtures: data.fixtures,
        currentWeek: 1,
        news: [] as string[],
      };
      const seasonWeeks = getSeasonWeekLimit(state.fixtures);

      for (let week = 1; week <= seasonWeeks; week++) {
        const weekFixtures = Object.values(state.fixtures).filter(fixture => fixture.week === week);
        weekFixtures.forEach(fixture => {
          const result = quickSimMatch(fixture.id, state.players, state.teams, state.fixtures);
          state.players = result.players;
          state.teams = result.teams;
          state.fixtures[fixture.id] = result.fixture;
        });

        const progression = computeWeeklyProgression(state.currentWeek, state.players, state.teams, state.fixtures, state.news);
        state.players = progression.players;
        state.teams = progression.teams;
        state.currentWeek = progression.currentWeek;
        state.news = progression.news;

        const transfers = computeWeeklyTransfers(state.players, state.teams, null);
        state.players = transfers.players;
        state.teams = transfers.teams;

        Object.values(state.teams).forEach(team => {
          if (team.activeFormation.startsWith('3')) formationUsage.back3++;
          else if (team.activeFormation.startsWith('5')) formationUsage.back5++;
          else formationUsage.back4++;
        });
      }
    }
  } finally {
    Math.random = originalRandom;
  }

  assert(formationUsage.back3 > 0, `Seeded formation run produced no back-3 usage: ${JSON.stringify(formationUsage)}`);
  assert(formationUsage.back5 > 0, `Seeded formation run produced no back-5 usage: ${JSON.stringify(formationUsage)}`);
  console.log(`Formation usage: ${JSON.stringify(formationUsage)}`);
};

const runRegressionChecks = () => {
  console.log('--- ENGINE REGRESSION CHECKS ---');
  checkCleanSheetWindows();
  console.log('[OK] Clean-sheet window checks passed');
  checkLiveSentOffMinutes();
  console.log('[OK] Live sent-off minute check passed');
  checkCupCompetitionIntegration();
  console.log('[OK] Cup competition integration passed');
  checkBranchGuards();
  console.log('[OK] Second-yellow and shape parity guards passed');
  checkUserTeamProgressionDoesNotAdaptFormation();
  console.log('[OK] User team tactical adaptation guard passed');
  checkManagerProfilesLoaded();
  console.log('[OK] Manager profile loading passed');
  checkDivisionBootstrap();
  console.log('[OK] Division bootstrap check passed');
  checkPromotionRelegation();
  console.log('[OK] Promotion and relegation checks passed');
  checkRegistryBackedDefinitions();
  console.log('[OK] Registry-backed league and competition definitions passed');
  checkTacticAndTraitModuleRegistration();
  console.log('[OK] Tactical and trait effect registration passed');
  checkLegacyHydrationMapping();
  console.log('[OK] Legacy hydration mapping passed');
  checkCanonicalWorldGuards();
  console.log('[OK] Canonical world guardrails passed');
  checkStaleFormationMapRecoveryModel();
  console.log('[OK] Stale formation-map recovery model passed');
  checkFormationMapRejectsWrongPositions();
  console.log('[OK] Wrong-position formation-map recovery passed');
  checkSeededFormationDiversity();
  console.log('[OK] Seeded formation diversity check passed');
  console.log('--- REGRESSION CHECKS COMPLETE ---');
};

runRegressionChecks();

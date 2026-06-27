import { FREE_AGENT_TEAM_ID, assert, buildTestPlayer, getSlotsForFormation, initGameData, readSource, sanitizePersistedState } from './shared';

export const checkFreezeRecoveryControlsAreVisible = () => {
  const gameStore = readSource('src/store/gameStore.ts');
  const weekLifecycle = readSource('src/store/weekLifecycle.ts');
  const devTools = readSource('components/settings/dev-tools-card.tsx');
  const settings = readSource('app/(tabs)/settings.tsx');

  assert(
    /catch \(error\)[\s\S]*console\.warn/.test(weekLifecycle),
    'skipToEndOfSeason should warn when week advancement fails'
  );
  assert(
    /clearStuckLiveMatches/.test(gameStore) &&
      /Clear Stuck Live Match/.test(devTools) &&
      /clearStuckLiveMatches/.test(settings),
    'Dev tools should expose a stuck live-match recovery action'
  );
};

export const checkStaleFormationMapRecoveryModel = () => {
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

export const checkFreeAgentSaveReloadEquivalence = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for free-agent persistence regression');

  const freeAgent = buildTestPlayer(templatePlayer, 'persisted-free-agent', FREE_AGENT_TEAM_ID, 'MID', 64, {
    isStarting: false,
    isSub: false,
    isTransferListed: false,
  });
  const brokenReference = buildTestPlayer(templatePlayer, 'broken-reference-player', 'missing-club', 'DEF', 62, {
    isStarting: true,
    isSub: true,
    isTransferListed: true,
    askingPrice: 3,
  });
  const state = {
    currentWeek: 4,
    userTeamId: templateTeam.id,
    teams: { [templateTeam.id]: templateTeam },
    players: {
      [freeAgent.id]: freeAgent,
      [brokenReference.id]: brokenReference,
    },
    fixtures: {},
    competitions: {},
    news: [],
    inboxMessages: [],
    boardObjectives: [],
    boardReviewAppliedWeek: 0,
  };

  const summarize = (value: ReturnType<typeof sanitizePersistedState>) => JSON.stringify({
    hasFreeAgentTeam: Boolean(value.teams?.[FREE_AGENT_TEAM_ID]),
    freeAgent: value.players?.[freeAgent.id],
    brokenReference: value.players?.[brokenReference.id],
  });
  const sanitizedOnce = sanitizePersistedState(state);
  const sanitizedTwice = sanitizePersistedState(JSON.parse(JSON.stringify(sanitizedOnce)));

  assert(sanitizedOnce.teams?.[FREE_AGENT_TEAM_ID], 'Sanitizing a save with free agents should create the durable free-agent team');
  assert(
    sanitizedOnce.players?.[freeAgent.id]?.teamId === FREE_AGENT_TEAM_ID,
    'Existing free-agent players should remain in the shared free-agent pool after load'
  );
  assert(
    sanitizedOnce.players?.[brokenReference.id]?.teamId === FREE_AGENT_TEAM_ID,
    'Players with missing teams should be reassigned to the shared free-agent pool'
  );
  assert(
    sanitizedOnce.players?.[brokenReference.id]?.isStarting === false &&
      sanitizedOnce.players?.[brokenReference.id]?.isSub === false &&
      sanitizedOnce.players?.[brokenReference.id]?.isTransferListed === false,
    'Players repaired into the free-agent pool should not retain club selection or listing flags'
  );
  assert(summarize(sanitizedOnce) === summarize(sanitizedTwice), 'Free-agent save sanitation should be stable across reloads');
};

export const checkValidationCatchesPastUnplayedFixturesAndNonFiniteFinances = () => {
  const validator = readSource('src/dev/agentGameHandler.ts');
  assert(
    /fixture\.week < current\.currentWeek[\s\S]*!fixture\.isPlayed/.test(validator),
    'Agent validation should catch unplayed fixtures left in past weeks'
  );
  assert(
    /Number\.isFinite\(team\.budget\)/.test(validator) && /Number\.isFinite\(team\.transferSpend\)/.test(validator),
    'Agent validation should catch non-finite team finance values'
  );
};

import { FREE_AGENT_TEAM_ID, assert, buildTestPlayer, initGameData, sanitizePersistedState } from './shared';

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

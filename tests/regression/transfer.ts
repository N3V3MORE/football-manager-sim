import { FREE_AGENT_TEAM_ID, Player, Team, acceptTransferCounterState, addSquadPlayers, advanceSeason, approachPlayerState, assert, buildTestPlayer, buildTestTeam, buyPlayerState, computeWeeklyTransfers, createFreeAgentTeam, createSeededRandom, getSquadPolicy, initGameData, readSource, resolveWeeklyNegotiationsState, signFreeAgentState } from './shared';

export const checkManualTransfersRespectWindow = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  const sellerTeam = Object.values(data.teams)
    .find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  assert(userTeam && sellerTeam, 'Expected user and seller teams for manual transfer window regression');

  const target = Object.values(data.players).find(player => player.teamId === sellerTeam!.id && !player.isStarting);
  assert(target, 'Expected a seller player for manual transfer window regression');

  const askingPrice = Math.max(1, Math.min(5, target!.marketValue || 1));
  const players = {
    ...data.players,
    [target!.id]: {
      ...target!,
      isTransferListed: true,
      askingPrice,
    },
  };
  const teams: Record<string, Team> = {
    ...data.teams,
    [userTeam!.id]: {
      ...userTeam!,
      budget: 100,
      transferSpend: 0,
    },
  };

  const result = buyPlayerState(
    {
      currentWeek: 10,
      players,
      teams,
      userTeamId: userTeam!.id,
    },
    target!.id,
    askingPrice,
    target!.wage
  );
  const resultingPlayers = result.patch.players || players;

  assert(!result.result.success, 'Manual transfer purchase should fail outside the transfer window');
  assert(
    resultingPlayers[target!.id].teamId === sellerTeam!.id,
    'Rejected manual transfer should leave the player at the selling club'
  );
};

export const checkManualTransfersRejectNonFiniteMoney = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  const sellerTeam = Object.values(data.teams)
    .find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  assert(userTeam && sellerTeam, 'Expected teams for non-finite transfer regression');
  const target = Object.values(data.players).find(player => player.teamId === sellerTeam!.id && !player.isStarting);
  assert(target, 'Expected target player for non-finite transfer regression');

  const players = {
    ...data.players,
    [target!.id]: {
      ...target!,
      isTransferListed: true,
      askingPrice: 5,
    },
  };
  const teams = {
    ...data.teams,
    [userTeam!.id]: {
      ...userTeam!,
      budget: 100,
      transferSpend: 0,
    },
  };
  const result = buyPlayerState(
    {
      currentWeek: 2,
      players,
      teams,
      userTeamId: userTeam!.id,
    },
    target!.id,
    Number.NaN,
    target!.wage
  );
  const nextTeams = result.patch.teams || teams;

  assert(!result.result.success, 'Manual transfer purchase should reject NaN fees');
  assert(nextTeams[userTeam!.id].budget === 100, 'Rejected NaN transfer should not corrupt buyer budget');
};

export const checkApproachUnlistedBackupCreatesPendingNegotiation = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const sellerTeam = Object.values(data.teams).find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  const target = Object.values(data.players).find(player => (
    player.teamId === sellerTeam?.id &&
    !player.isStarting &&
    !player.isTransferListed &&
    player.contractLeft <= 2
  ));
  assert(userTeam && sellerTeam && target, 'Expected an unlisted backup target for negotiation approach regression');

  const teams = {
    ...data.teams,
    [userTeam!.id]: { ...userTeam!, budget: 100, transferSpend: 0 },
  };
  const result = approachPlayerState(
    { currentWeek: 2, players: data.players, teams, userTeamId: userTeam!.id, pendingNegotiations: [], inboxMessages: [] },
    target!.id
  );
  const negotiations = result.patch.pendingNegotiations || [];

  assert(result.result.success, `Approaching an available unlisted backup should open talks: ${result.result.message}`);
  assert(negotiations.length === 1, 'Approach should create one pending negotiation');
  assert(negotiations[0].playerId === target!.id, 'Negotiation should track the approached player');
  assert(negotiations[0].sellerTeamId === sellerTeam!.id, 'Negotiation should track the seller');
  assert(negotiations[0].askingPrice >= target!.marketValue, 'Seller asking price should be at least market value');
  assert(data.players[target!.id].teamId === sellerTeam!.id, 'Approach should not move the player immediately');
};

export const checkApproachCoreNeededPlayerRejectsWithoutNegotiation = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const sellerTeam = Object.values(data.teams).find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  const coreTarget = Object.values(data.players)
    .filter(player => player.teamId === sellerTeam?.id && player.isStarting)
    .sort((a, b) => b.overallRating - a.overallRating)[0];
  assert(userTeam && sellerTeam && coreTarget, 'Expected a core starter target for negotiation rejection regression');

  const players = {
    ...data.players,
    [coreTarget.id]: {
      ...coreTarget,
      contractLeft: 4,
      morale: 85,
      marketValue: Math.max(coreTarget.marketValue, 20),
    },
  };
  const result = approachPlayerState(
    { currentWeek: 2, players, teams: data.teams, userTeamId: userTeam!.id, pendingNegotiations: [], inboxMessages: [] },
    coreTarget.id
  );

  assert(!result.result.success, 'Approach for a core needed player should be rejected outright');
  assert((result.patch.pendingNegotiations || []).length === 0, 'Rejected approach should not create a negotiation');
};

export const checkListedUnderAskCreatesCounterNegotiationWithoutMove = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const sellerTeam = Object.values(data.teams).find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  const target = Object.values(data.players).find(player => player.teamId === sellerTeam?.id && !player.isStarting);
  assert(userTeam && sellerTeam && target, 'Expected a listed target for counter-offer regression');

  const players = {
    ...data.players,
    [target!.id]: {
      ...target!,
      isTransferListed: true,
      askingPrice: 10,
      marketValue: 10,
    },
  };
  const teams = {
    ...data.teams,
    [userTeam!.id]: { ...userTeam!, budget: 100, transferSpend: 0 },
  };
  const result = buyPlayerState(
    { currentWeek: 2, players, teams, userTeamId: userTeam!.id, pendingNegotiations: [], inboxMessages: [] },
    target!.id,
    9,
    target!.wage,
    { next: () => 0.99 }
  );
  const negotiations = result.patch.pendingNegotiations || [];

  assert(result.result.success, `Near asking-price bid should create a counter negotiation: ${result.result.message}`);
  assert(negotiations.length === 1, 'Under-ask bid should create one negotiation');
  assert(negotiations[0].status === 'countered', 'Under-ask listed bid should be countered at the seller asking price');
  assert(negotiations[0].currentBid === 9, 'Negotiation should preserve the user bid');
  assert(negotiations[0].askingPrice === 10, 'Counter should ask for the listed asking price');
  assert((result.patch.players || players)[target!.id].teamId === sellerTeam!.id, 'Countered bid should not move the player');
};

export const checkAcceptCounterMovesPlayerAndMarksNegotiationAccepted = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const sellerTeam = Object.values(data.teams).find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  const target = Object.values(data.players).find(player => player.teamId === sellerTeam?.id && !player.isStarting);
  assert(userTeam && sellerTeam && target, 'Expected a target for accept-counter regression');

  const negotiation = {
    id: 'neg-accept-counter',
    playerId: target!.id,
    buyerTeamId: userTeam!.id,
    sellerTeamId: sellerTeam!.id,
    currentBid: 9,
    currentWage: target!.wage,
    askingPrice: 10,
    round: 1,
    status: 'countered' as const,
    createdWeek: 2,
    expiresWeek: 4,
    source: 'listed_offer' as const,
  };
  const teams = {
    ...data.teams,
    [userTeam!.id]: { ...userTeam!, budget: 100, transferSpend: 0 },
  };
  const result = acceptTransferCounterState(
    { currentWeek: 2, players: data.players, teams, userTeamId: userTeam!.id, pendingNegotiations: [negotiation], inboxMessages: [] },
    negotiation.id
  );
  const nextPlayers = result.patch.players || data.players;
  const nextTeams = result.patch.teams || teams;
  const nextNegotiation = (result.patch.pendingNegotiations || [])[0];

  assert(result.result.success, `Accepting a counter should succeed: ${result.result.message}`);
  assert(nextPlayers[target!.id].teamId === userTeam!.id, 'Accepted counter should move player to buyer');
  assert(nextTeams[userTeam!.id].budget === 90, 'Accepted counter should charge the seller asking price');
  assert(nextNegotiation.status === 'accepted', 'Accepted counter should mark the negotiation accepted');
};

export const checkWeeklyNegotiationsExpireAfterDeadline = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const sellerTeam = Object.values(data.teams).find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  const target = Object.values(data.players).find(player => player.teamId === sellerTeam?.id && !player.isStarting);
  assert(userTeam && sellerTeam && target, 'Expected a target for negotiation expiry regression');
  const negotiation = {
    id: 'neg-expiry',
    playerId: target!.id,
    buyerTeamId: userTeam!.id,
    sellerTeamId: sellerTeam!.id,
    currentBid: 8,
    currentWage: target!.wage,
    askingPrice: 10,
    round: 1,
    status: 'countered' as const,
    createdWeek: 2,
    expiresWeek: 3,
    source: 'listed_offer' as const,
  };

  const result = resolveWeeklyNegotiationsState(
    { currentWeek: 3, players: data.players, teams: data.teams, userTeamId: userTeam!.id, pendingNegotiations: [negotiation], inboxMessages: [] }
  );
  const nextNegotiation = (result.pendingNegotiations || [])[0];

  assert(nextNegotiation.status === 'expired', 'Negotiation should expire on its deadline week');
  assert(result.players[target!.id].teamId === sellerTeam!.id, 'Expired negotiation should leave player at seller');
};

export const checkRivalBidWinsWhenUserDoesNotMatch = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const sellerTeam = Object.values(data.teams).find(team => team.id !== userTeam?.id && team.division === userTeam?.division);
  const rivalTeam = Object.values(data.teams).find(team => team.id !== userTeam?.id && team.id !== sellerTeam?.id && team.division === userTeam?.division);
  const target = Object.values(data.players).find(player => player.teamId === sellerTeam?.id && !player.isStarting);
  assert(userTeam && sellerTeam && rivalTeam && target, 'Expected user, seller, rival, and target for rival bid regression');
  const negotiation = {
    id: 'neg-rival',
    playerId: target!.id,
    buyerTeamId: userTeam!.id,
    sellerTeamId: sellerTeam!.id,
    currentBid: 8,
    currentWage: target!.wage,
    askingPrice: 10,
    round: 1,
    status: 'countered' as const,
    createdWeek: 2,
    expiresWeek: 4,
    source: 'listed_offer' as const,
    rivalBid: {
      teamId: rivalTeam!.id,
      bid: 10,
      expiresWeek: 3,
      status: 'active' as const,
    },
  };

  const result = resolveWeeklyNegotiationsState(
    { currentWeek: 3, players: data.players, teams: data.teams, userTeamId: userTeam!.id, pendingNegotiations: [negotiation], inboxMessages: [] }
  );
  const nextNegotiation = (result.pendingNegotiations || [])[0];

  assert(result.players[target!.id].teamId === rivalTeam!.id, 'Unmatched rival bid should move player to rival club');
  assert(nextNegotiation.status === 'rejected', 'User negotiation should be rejected after losing to a rival bid');
  assert(nextNegotiation.rivalBid?.status === 'won', 'Rival bid should be marked won');
};

export const checkActiveNegotiationsCanBeWithdrawnInUi = () => {
  const transfersSource = readSource('app/(tabs)/transfers.tsx');
  const cardSource = readSource('components/transfers/transfer-player-card.tsx');

  assert(/withdrawTransferNegotiation/.test(transfersSource), 'Transfer screen should expose the withdrawal action for active talks');
  assert(/secondaryActionLabel="Withdraw"/.test(transfersSource), 'Pending talks should render a visible withdraw button');
  assert(/onSecondaryAction/.test(cardSource), 'Transfer player card should support a secondary action');
};

export const checkManualFreeAgentSigningMovesPlayerDuringWindow = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const templatePlayer = Object.values(data.players)[0];
  assert(userTeam && templatePlayer, 'Expected user team and player template for free-agent signing regression');
  const freeAgent = buildTestPlayer(templatePlayer!, 'manual-free-agent', FREE_AGENT_TEAM_ID, 'MID', 72, {
    wage: 20,
    contractLeft: 0,
    isStarting: false,
    isSub: false,
  });
  const players = { ...data.players, [freeAgent.id]: freeAgent };
  const teams = { ...data.teams, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() };

  const result = signFreeAgentState(
    { currentWeek: 2, players, teams, userTeamId: userTeam!.id },
    freeAgent.id,
    22
  );
  const nextPlayers = result.patch.players || players;
  const nextTeams: Record<string, Team> = result.patch.teams || teams;

  assert(result.result.success, `Free-agent signing should succeed in transfer window: ${result.result.message}`);
  assert(nextPlayers[freeAgent.id].teamId === userTeam!.id, 'Signed free agent should move to the user team');
  assert(nextPlayers[freeAgent.id].wage === 22, 'Signed free agent should receive the offered wage');
  assert(nextPlayers[freeAgent.id].contractLeft >= 1, 'Signed free agent should receive a new contract');
  assert(nextTeams[userTeam!.id].budget === userTeam!.budget, 'Free-agent signing should not spend transfer budget');
};

export const checkManualFreeAgentSigningWorksOutsideWindow = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const templatePlayer = Object.values(data.players)[0];
  assert(userTeam && templatePlayer, 'Expected user team and player template for closed-window free-agent regression');
  const freeAgent = buildTestPlayer(templatePlayer!, 'closed-window-free-agent', FREE_AGENT_TEAM_ID, 'DEF', 68, {
    wage: 15,
    contractLeft: 0,
  });
  const players = { ...data.players, [freeAgent.id]: freeAgent };
  const teams = { ...data.teams, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() };
  const result = signFreeAgentState(
    { currentWeek: 10, players, teams, userTeamId: userTeam!.id },
    freeAgent.id,
    20
  );

  assert(result.result.success, 'Free-agent signing should be allowed outside the transfer window');
  assert((result.patch.players || players)[freeAgent.id].teamId === userTeam!.id, 'Outside-window free-agent signing should move the player');
};

export const checkManualFreeAgentSigningRejectsFullSquad = () => {
  const data = initGameData('Arsenal');
  const userTeam = Object.values(data.teams).find(team => team.name === 'Arsenal');
  const templatePlayer = Object.values(data.players)[0];
  assert(userTeam && templatePlayer, 'Expected templates for full-squad free-agent regression');
  const players: Record<string, Player> = Object.fromEntries(
    Object.entries(data.players).filter(([, player]) => player.teamId !== userTeam!.id)
  ) as Record<string, Player>;
  addSquadPlayers(players, templatePlayer!, userTeam!.id, 'full-squad-user', { GK: 3, DEF: 10, MID: 10, FWD: 5 }, {
    rating: 70,
  });
  const freeAgent = buildTestPlayer(templatePlayer!, 'full-squad-free-agent', FREE_AGENT_TEAM_ID, 'FWD', 73, {
    wage: 20,
    contractLeft: 0,
  });
  players[freeAgent.id] = freeAgent;
  const teams = { ...data.teams, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() };
  const result = signFreeAgentState(
    { currentWeek: 2, players, teams, userTeamId: userTeam!.id },
    freeAgent.id,
    25
  );

  assert(!result.result.success, 'Free-agent signing should reject a full user squad');
  assert((result.patch.players || players)[freeAgent.id].teamId === FREE_AGENT_TEAM_ID, 'Rejected full-squad signing should leave player free');
};

export const checkAiTransferListingsExpireOutsideWindow = () => {
  const data = initGameData();
  const listedPlayer = Object.values(data.players).find(player => !player.isStarting);
  assert(listedPlayer, 'Expected a player for transfer listing expiry regression');

  const players = {
    ...data.players,
    [listedPlayer!.id]: {
      ...listedPlayer!,
      isTransferListed: true,
      askingPrice: Math.max(1, listedPlayer!.marketValue || 1),
    },
  };

  const result = computeWeeklyTransfers(players, data.teams, null, undefined, 5);
  assert(
    !result.players[listedPlayer!.id].isTransferListed,
    'AI transfer listings should expire when the transfer window closes'
  );
  assert(
    result.players[listedPlayer!.id].askingPrice === 0,
    'Expired AI transfer listings should clear the asking price'
  );
};

export const checkAiBuyerAtMaximumSquadSizeCannotBuy = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for AI transfer capacity regression');

  const buyer = buildTestTeam(templateTeam, 'capacity-buyer', 'Capacity Buyer', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
    manager: { transferIdentity: 'balanced' },
  });
  const seller = buildTestTeam(templateTeam, 'capacity-seller', 'Capacity Seller', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
  });
  const players: Record<string, Player> = {};
  addSquadPlayers(players, templatePlayer, buyer.id, 'capacity-buyer', { GK: 2, DEF: 10, MID: 13, FWD: 3 }, {
    rating: 70,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  });
  addSquadPlayers(players, templatePlayer, seller.id, 'capacity-seller', { GK: 2, DEF: 7, MID: 8, FWD: 5 }, {
    rating: 82,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  });
  const target = buildTestPlayer(templatePlayer, 'capacity-target', seller.id, 'FWD', 78, {
    isTransferListed: true,
    askingPrice: 5,
    marketValue: 5,
    wage: 20,
  });
  players[target.id] = target;

  const result = computeWeeklyTransfers(players, { [buyer.id]: buyer, [seller.id]: seller }, null, { next: () => 0 }, 2);
  assert(result.players[target.id].teamId === seller.id, 'AI buyer already at 28 players should not buy another player');
  assert(
    !result.decisions.some(decision => decision.action === 'bought' && decision.teamId === buyer.id && decision.playerId === target.id),
    'AI transfer decisions should not record a purchase blocked by maximum squad size'
  );
};

export const checkAiSignsFreeAgentForUrgentSquadNeed = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for AI free-agent signing regression');
  const buyer = buildTestTeam(templateTeam, 'ai-free-agent-buyer', 'AI Free Agent Buyer', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
    budget: 1,
    operatingBudget: 100,
  });
  const players: Record<string, Player> = {};
  addSquadPlayers(players, templatePlayer, buyer.id, 'ai-fa-buyer', { GK: 2, DEF: 8, MID: 8, FWD: 0 }, {
    rating: 68,
    starterCounts: { GK: 1, DEF: 4, MID: 4, FWD: 0 },
  });
  const freeAgent = buildTestPlayer(templatePlayer, 'ai-free-agent-forward', FREE_AGENT_TEAM_ID, 'FWD', 76, {
    wage: 20,
    contractLeft: 0,
    marketValue: 9,
  });
  players[freeAgent.id] = freeAgent;
  const result = computeWeeklyTransfers(
    players,
    { [buyer.id]: buyer, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() },
    null,
    { next: () => 0 },
    2
  );

  assert(result.players[freeAgent.id].teamId === buyer.id, 'AI club with urgent need should sign a matching free agent');
  assert(
    result.decisions.some(decision => decision.action === 'bought' && decision.fromTeamId === FREE_AGENT_TEAM_ID && decision.playerId === freeAgent.id),
    'AI free-agent signing should be recorded as a transfer decision from the free-agent pool'
  );
  assert(result.teams[buyer.id].budget === buyer.budget, 'AI free-agent signing should not spend transfer budget');
};

export const checkAiStaleListedTargetIsRevalidated = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for stale listing regression');

  const buyerOne = buildTestTeam(templateTeam, 'stale-buyer-one', 'Stale Buyer One', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
  });
  const buyerTwo = buildTestTeam(templateTeam, 'stale-buyer-two', 'Stale Buyer Two', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
  });
  const seller = buildTestTeam(templateTeam, 'stale-seller', 'Stale Seller', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
  });
  const players: Record<string, Player> = {};
  [buyerOne, buyerTwo].forEach((buyer, index) => {
    addSquadPlayers(players, templatePlayer, buyer.id, `stale-buyer-${index}`, { GK: 2, DEF: 8, MID: 8, FWD: 3 }, {
      rating: 70,
      starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 3 },
    });
  });
  addSquadPlayers(players, templatePlayer, seller.id, 'stale-seller', { GK: 2, DEF: 7, MID: 8, FWD: 5 }, {
    rating: 82,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 5 },
  });
  const target = buildTestPlayer(templatePlayer, 'stale-target', seller.id, 'FWD', 78, {
    isTransferListed: true,
    askingPrice: 5,
    marketValue: 5,
    wage: 20,
  });
  players[target.id] = target;

  const result = computeWeeklyTransfers(
    players,
    { [buyerOne.id]: buyerOne, [buyerTwo.id]: buyerTwo, [seller.id]: seller },
    null,
    { next: () => 0 },
    2
  );
  const targetPurchases = result.decisions.filter(decision => decision.action === 'bought' && decision.playerId === target.id);
  assert(targetPurchases.length === 1, `Listed target should only be bought once after stale revalidation, got ${targetPurchases.length}`);
  assert(result.players[target.id].teamId === buyerOne.id, 'The first buyer should complete the only valid purchase');
};

export const checkEliteAiRejectsUnderStandardTarget = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for elite quality regression');

  const buyer = buildTestTeam(templateTeam, 'elite-buyer', 'Elite Buyer', {
    boardProfile: { ambition: 'elite', transferDiscipline: 'balanced' },
    manager: { transferIdentity: 'premium star recruitment' },
  });
  const seller = buildTestTeam(templateTeam, 'elite-seller', 'Elite Seller', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
  });
  const players: Record<string, Player> = {};
  addSquadPlayers(players, templatePlayer, buyer.id, 'elite-buyer', { GK: 2, DEF: 8, MID: 8, FWD: 3 }, {
    rating: 78,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  });
  addSquadPlayers(players, templatePlayer, seller.id, 'elite-seller', { GK: 2, DEF: 7, MID: 8, FWD: 5 }, {
    rating: 82,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 5 },
  });
  const target = buildTestPlayer(templatePlayer, 'elite-target', seller.id, 'FWD', 72, {
    isTransferListed: true,
    askingPrice: 5,
    marketValue: 5,
    wage: 20,
  });
  players[target.id] = target;

  const result = computeWeeklyTransfers(players, { [buyer.id]: buyer, [seller.id]: seller }, null, { next: () => 0 }, 2);
  assert(result.players[target.id].teamId === seller.id, 'Elite AI club should reject a target below the ambition quality floor');
};

export const checkExperiencedAiPrefersOlderEqualTarget = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for experienced identity regression');

  const buyer = buildTestTeam(templateTeam, 'experienced-buyer', 'Experienced Buyer', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
    manager: { transferIdentity: 'experienced veteran recruitment' },
  });
  const seller = buildTestTeam(templateTeam, 'experienced-seller', 'Experienced Seller', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
  });
  const players: Record<string, Player> = {};
  addSquadPlayers(players, templatePlayer, buyer.id, 'experienced-buyer', { GK: 2, DEF: 8, MID: 8, FWD: 3 }, {
    rating: 70,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  });
  addSquadPlayers(players, templatePlayer, seller.id, 'experienced-seller', { GK: 2, DEF: 7, MID: 8, FWD: 5 }, {
    rating: 82,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 5 },
  });
  const youngerTarget = buildTestPlayer(templatePlayer, 'experienced-young-target', seller.id, 'FWD', 76, {
    age: 22,
    isTransferListed: true,
    askingPrice: 5,
    marketValue: 5,
    wage: 20,
  });
  const olderTarget = buildTestPlayer(templatePlayer, 'experienced-old-target', seller.id, 'FWD', 76, {
    age: 31,
    isTransferListed: true,
    askingPrice: 5,
    marketValue: 5,
    wage: 20,
  });
  players[youngerTarget.id] = youngerTarget;
  players[olderTarget.id] = olderTarget;

  const result = computeWeeklyTransfers(players, { [buyer.id]: buyer, [seller.id]: seller }, null, { next: () => 0 }, 2);
  assert(result.players[olderTarget.id].teamId === buyer.id, 'Experienced AI identity should prefer the older equal-value target');
  assert(result.players[youngerTarget.id].teamId === seller.id, 'Experienced AI identity should leave the younger equal-value target behind');
};

export const checkAiTransferRespectsOperatingWageAffordability = () => {
  const data = initGameData('Arsenal');
  const templateTeam = Object.values(data.teams)[0];
  const templatePlayer = Object.values(data.players)[0];
  assert(templateTeam && templatePlayer, 'Expected templates for AI wage affordability regression');

  const buyer = buildTestTeam(templateTeam, 'wage-buyer', 'Wage Buyer', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
    budget: 100,
    operatingBudget: 0.1,
  });
  const seller = buildTestTeam(templateTeam, 'wage-seller', 'Wage Seller', {
    boardProfile: { ambition: 'stability', transferDiscipline: 'balanced' },
  });
  const players: Record<string, Player> = {};
  addSquadPlayers(players, templatePlayer, buyer.id, 'wage-buyer', { GK: 2, DEF: 8, MID: 8, FWD: 3 }, {
    rating: 70,
    wage: 20,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  });
  addSquadPlayers(players, templatePlayer, seller.id, 'wage-seller', { GK: 2, DEF: 7, MID: 8, FWD: 5 }, {
    rating: 82,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 5 },
  });
  const target = buildTestPlayer(templatePlayer, 'wage-target', seller.id, 'FWD', 78, {
    isTransferListed: true,
    askingPrice: 5,
    marketValue: 5,
    wage: 250,
  });
  players[target.id] = target;

  const result = computeWeeklyTransfers(players, { [buyer.id]: buyer, [seller.id]: seller }, null, { next: () => 0 }, 2);
  assert(result.players[target.id].teamId === seller.id, 'AI buyer should not buy a player whose wage exceeds operating affordability');
  assert(result.teams[buyer.id].budget === buyer.budget, 'Rejected wage-affordability transfer should not spend transfer budget');
};

export const checkContractDeparturesPreferViableDestinations = () => {
  const data = initGameData();
  const userTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  assert(userTeam, 'Expected a user team for contract destination regression');
  const departurePlayer = Object.values(data.players).find(player => player.teamId === userTeam!.id);
  assert(departurePlayer, 'Expected a departing player for contract destination regression');

  const sameDivisionTeams = Object.values(data.teams)
    .filter(team => team.id !== userTeam!.id && team.division === userTeam!.division);
  assert(sameDivisionTeams.length >= 2, 'Expected same-division destination teams for contract destination regression');

  const players = {
    ...data.players,
    [departurePlayer!.id]: {
      ...departurePlayer!,
      contractLeft: 0,
      overallRating: 82,
      marketValue: 35,
    },
  };

  const nextSeason = advanceSeason(players, data.teams, data.competitions, userTeam!.id, []);
  const destTeamId = nextSeason.players[departurePlayer!.id].teamId;
  const destTeam = nextSeason.teams[destTeamId];
  const destDivision = destTeam?.division;

  // The player must leave the user team and land on a valid same-division team.
  assert(destTeamId !== userTeam!.id, 'Expired-contract player should leave the user team');
  assert(destTeam, 'Expired-contract player should land on a valid destination team');
  assert(
    destDivision === userTeam!.division,
    `Expired-contract player should land in the same division (${userTeam!.division}), got ${destDivision}`
  );
  // Destination team should be able to afford the player (budget >= marketValue).
  assert(
    destTeam.budget >= (players[departurePlayer!.id].marketValue || 0),
    `Destination team should have sufficient budget (${destTeam.budget}) for the player's market value (${players[departurePlayer!.id].marketValue})`
  );
};

export const checkSimultaneousExpiriesRecomputeAgainstProvisionalSquad = () => {
  const data = initGameData('Arsenal');
  const team = Object.values(data.teams).find(item => item.division === 'Premier League');
  const templatePlayer = Object.values(data.players)[0];
  assert(team && templatePlayer, 'Expected team and player templates for simultaneous expiry regression');

  const players: Record<string, Player> = Object.fromEntries(
    Object.entries(data.players).map(([playerId, player]) => [
      playerId,
      player.teamId === team!.id
        ? { ...player, teamId: FREE_AGENT_TEAM_ID, isStarting: false, isSub: false }
        : player,
    ])
  ) as Record<string, Player>;
  addSquadPlayers(players, templatePlayer, team!.id, 'expiry-stable', { GK: 2, DEF: 7, MID: 7, FWD: 2 }, {
    rating: 74,
    starterCounts: { GK: 1, DEF: 4, MID: 3, FWD: 2 },
  });
  const expiringForwardIds = ['expiry-forward-a', 'expiry-forward-b', 'expiry-forward-c'];
  expiringForwardIds.forEach((playerId, index) => {
    players[playerId] = buildTestPlayer(templatePlayer, playerId, team!.id, 'FWD', 64 + index, {
      age: 27,
      wage: 18,
      marketValue: 5,
      contractLeft: 0,
      isStarting: false,
      isSub: false,
    });
  });

  const rollover = advanceSeason(
    players,
    { ...data.teams, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() },
    data.competitions,
    null,
    [],
    undefined,
    { next: createSeededRandom(2026062202) }
  );
  const nextTeam = rollover.teams[team!.id];
  const retainedExpiringForwards = expiringForwardIds.filter(playerId => rollover.players[playerId]?.teamId === nextTeam.id);
  const nextSquad = Object.values(rollover.players).filter(player => player.teamId === nextTeam.id);
  const forwardCount = nextSquad.filter(player => player.position === 'FWD').length;
  const policy = getSquadPolicy(nextTeam);

  assert(
    retainedExpiringForwards.length > 0,
    'Simultaneous same-position expiries should be recomputed against provisional departures so at least one forward is renewed'
  );
  assert(
    forwardCount >= policy.positionalMinimums.FWD,
    `Season rollover should leave at least ${policy.positionalMinimums.FWD} forwards after contracts and youth intake, got ${forwardCount}`
  );
};

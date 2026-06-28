import { GameState, InboxMessage, Player, Team, TransferNegotiation } from '../models/types';
import { StoreActionResult } from './contractActions';
import { isTransferWindowOpen } from '../utils/calendar';
import { isWageOfferAccepted } from '../core/transferFinance';
import { movePlayerToTeam } from '../core/playerMovement';
import { getSquadPolicy } from '../core/squadPolicy';
import { FREE_AGENT_TEAM_ID } from '../core/freeAgentPool';
import { RandomGenerator, resolveRandom } from '../core/random';
import { buildSquadPlan } from '../core/squadPlanningEngine';

type TransferActionState = Pick<GameState, 'currentWeek' | 'players' | 'teams' | 'userTeamId'> &
  Partial<Pick<GameState, 'pendingNegotiations' | 'inboxMessages'>>;
type TransferActionPatch = Partial<Pick<GameState, 'players' | 'teams' | 'pendingNegotiations' | 'inboxMessages'>> | TransferActionState;
type TransferActionUpdate = { patch: TransferActionPatch; result: StoreActionResult };

const ACTIVE_NEGOTIATION_STATUSES = new Set<TransferNegotiation['status']>(['pending', 'countered']);
const MAX_NEGOTIATION_ROUNDS = 3;

const roundMoney = (value: number) => Math.max(0.1, Math.round(value * 10) / 10);

const getNegotiations = (state: TransferActionState): TransferNegotiation[] => (
  Array.isArray(state.pendingNegotiations) ? state.pendingNegotiations : []
);

const getInboxMessages = (state: TransferActionState): InboxMessage[] => (
  Array.isArray(state.inboxMessages) ? state.inboxMessages : []
);

const appendInboxMessages = (state: TransferActionState, messages: InboxMessage[]) => (
  messages.length > 0 ? [...getInboxMessages(state), ...messages] : state.inboxMessages
);

const updateTransferListingState = (
  players: Record<string, Player>,
  playerId: string,
  isTransferListed: boolean,
  askingPrice: number
) => {
  const player = players[playerId];
  if (!player) return null;

  return {
    ...players,
    [playerId]: { ...player, isTransferListed, askingPrice },
  };
};

const buildNegotiationId = (
  currentWeek: number,
  buyerTeamId: string,
  sellerTeamId: string,
  playerId: string
) => `neg-${currentWeek}-${buyerTeamId}-${sellerTeamId}-${playerId}`;

const isActiveNegotiation = (negotiation: TransferNegotiation) => (
  ACTIVE_NEGOTIATION_STATUSES.has(negotiation.status)
);

const findActiveNegotiation = (
  negotiations: TransferNegotiation[],
  buyerTeamId: string,
  playerId: string
) => negotiations.find(negotiation => (
  negotiation.buyerTeamId === buyerTeamId &&
  negotiation.playerId === playerId &&
  isActiveNegotiation(negotiation)
));

const buildTransferNegotiationMessage = (
  state: TransferActionState,
  negotiation: TransferNegotiation,
  title: string,
  body: string,
  action?: InboxMessage['action']
): InboxMessage => ({
  id: `system-transfer_advice-w${state.currentWeek}-${negotiation.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  week: state.currentWeek,
  source: 'system',
  category: 'transfer_advice',
  title,
  body,
  isRead: false,
  playerId: negotiation.playerId,
  teamId: negotiation.sellerTeamId,
  action,
});

const getPositionCounts = (squad: Player[]) => (
  squad.reduce<Record<Player['position'], number>>((acc, player) => {
    acc[player.position] += 1;
    return acc;
  }, { GK: 0, DEF: 0, MID: 0, FWD: 0 })
);

const sellerCanLosePlayer = (
  seller: Team,
  target: Player,
  allPlayers: Record<string, Player>
) => {
  const policy = getSquadPolicy(seller);
  const squadAfterSale = Object.values(allPlayers).filter(player => player.teamId === seller.id && player.id !== target.id);
  const counts = getPositionCounts(squadAfterSale);
  return squadAfterSale.length >= policy.structuralMinimum && counts[target.position] >= policy.positionalMinimums[target.position];
};

const buyerHasCapacity = (buyer: Team, players: Record<string, Player>) => {
  const squadSize = Object.values(players).filter(player => player.teamId === buyer.id).length;
  return squadSize < getSquadPolicy(buyer).maximumSquadSize;
};

const evaluateSellerWillingness = (
  seller: Team,
  target: Player,
  players: Record<string, Player>
): { willing: boolean; askingPrice: number; reason: string } => {
  if (!sellerCanLosePlayer(seller, target, players)) {
    return {
      willing: false,
      askingPrice: 0,
      reason: `${seller.name} cannot lose ${target.name} without breaking squad depth.`,
    };
  }

  const squadPlan = buildSquadPlan(seller, players);
  const decision = squadPlan.contractDecisions.find(item => item.playerId === target.id);
  const need = squadPlan.needs.find(item => item.position === target.position);
  const isNeededPosition = need?.severity === 'need' || need?.severity === 'urgent';
  const positionSquad = Object.values(players)
    .filter(player => player.teamId === seller.id && player.position === target.position)
    .sort((a, b) => b.overallRating - a.overallRating);
  const starterFloor = positionSquad.slice(0, Math.min(2, positionSquad.length))
    .reduce((floor, player) => Math.min(floor, player.overallRating), target.overallRating);
  const isBelowStarterQuality = target.overallRating < starterFloor || !target.isStarting;
  const isCore = target.isStarting || positionSquad.slice(0, 2).some(player => player.id === target.id);

  if (
    isCore &&
    decision?.decision !== 'sell' &&
    decision?.decision !== 'release' &&
    (isNeededPosition || (target.contractLeft >= 3 && target.morale >= 60))
  ) {
    return {
      willing: false,
      askingPrice: 0,
      reason: `${seller.name} see ${target.name} as too important to sell right now.`,
    };
  }

  let premium = 1.35;
  if (decision?.decision === 'sell' || decision?.decision === 'release') premium = 1.05;
  else if (isBelowStarterQuality) premium = 1.18;
  else if (isCore) premium = 1.75;

  if (target.contractLeft <= 1) premium -= 0.18;
  else if (target.contractLeft <= 2) premium -= 0.08;
  if (target.morale < 45) premium -= 0.08;
  if (seller.boardProfile.ambition === 'elite' || seller.boardProfile.ambition === 'europe') premium += 0.12;
  if (seller.boardProfile.transferDiscipline === 'strict') premium += 0.08;
  if (seller.boardProfile.transferDiscipline === 'aggressive') premium -= 0.05;

  return {
    willing: true,
    askingPrice: roundMoney(Math.max(1, target.marketValue || 1) * Math.max(1, premium)),
    reason: decision?.reason || `${seller.name} would consider a premium offer for ${target.name}.`,
  };
};

const createRivalBid = (
  state: TransferActionState,
  player: Player,
  buyer: Team,
  seller: Team,
  askingPrice: number,
  rng?: RandomGenerator
): TransferNegotiation['rivalBid'] | undefined => {
  const random = resolveRandom(rng);
  const demandScore = Math.min(
    0.55,
    Math.max(0.08, ((player.overallRating - 68) / 45) + (Math.max(0, player.marketValue) / 220))
  );
  if (random() >= demandScore) return undefined;

  const candidates = Object.values(state.teams)
    .filter(team => (
      team.id !== buyer.id &&
      team.id !== seller.id &&
      team.id !== FREE_AGENT_TEAM_ID &&
      team.division === buyer.division &&
      Number.isFinite(team.budget) &&
      team.budget >= askingPrice
    ));
  if (candidates.length === 0) return undefined;

  const rival = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  return {
    teamId: rival.id,
    bid: roundMoney(askingPrice * (0.95 + random() * 0.1)),
    expiresWeek: state.currentWeek + 1,
    status: 'active',
  };
};

const createCounterNegotiation = (
  state: TransferActionState,
  player: Player,
  buyer: Team,
  seller: Team,
  fee: number,
  wage: number,
  askingPrice: number,
  source: TransferNegotiation['source'],
  rng?: RandomGenerator
): TransferActionUpdate => {
  const negotiations = getNegotiations(state);
  if (findActiveNegotiation(negotiations, buyer.id, player.id)) {
    return {
      patch: state,
      result: { success: false, message: 'You already have active talks for this player.' },
    };
  }

  const negotiation: TransferNegotiation = {
    id: buildNegotiationId(state.currentWeek, buyer.id, seller.id, player.id),
    playerId: player.id,
    buyerTeamId: buyer.id,
    sellerTeamId: seller.id,
    currentBid: roundMoney(fee),
    currentWage: wage,
    askingPrice: roundMoney(askingPrice),
    round: 1,
    status: 'countered',
    createdWeek: state.currentWeek,
    expiresWeek: state.currentWeek + 2,
    source,
    rivalBid: source === 'listed_offer'
      ? createRivalBid(state, player, buyer, seller, askingPrice, rng)
      : undefined,
  };

  const messages = [
    buildTransferNegotiationMessage(
      state,
      negotiation,
      `${seller.name} counter for ${player.name}`,
      `${seller.name} want GBP ${negotiation.askingPrice}m for ${player.name}. You can accept the counter, improve your bid, or walk away.`,
      { type: 'accept_transfer_counter', payload: { negotiationId: negotiation.id } }
    ),
    ...(negotiation.rivalBid
      ? [
        buildTransferNegotiationMessage(
          state,
          negotiation,
          `Rival bid for ${player.name}`,
          `${state.teams[negotiation.rivalBid.teamId]?.name || 'Another club'} have bid GBP ${negotiation.rivalBid.bid}m. Match or beat it within one week or you may lose the player.`
        ),
      ]
      : []),
  ];

  return {
    patch: {
      pendingNegotiations: [...negotiations, negotiation],
      inboxMessages: appendInboxMessages(state, messages),
    },
    result: { success: true, message: `${seller.name} countered at GBP ${negotiation.askingPrice}m.` },
  };
};

const completeNegotiation = (
  state: TransferActionState,
  negotiation: TransferNegotiation,
  fee: number,
  wage: number
): TransferActionUpdate => {
  const buyer = state.teams[negotiation.buyerTeamId];
  const seller = state.teams[negotiation.sellerTeamId];
  const player = state.players[negotiation.playerId];
  if (!buyer || !seller || !player || player.teamId !== seller.id) {
    return {
      patch: state,
      result: { success: false, message: 'This transfer is no longer available.' },
    };
  }
  if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(wage) || wage < 0) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid transfer finances.' },
    };
  }
  if (buyer.budget < fee) {
    return {
      patch: state,
      result: { success: false, message: 'Insufficient transfer funds.' },
    };
  }
  if (!buyerHasCapacity(buyer, state.players)) {
    return {
      patch: state,
      result: { success: false, message: 'Your squad is already at the registration capacity.' },
    };
  }
  if (wage > 0 && !isWageOfferAccepted(player, wage)) {
    return {
      patch: state,
      result: { success: false, message: `${player.name} rejected your wage offer of GBP ${wage}k/w.` },
    };
  }

  const finalFee = roundMoney(fee);
  const moved = movePlayerToTeam(
    state.players,
    state.teams,
    player.id,
    buyer.id,
    { wage: wage > 0 ? wage : player.wage, contractLeft: Math.max(player.contractLeft, 3) },
    { budget: seller.budget + finalFee },
    { budget: buyer.budget - finalFee, transferSpend: buyer.transferSpend + finalFee }
  );
  const pendingNegotiations = getNegotiations(state).map(item => (
    item.id === negotiation.id
      ? { ...item, currentBid: finalFee, currentWage: wage, status: 'accepted' as const }
      : item
  ));

  return {
    patch: {
      teams: moved.teams,
      players: moved.players,
      pendingNegotiations,
    },
    result: { success: true, message: `Successfully purchased ${player.name} for GBP ${finalFee}m.` },
  };
};

export const approachPlayerState = (
  state: TransferActionState,
  playerId: string
): TransferActionUpdate => {
  const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;
  const player = state.players[playerId];
  const seller = player ? state.teams[player.teamId] : null;

  if (!userTeam || !player || !seller) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid team or player.' },
    };
  }

  if (!isTransferWindowOpen(state.currentWeek)) {
    return {
      patch: state,
      result: { success: false, message: 'You cannot approach players outside of the transfer window.' },
    };
  }

  if (player.teamId === userTeam.id) {
    return {
      patch: state,
      result: { success: false, message: 'You cannot approach your own player.' },
    };
  }

  if (player.teamId === FREE_AGENT_TEAM_ID) {
    return {
      patch: state,
      result: { success: false, message: 'Free agents can be offered a contract directly.' },
    };
  }

  const negotiations = getNegotiations(state);
  if (findActiveNegotiation(negotiations, userTeam.id, player.id)) {
    return {
      patch: state,
      result: { success: false, message: 'You already have active talks for this player.' },
    };
  }

  const willingness = evaluateSellerWillingness(seller, player, state.players);
  if (!willingness.willing) {
    return {
      patch: { pendingNegotiations: negotiations },
      result: { success: false, message: willingness.reason },
    };
  }

  const negotiation: TransferNegotiation = {
    id: buildNegotiationId(state.currentWeek, userTeam.id, seller.id, player.id),
    playerId: player.id,
    buyerTeamId: userTeam.id,
    sellerTeamId: seller.id,
    currentBid: 0,
    currentWage: player.wage,
    askingPrice: willingness.askingPrice,
    round: 0,
    status: 'pending',
    createdWeek: state.currentWeek,
    expiresWeek: state.currentWeek + 2,
    source: 'unlisted_approach',
  };

  const message = buildTransferNegotiationMessage(
    state,
    negotiation,
    `${seller.name} open talks for ${player.name}`,
    `${seller.name} would listen at around GBP ${negotiation.askingPrice}m. ${willingness.reason}`
  );

  return {
    patch: {
      pendingNegotiations: [...negotiations, negotiation],
      inboxMessages: appendInboxMessages(state, [message]),
    },
    result: { success: true, message: `${seller.name} would negotiate for around GBP ${negotiation.askingPrice}m.` },
  };
};

export const buyPlayerState = (
  state: TransferActionState,
  playerId: string,
  fee: number,
  wageOffered: number,
  rng?: RandomGenerator
): TransferActionUpdate => {
  const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;
  const player = state.players[playerId];
  const seller = player ? state.teams[player.teamId] : null;

  if (!userTeam || !player || !seller) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid team or player.' },
    };
  }

  if (!isTransferWindowOpen(state.currentWeek)) {
    return {
      patch: state,
      result: { success: false, message: 'You cannot buy players outside of the transfer window.' },
    };
  }

  if (player.teamId === userTeam.id) {
    return {
      patch: state,
      result: { success: false, message: 'You cannot buy your own player.' },
    };
  }

  if (!player.isTransferListed) {
    return {
      patch: state,
      result: { success: false, message: 'This player is not listed for sale.' },
    };
  }

  if (
    !Number.isFinite(fee) ||
    fee <= 0 ||
    !Number.isFinite(wageOffered) ||
    wageOffered < 0 ||
    !Number.isFinite(player.askingPrice) ||
    player.askingPrice <= 0 ||
    !Number.isFinite(userTeam.budget) ||
    !Number.isFinite(userTeam.transferSpend)
  ) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid transfer finances.' },
    };
  }

  if (userTeam.budget < fee) {
    return {
      patch: state,
      result: { success: false, message: 'Insufficient transfer funds.' },
    };
  }

  if (!buyerHasCapacity(userTeam, state.players)) {
    return {
      patch: state,
      result: { success: false, message: 'Your squad is already at the registration capacity.' },
    };
  }

  if (fee < player.askingPrice * 0.85) {
    return {
      patch: state,
      result: { success: false, message: `The club rejected your bid of GBP ${fee}m.` },
    };
  }

  if (wageOffered > 0 && !isWageOfferAccepted(player, wageOffered)) {
    return {
      patch: state,
      result: { success: false, message: `${player.name} rejected your wage offer of GBP ${wageOffered}k/w.` },
    };
  }

  if (fee < player.askingPrice) {
    return createCounterNegotiation(
      state,
      player,
      userTeam,
      seller,
      fee,
      wageOffered,
      player.askingPrice,
      'listed_offer',
      rng
    );
  }

  const negotiation: TransferNegotiation = {
    id: buildNegotiationId(state.currentWeek, userTeam.id, seller.id, player.id),
    playerId: player.id,
    buyerTeamId: userTeam.id,
    sellerTeamId: seller.id,
    currentBid: fee,
    currentWage: wageOffered,
    askingPrice: player.askingPrice,
    round: 1,
    status: 'pending',
    createdWeek: state.currentWeek,
    expiresWeek: state.currentWeek + 2,
    source: 'listed_offer',
  };
  return completeNegotiation(state, negotiation, fee, wageOffered);
};

export const submitBidState = (
  state: TransferActionState,
  negotiationId: string,
  fee: number,
  wageOffered: number
): TransferActionUpdate => {
  const negotiations = getNegotiations(state);
  const negotiation = negotiations.find(item => item.id === negotiationId);
  if (!negotiation || !isActiveNegotiation(negotiation)) {
    return {
      patch: state,
      result: { success: false, message: 'This negotiation is no longer active.' },
    };
  }

  if (fee >= negotiation.askingPrice) {
    return completeNegotiation(state, negotiation, fee, wageOffered);
  }

  if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(wageOffered) || wageOffered < 0) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid transfer finances.' },
    };
  }

  const player = state.players[negotiation.playerId];
  if (!player || (wageOffered > 0 && !isWageOfferAccepted(player, wageOffered))) {
    return {
      patch: state,
      result: { success: false, message: player ? `${player.name} rejected your wage offer of GBP ${wageOffered}k/w.` : 'This transfer is no longer available.' },
    };
  }

  if (fee < negotiation.askingPrice * 0.85 || negotiation.round >= MAX_NEGOTIATION_ROUNDS) {
    return {
      patch: {
        pendingNegotiations: negotiations.map(item => (
          item.id === negotiation.id
            ? { ...item, currentBid: roundMoney(fee), currentWage: wageOffered, status: 'rejected' as const }
            : item
        )),
      },
      result: { success: false, message: 'The seller walked away from negotiations.' },
    };
  }

  const nextAsk = roundMoney((negotiation.askingPrice + fee) / 2);
  return {
    patch: {
      pendingNegotiations: negotiations.map(item => (
        item.id === negotiation.id
          ? {
            ...item,
            currentBid: roundMoney(fee),
            currentWage: wageOffered,
            askingPrice: nextAsk,
            round: item.round + 1,
            status: 'countered' as const,
            expiresWeek: state.currentWeek + 2,
          }
          : item
      )),
    },
    result: { success: true, message: `The seller countered at GBP ${nextAsk}m.` },
  };
};

export const acceptTransferCounterState = (
  state: TransferActionState,
  negotiationId: string
): TransferActionUpdate => {
  const negotiation = getNegotiations(state).find(item => item.id === negotiationId);
  if (!negotiation || !isActiveNegotiation(negotiation)) {
    return {
      patch: state,
      result: { success: false, message: 'This negotiation is no longer active.' },
    };
  }
  return completeNegotiation(state, negotiation, negotiation.askingPrice, negotiation.currentWage);
};

export const withdrawTransferNegotiationState = (
  state: TransferActionState,
  negotiationId: string
): TransferActionPatch => ({
  pendingNegotiations: getNegotiations(state).map(item => (
    item.id === negotiationId && isActiveNegotiation(item)
      ? { ...item, status: 'rejected' as const }
      : item
  )),
});

export const resolveWeeklyNegotiationsState = (state: TransferActionState): TransferActionState => {
  let players = state.players;
  let teams = state.teams;
  const pendingNegotiations = getNegotiations(state).map(negotiation => {
    if (!isActiveNegotiation(negotiation)) return negotiation;

    const player = players[negotiation.playerId];
    if (!player || player.teamId !== negotiation.sellerTeamId) {
      return {
        ...negotiation,
        status: player?.teamId === negotiation.buyerTeamId ? 'accepted' as const : 'rejected' as const,
      };
    }

    if (
      negotiation.rivalBid?.status === 'active' &&
      state.currentWeek >= negotiation.rivalBid.expiresWeek
    ) {
      if (negotiation.currentBid >= negotiation.rivalBid.bid) {
        return {
          ...negotiation,
          rivalBid: { ...negotiation.rivalBid, status: 'matched' as const },
        };
      }

      const rival = teams[negotiation.rivalBid.teamId];
      const seller = teams[negotiation.sellerTeamId];
      if (rival && seller && rival.budget >= negotiation.rivalBid.bid) {
        const moved = movePlayerToTeam(
          players,
          teams,
          negotiation.playerId,
          rival.id,
          { contractLeft: Math.max(player.contractLeft, 2) },
          { budget: seller.budget + negotiation.rivalBid.bid },
          { budget: rival.budget - negotiation.rivalBid.bid, transferSpend: rival.transferSpend + negotiation.rivalBid.bid }
        );
        players = moved.players;
        teams = moved.teams;
        return {
          ...negotiation,
          status: 'rejected' as const,
          rivalBid: { ...negotiation.rivalBid, status: 'won' as const },
        };
      }

      return {
        ...negotiation,
        rivalBid: { ...negotiation.rivalBid, status: 'expired' as const },
      };
    }

    if (state.currentWeek >= negotiation.expiresWeek) {
      return { ...negotiation, status: 'expired' as const };
    }

    return negotiation;
  });

  return {
    ...state,
    players,
    teams,
    pendingNegotiations,
  };
};

const getFreeAgentContractYears = (player: Player) => {
  if (player.age <= 23) return 3;
  if (player.age <= 30) return 2;
  return 1;
};

const canSustainWage = (team: NonNullable<TransferActionState['teams'][string]>, wage: number) => {
  const operatingBudget = team.operatingBudget !== undefined ? team.operatingBudget : team.budget;
  return Number.isFinite(operatingBudget) && operatingBudget >= (wage / 1000) * 4;
};

export const signFreeAgentState = (
  state: TransferActionState,
  playerId: string,
  wageOffered: number
): TransferActionUpdate => {
  const userTeam = state.userTeamId ? state.teams[state.userTeamId] : null;
  const player = state.players[playerId];

  if (!userTeam || !player) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid team or player.' },
    };
  }

  if (player.teamId !== FREE_AGENT_TEAM_ID) {
    return {
      patch: state,
      result: { success: false, message: 'This player is not a free agent.' },
    };
  }

  if (!Number.isFinite(wageOffered) || wageOffered <= 0) {
    return {
      patch: state,
      result: { success: false, message: 'Invalid wage offer.' },
    };
  }

  if (!buyerHasCapacity(userTeam, state.players)) {
    return {
      patch: state,
      result: { success: false, message: 'Your squad is already at the registration capacity.' },
    };
  }

  if (!canSustainWage(userTeam, wageOffered)) {
    return {
      patch: state,
      result: { success: false, message: 'The wage would exceed your operating budget.' },
    };
  }

  if (!isWageOfferAccepted(player, wageOffered)) {
    return {
      patch: state,
      result: { success: false, message: `${player.name} rejected your wage offer of GBP ${wageOffered}k/w.` },
    };
  }

  const moved = movePlayerToTeam(
    state.players,
    state.teams,
    playerId,
    userTeam.id,
    {
      wage: wageOffered,
      contractLeft: getFreeAgentContractYears(player),
      morale: Math.max(60, player.morale),
    }
  );

  return {
    patch: {
      teams: moved.teams,
      players: moved.players,
    },
    result: { success: true, message: `Signed ${player.name} as a free agent.` },
  };
};

export const listPlayerForSaleState = (
  state: TransferActionState,
  playerId: string,
  askingPrice: number
): TransferActionPatch => {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) return state;
  if (!Number.isFinite(askingPrice) || askingPrice <= 0) return state;
  const players = updateTransferListingState(state.players, playerId, true, askingPrice);
  return players ? { players } : state;
};

export const unlistPlayerState = (
  state: TransferActionState,
  playerId: string
): TransferActionPatch => {
  const player = state.players[playerId];
  if (!player || player.teamId !== state.userTeamId) return state;
  const players = updateTransferListingState(state.players, playerId, false, 0);
  return players ? { players } : state;
};

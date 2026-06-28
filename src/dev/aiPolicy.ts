import { BASE_FORMATION_SLOTS, getSlotsForFormation } from '../constants/formations';
import { FREE_AGENT_TEAM_ID } from '../core/freeAgentPool';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import { buildSquadPlan } from '../core/squadPlanningEngine';
import { scoreAiTransferTarget } from '../core/transferEngine';
import { isTransferWindowOpen } from '../utils/calendar';
import type {
  Fixture,
  Formation,
  GameState,
  InboxMessage,
  LiveMatchState,
  Player,
  StatKey,
  Team,
  TeamTactics,
} from '../models/types';

export type AIPolicyMode = 'aggressive' | 'balanced' | 'passive';
export type AIPlayVerbosity = 'quiet' | 'summary' | 'detailed';

export interface AIPlayConfig {
  seasons: number;
  seed: number;
  teamId: string;
  policy: AIPolicyMode;
  stopOnError: boolean;
  reportBalanceFlags: boolean;
  verbosity: AIPlayVerbosity;
}

export type BugReport = {
  week: number;
  type: 'exception' | 'validation';
  message: string;
  stack?: string;
  stateHash?: string;
  stateSnapshot?: unknown;
  issues?: unknown[];
};

export type BalanceFlag = {
  week: number;
  type: 'scoreline' | 'match_stats' | 'finances' | 'league_table' | 'progression';
  message: string;
  entity?: string;
  context?: unknown;
};

export interface AIPlayReport {
  seasons: number;
  weeksPlayed: number;
  bugs: BugReport[];
  balanceFlags: BalanceFlag[];
  summary: {
    avgGoalsPerMatch: number;
    promotions: number;
    relegations: number;
    sackings: number;
    transfersMade: number;
    financialHealth: 'healthy' | 'strained' | 'bankrupt';
  };
}

export type AIPolicyDecision = {
  type:
    | 'formation'
    | 'tactics'
    | 'rotation'
    | 'training'
    | 'transfer_buy'
    | 'free_agent'
    | 'transfer_list'
    | 'contract_renewal'
    | 'job_offer'
    | 'live_tactics'
    | 'live_substitution';
  message: string;
  playerId?: string;
  teamId?: string;
};

export type AIPolicyResult = {
  decisions: AIPolicyDecision[];
  transfersMade: number;
};

type StoreActionResult = { success: boolean; message: string };

export type AIPolicyGameState = GameState & {
  liveMatches: Record<string, LiveMatchState>;
  getAiState?: () => AIPolicyGameState;
  setFormation: (teamId: string, formation: Formation) => void;
  setTactics: (teamId: string, tactics: Partial<TeamTactics>) => void;
  swapPlayer: (removeId: string | null, addId: string, slotKey?: string) => void;
  setTrainingFocus: (playerId: string, focus: StatKey | null) => void;
  buyPlayer: (playerId: string, fee: number, wageOffered: number) => StoreActionResult;
  signFreeAgent: (playerId: string, wageOffered: number) => StoreActionResult;
  listPlayerForSale: (playerId: string, askingPrice: number) => void;
  renewPlayerContract: (playerId: string, years: number, wage: number) => StoreActionResult;
  applyInboxAction: (messageId: string) => void;
  makeLiveSubstitutions: (
    fixtureId: string,
    replacements: { offPlayerId: string; onPlayerId: string }[]
  ) => StoreActionResult;
};

const SEVERITY_VALUE = {
  none: 0,
  watch: 1,
  need: 2,
  urgent: 3,
} as const;

const DIVISION_RANK: Record<string, number> = {
  'Premier League': 4,
  Championship: 3,
  'League One': 2,
  'League Two': 1,
  Continental: 0,
};

const STAT_KEYS: StatKey[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];

const POSITION_STAT_PRIORITY: Record<Player['position'], StatKey[]> = {
  GK: ['physical', 'passing'],
  DEF: ['defending', 'physical', 'pace', 'passing'],
  MID: ['passing', 'dribbling', 'physical', 'pace'],
  FWD: ['shooting', 'pace', 'dribbling', 'physical'],
};

const policyNeedFloor = (policy: AIPolicyMode) => (
  policy === 'aggressive' ? SEVERITY_VALUE.watch :
  policy === 'passive' ? SEVERITY_VALUE.urgent :
  SEVERITY_VALUE.need
);

const playerSelectionScore = (player: Player) => (
  player.overallRating + player.energy * 0.12 + player.morale * 0.04
);

const getManagedTeam = (game: AIPolicyGameState): Team | null => (
  game.userTeamId ? game.teams[game.userTeamId] ?? null : null
);

const getTeamSquad = (players: Record<string, Player>, teamId: string) => (
  Object.values(players).filter(player => player.teamId === teamId)
);

const getAverageRating = (players: Player[]) => (
  players.length === 0
    ? 0
    : players.reduce((sum, player) => sum + player.overallRating, 0) / players.length
);

const getFormationSlotCounts = (formation: Formation) => (
  getSlotsForFormation(formation).flat().reduce<Record<Player['position'], number>>((counts, slot) => {
    counts[slot.pos] += 1;
    return counts;
  }, { GK: 0, DEF: 0, MID: 0, FWD: 0 })
);

const scoreFormationFit = (formation: Formation, squad: Player[]) => {
  const available = squad
    .filter(player => !isPlayerUnavailable(player))
    .sort((a, b) => playerSelectionScore(b) - playerSelectionScore(a));
  const used = new Set<string>();
  let score = 0;

  getSlotsForFormation(formation).flat().forEach(slot => {
    const exact = available.find(player => player.position === slot.pos && !used.has(player.id));
    const fallback = exact || available.find(player => !used.has(player.id) && player.position !== 'GK' && slot.pos !== 'GK');
    const selected = fallback || available.find(player => !used.has(player.id));
    if (!selected) {
      score -= 80;
      return;
    }
    used.add(selected.id);
    score += playerSelectionScore(selected);
    if (selected.position !== slot.pos) score -= slot.pos === 'GK' || selected.position === 'GK' ? 100 : 18;
  });

  const counts = getFormationSlotCounts(formation);
  const squadCounts = available.reduce<Record<Player['position'], number>>((acc, player) => {
    acc[player.position] += 1;
    return acc;
  }, { GK: 0, DEF: 0, MID: 0, FWD: 0 });

  if (counts.FWD >= 3 && squadCounts.FWD < 4) score -= 20;
  if (counts.DEF >= 5 && squadCounts.DEF < 6) score -= 20;
  if (counts.MID >= 5 && squadCounts.MID < 6) score -= 15;

  return score;
};

const chooseBestFormation = (team: Team, squad: Player[]): Formation => {
  const candidates = Object.keys(BASE_FORMATION_SLOTS) as Formation[];
  return candidates
    .map(formation => ({
      formation,
      score: scoreFormationFit(formation, squad) + (team.manager.preferredFormations.includes(formation) ? 25 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.formation ?? team.activeFormation;
};

const getSlotForPlayer = (team: Team, playerId: string) => (
  Object.entries(team.formationMap || {}).find(([, mappedPlayerId]) => mappedPlayerId === playerId)?.[0]
);

const rotateTiredPlayers = (game: AIPolicyGameState, team: Team, decisions: AIPolicyDecision[]) => {
  const squad = getTeamSquad(game.players, team.id);
  const bench = squad
    .filter(player => player.isSub && !isPlayerUnavailable(player))
    .sort((a, b) => playerSelectionScore(b) - playerSelectionScore(a));
  const usedBenchIds = new Set<string>();

  squad
    .filter(player => player.isStarting && !isPlayerUnavailable(player) && player.energy < 55)
    .sort((a, b) => a.energy - b.energy)
    .slice(0, 3)
    .forEach(tiredPlayer => {
      const alternative = bench.find(candidate => (
        !usedBenchIds.has(candidate.id) &&
        candidate.position === tiredPlayer.position &&
        candidate.energy > tiredPlayer.energy + 10 &&
        candidate.overallRating >= tiredPlayer.overallRating - 5
      ));
      const slotKey = getSlotForPlayer(team, tiredPlayer.id);
      if (!alternative || !slotKey) return;

      game.swapPlayer(tiredPlayer.id, alternative.id, slotKey);
      usedBenchIds.add(alternative.id);
      decisions.push({
        type: 'rotation',
        playerId: alternative.id,
        teamId: team.id,
        message: `Rotated ${alternative.name} in for tired ${tiredPlayer.name}.`,
      });
    });
};

const pickTrainingFocus = (player: Player): StatKey => {
  const preferredStats = POSITION_STAT_PRIORITY[player.position] || STAT_KEYS;
  return preferredStats
    .map(stat => ({ stat, value: player.stats[stat] ?? player.overallRating }))
    .sort((a, b) => a.value - b.value)[0]?.stat ?? 'passing';
};

const setYouthTraining = (game: AIPolicyGameState, team: Team, decisions: AIPolicyDecision[]) => {
  getTeamSquad(game.players, team.id)
    .filter(player => player.age <= 21 && (player.potential ?? player.overallRating) > player.overallRating + 3)
    .sort((a, b) => ((b.potential ?? b.overallRating) - b.overallRating) - ((a.potential ?? a.overallRating) - a.overallRating))
    .slice(0, 8)
    .forEach(player => {
      const focus = pickTrainingFocus(player);
      if (player.trainingFocus === focus) return;
      game.setTrainingFocus(player.id, focus);
      decisions.push({
        type: 'training',
        playerId: player.id,
        teamId: team.id,
        message: `Set ${player.name} to train ${focus}.`,
      });
    });
};

const configureTeamShape = (game: AIPolicyGameState, config: AIPlayConfig, team: Team, decisions: AIPolicyDecision[]) => {
  const squad = getTeamSquad(game.players, team.id);
  const formation = chooseBestFormation(team, squad);
  if (formation !== team.activeFormation) {
    game.setFormation(team.id, formation);
    decisions.push({
      type: 'formation',
      teamId: team.id,
      message: `Changed formation to ${formation}.`,
    });
  }

  const tactics: Partial<TeamTactics> = config.policy === 'aggressive'
    ? { mentality: 'Attacking', tempo: 'Fast', pressing: 'High' }
    : config.policy === 'passive'
      ? { mentality: 'Balanced', tempo: 'Normal', pressing: 'Medium' }
      : { mentality: 'Balanced', tempo: 'Normal', pressing: 'Medium' };
  game.setTactics(team.id, tactics);
  decisions.push({
    type: 'tactics',
    teamId: team.id,
    message: `Applied ${config.policy} tactical posture.`,
  });
};

const getPriorityNeed = (team: Team, players: Record<string, Player>, policy: AIPolicyMode) => (
  [...buildSquadPlan(team, players).needs]
    .filter(need => SEVERITY_VALUE[need.severity] >= policyNeedFloor(policy))
    .sort((a, b) => {
      const severityDelta = SEVERITY_VALUE[b.severity] - SEVERITY_VALUE[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return (b.targetDepth - b.currentDepth) - (a.targetDepth - a.currentDepth);
    })[0]
);

const buyListedTarget = (game: AIPolicyGameState, config: AIPlayConfig, team: Team, decisions: AIPolicyDecision[]) => {
  if (config.policy === 'passive' || !isTransferWindowOpen(game.currentWeek)) return 0;
  const priorityNeed = getPriorityNeed(team, game.players, config.policy);
  if (!priorityNeed) return 0;

  const budgetShare = config.policy === 'aggressive' ? 0.7 : 0.5;
  const budgetLimit = Math.max(0, team.budget) * budgetShare;
  const squad = getTeamSquad(game.players, team.id);
  const buyerSquadAvgRating = getAverageRating(squad) || 65;
  const candidates = Object.values(game.players)
    .filter(player => (
      player.isTransferListed &&
      player.teamId !== team.id &&
      player.teamId !== FREE_AGENT_TEAM_ID &&
      player.position === priorityNeed.position &&
      player.askingPrice > 0 &&
      player.askingPrice <= budgetLimit
    ))
    .map(target => scoreAiTransferTarget({
      buyer: team,
      seller: game.teams[target.teamId],
      target,
      allPlayers: game.players,
      severity: priorityNeed.severity,
      buyerSquadAvgRating,
    }))
    .filter(score => score.isValid)
    .sort((a, b) => b.value - a.value);

  const best = candidates[0];
  if (!best) return 0;
  const result = game.buyPlayer(best.target.id, best.target.askingPrice, best.newWage);
  if (!result.success) return 0;
  decisions.push({
    type: 'transfer_buy',
    playerId: best.target.id,
    teamId: team.id,
    message: `Bought ${best.target.name} for ${priorityNeed.position} depth.`,
  });
  return 1;
};

const signUrgentFreeAgent = (game: AIPolicyGameState, config: AIPlayConfig, team: Team, decisions: AIPolicyDecision[]) => {
  if (config.policy === 'passive') return 0;
  const priorityNeed = getPriorityNeed(team, game.players, 'passive');
  if (!priorityNeed) return 0;

  const squad = getTeamSquad(game.players, team.id);
  const buyerSquadAvgRating = getAverageRating(squad) || 65;
  const best = Object.values(game.players)
    .filter(player => player.teamId === FREE_AGENT_TEAM_ID && player.position === priorityNeed.position)
    .map(target => scoreAiTransferTarget({
      buyer: team,
      target,
      allPlayers: game.players,
      severity: priorityNeed.severity,
      buyerSquadAvgRating,
      freeAgent: true,
    }))
    .filter(score => score.isValid)
    .sort((a, b) => b.value - a.value)[0];

  if (!best) return 0;
  const result = game.signFreeAgent(best.target.id, best.newWage);
  if (!result.success) return 0;
  decisions.push({
    type: 'free_agent',
    playerId: best.target.id,
    teamId: team.id,
    message: `Signed free agent ${best.target.name} for urgent ${priorityNeed.position} depth.`,
  });
  return 1;
};

const managePlayerContractsAndListings = (game: AIPolicyGameState, team: Team, decisions: AIPolicyDecision[]) => {
  const squad = getTeamSquad(game.players, team.id);
  const averageRating = getAverageRating(squad);
  const plan = buildSquadPlan(team, game.players);

  squad
    .filter(player => player.morale < 35 && !player.isTransferListed)
    .slice(0, 4)
    .forEach(player => {
      game.listPlayerForSale(player.id, Math.max(1, Math.round(player.marketValue * 10) / 10));
      decisions.push({
        type: 'transfer_list',
        playerId: player.id,
        teamId: team.id,
        message: `Listed low-morale player ${player.name}.`,
      });
    });

  plan.contractDecisions
    .filter(decision => decision.decision === 'renew')
    .slice(0, 4)
    .forEach(decision => {
      const player = game.players[decision.playerId];
      if (!player || player.overallRating < averageRating || player.contractLeft > 1) return;
      const wage = Math.max(1, Math.round(player.wage * 1.1));
      const years = player.age <= 24 ? 3 : player.age <= 30 ? 2 : 1;
      const result = game.renewPlayerContract(player.id, years, wage);
      if (!result.success) return;
      decisions.push({
        type: 'contract_renewal',
        playerId: player.id,
        teamId: team.id,
        message: `Renewed above-average player ${player.name}.`,
      });
    });
};

const scoreJobOffer = (team: Team) => (
  (DIVISION_RANK[team.division] ?? 0) * 1000 + team.manager.reputation * 4 + team.budget
);

const shouldAcceptOffer = (currentTeam: Team | null, offerTeam: Team, game: AIPolicyGameState) => {
  const latestSeason = game.careerRecord.seasonHistory.at(-1);
  if (latestSeason?.outcome === 'sacked') return true;
  if (!currentTeam) return true;
  const currentRank = DIVISION_RANK[currentTeam.division] ?? 0;
  const offerRank = DIVISION_RANK[offerTeam.division] ?? 0;
  if (offerRank > currentRank) return true;
  return offerRank === currentRank && scoreJobOffer(offerTeam) > scoreJobOffer(currentTeam) + 120;
};

export const runAiPostWeekPolicy = (
  game: AIPolicyGameState,
  config: AIPlayConfig
): AIPolicyResult => {
  const decisions: AIPolicyDecision[] = [];
  const currentTeam = getManagedTeam(game);
  const offers = game.inboxMessages
    .filter((message: InboxMessage) => message.category === 'career_job_offer' && message.action?.type === 'accept_job_offer')
    .map(message => ({
      message,
      team: game.teams[message.teamId || ''],
    }))
    .filter((item): item is { message: InboxMessage; team: Team } => Boolean(item.team))
    .sort((a, b) => scoreJobOffer(b.team) - scoreJobOffer(a.team));

  const bestOffer = offers[0];
  if (bestOffer && shouldAcceptOffer(currentTeam, bestOffer.team, game)) {
    game.applyInboxAction(bestOffer.message.id);
    decisions.push({
      type: 'job_offer',
      teamId: bestOffer.team.id,
      message: `Accepted job offer from ${bestOffer.team.name}.`,
    });
  } else if (config.policy === 'aggressive') {
    offers.slice(1).forEach(offer => {
      if (shouldAcceptOffer(currentTeam, offer.team, game)) {
        game.applyInboxAction(offer.message.id);
      }
    });
  }

  return { decisions, transfersMade: 0 };
};

const getLiveScore = (liveMatch: LiveMatchState) => ({
  home: liveMatch.homeGoalMinutes?.length ?? 0,
  away: liveMatch.awayGoalMinutes?.length ?? 0,
  minute: Math.max(0, ...(liveMatch.processedMinutes || [])),
});

const runLiveMatchPolicy = (game: AIPolicyGameState, team: Team, decisions: AIPolicyDecision[]) => {
  Object.entries(game.liveMatches || {}).forEach(([fixtureId, liveMatch]) => {
    const fixture: Fixture | undefined = game.fixtures[fixtureId];
    if (!fixture || fixture.isPlayed || (fixture.homeTeamId !== team.id && fixture.awayTeamId !== team.id)) return;
    const score = getLiveScore(liveMatch);
    if (score.minute < 45) return;

    const isHome = fixture.homeTeamId === team.id;
    const deficit = isHome ? score.away - score.home : score.home - score.away;
    if (deficit >= 2 && team.tactics.mentality !== 'Attacking') {
      game.setTactics(team.id, { mentality: 'Attacking', tempo: 'Fast' });
      decisions.push({
        type: 'live_tactics',
        teamId: team.id,
        message: `Switched to attacking after falling ${deficit} goals behind.`,
      });
    }

    const currentIds = isHome
      ? liveMatch.currentHomePlayerIds || liveMatch.homeStarterIds
      : liveMatch.currentAwayPlayerIds || liveMatch.awayStarterIds;
    const benchIds = isHome ? liveMatch.homeBenchIds || [] : liveMatch.awayBenchIds || [];
    const offPlayer = currentIds
      .map(playerId => game.players[playerId])
      .filter(Boolean)
      .sort((a, b) => (a.energy + a.overallRating * 0.4) - (b.energy + b.overallRating * 0.4))[0];
    const onPlayer = benchIds
      .map(playerId => game.players[playerId])
      .filter(player => player && !isPlayerUnavailable(player) && player.position === offPlayer?.position)
      .sort((a, b) => playerSelectionScore(b) - playerSelectionScore(a))[0];

    if (!offPlayer || !onPlayer) return;
    const result = game.makeLiveSubstitutions(fixtureId, [{ offPlayerId: offPlayer.id, onPlayerId: onPlayer.id }]);
    if (!result.success) return;
    decisions.push({
      type: 'live_substitution',
      playerId: onPlayer.id,
      teamId: team.id,
      message: `Substituted ${onPlayer.name} for ${offPlayer.name}.`,
    });
  });
};

export const runAiPreWeekPolicy = (
  game: AIPolicyGameState,
  config: AIPlayConfig
): AIPolicyResult => {
  const team = getManagedTeam(game);
  if (!team) return { decisions: [], transfersMade: 0 };

  const decisions: AIPolicyDecision[] = [];
  configureTeamShape(game, config, team, decisions);
  const refreshedGame = game.getAiState?.() ?? game;
  const refreshedTeam = getManagedTeam(refreshedGame) || team;
  rotateTiredPlayers(refreshedGame, refreshedTeam, decisions);
  setYouthTraining(refreshedGame, refreshedTeam, decisions);
  managePlayerContractsAndListings(refreshedGame, refreshedTeam, decisions);
  const transferGame = refreshedGame.getAiState?.() ?? refreshedGame;
  const transferTeam = getManagedTeam(transferGame) || refreshedTeam;
  const transferBuys = buyListedTarget(transferGame, config, transferTeam, decisions);
  const freeAgentGame = transferGame.getAiState?.() ?? transferGame;
  const freeAgentTeam = getManagedTeam(freeAgentGame) || transferTeam;
  const freeAgentSignings = transferBuys > 0 ? 0 : signUrgentFreeAgent(freeAgentGame, config, freeAgentTeam, decisions);
  const liveGame = freeAgentGame.getAiState?.() ?? freeAgentGame;
  runLiveMatchPolicy(liveGame, getManagedTeam(liveGame) || freeAgentTeam, decisions);

  return {
    decisions,
    transfersMade: transferBuys + freeAgentSignings,
  };
};

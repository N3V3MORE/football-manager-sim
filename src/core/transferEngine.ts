import { Player, Team } from '../models/types';
import { removePlayerFromTeamSelections } from './formationMapUtils';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { RandomGenerator, resolveRandom } from './random';
import { buildSquadPlan } from './squadPlanningEngine';
import { isTransferWindowOpen } from '../utils/calendar';

type PositionKey = Player['position'];
type PlanningSeverity = 'none' | 'watch' | 'need' | 'urgent';

export type AITransferDecision = {
  week?: number;
  action: 'listed' | 'bought';
  teamId: string;
  playerId: string;
  position: PositionKey;
  reason: string;
  fee?: number;
  fromTeamId?: string;
  squadNeed?: {
    position: PositionKey;
    severity: PlanningSeverity;
    currentDepth: number;
    targetDepth: number;
    reason: string;
  };
  contractDecision?: {
    decision: 'renew' | 'sell' | 'release' | 'hold';
    priority: number;
    reason: string;
  };
  boardContext: {
    ambition: Team['boardProfile']['ambition'];
    transferDiscipline: Team['boardProfile']['transferDiscipline'];
    managerTransferIdentity: string;
  };
  rolePromise?: 'starter' | 'rotation' | 'squad';
  newWage?: number;
};

export type WeeklyTransferResult = {
  players: Record<string, Player>;
  teams: Record<string, Team>;
  decisions: AITransferDecision[];
};

const NEED_SEVERITY_VALUE: Record<PlanningSeverity, number> = {
  none: 0,
  watch: 1,
  need: 2,
  urgent: 3,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// --- Manager Transfer Identity Profile ---
type ManagerIdentityProfile = {
  label: string;
  buyChanceMod: number;
  agePreference: 'young' | 'peak' | 'experienced' | 'neutral';
  ratingWeight: number;
  priceSensitivity: number;
  ageSensitivity: number;
};

const getManagerIdentityProfile = (identity: string): ManagerIdentityProfile => {
  const lower = identity.toLowerCase();

  if (lower.includes('youth') || lower.includes('high-ceiling') || lower.includes('development')) {
    return { label: 'youth', buyChanceMod: -0.05, agePreference: 'young', ratingWeight: 0.8, priceSensitivity: 0.7, ageSensitivity: 2.0 };
  }
  if (lower.includes('value') || lower.includes('resale') || lower.includes('bargain')) {
    return { label: 'value', buyChanceMod: -0.03, agePreference: 'young', ratingWeight: 0.9, priceSensitivity: 1.5, ageSensitivity: 1.3 };
  }
  if (lower.includes('star') || lower.includes('premium') || lower.includes('marquee')) {
    return { label: 'star', buyChanceMod: 0.08, agePreference: 'peak', ratingWeight: 1.4, priceSensitivity: 0.5, ageSensitivity: 0.5 };
  }
  if (lower.includes('experienced') || lower.includes('proven') || lower.includes('veteran')) {
    return { label: 'experienced', buyChanceMod: 0.02, agePreference: 'experienced', ratingWeight: 1.1, priceSensitivity: 1.0, ageSensitivity: -0.3 };
  }
  if (lower.includes('technical')) {
    return { label: 'technical', buyChanceMod: 0.0, agePreference: 'peak', ratingWeight: 1.2, priceSensitivity: 0.8, ageSensitivity: 0.8 };
  }
  if (lower.includes('athletic') || lower.includes('physical') || lower.includes('power')) {
    return { label: 'athletic', buyChanceMod: 0.02, agePreference: 'young', ratingWeight: 1.0, priceSensitivity: 0.9, ageSensitivity: 1.2 };
  }
  if (lower.includes('reliable') || lower.includes('system-fit')) {
    return { label: 'reliable', buyChanceMod: -0.02, agePreference: 'peak', ratingWeight: 0.9, priceSensitivity: 1.1, ageSensitivity: 0.7 };
  }

  return { label: 'balanced', buyChanceMod: 0.0, agePreference: 'neutral', ratingWeight: 1.0, priceSensitivity: 1.0, ageSensitivity: 1.0 };
};

const getAgeScore = (age: number, agePreference: ManagerIdentityProfile['agePreference']): number => {
  switch (agePreference) {
    case 'young':
      return age <= 23 ? 0 : (age - 23) * 2;
    case 'peak':
      return Math.abs(age - 28) * 0.5;
    case 'experienced':
      return age >= 28 ? 0 : (28 - age) * 1.5;
    default:
      return Math.max(0, age - 29);
  }
};

const calculateDestinationWage = (
  player: Player,
  buyerTeam: Team,
  allPlayers: Record<string, Player>,
  severity: PlanningSeverity
): number => {
  const buyerSquad = Object.values(allPlayers).filter(p => p.teamId === buyerTeam.id && p.id !== player.id);
  const avgWage = buyerSquad.length > 0
    ? buyerSquad.reduce((sum, p) => sum + p.wage, 0) / buyerSquad.length
    : player.wage;
  const avgRating = buyerSquad.length > 0
    ? buyerSquad.reduce((sum, p) => sum + p.overallRating, 0) / buyerSquad.length
    : player.overallRating;

  const ratingRatio = clamp(player.overallRating / Math.max(1, avgRating), 0.4, 2.5);
  const severityMultiplier = severity === 'urgent' ? 1.2 : severity === 'need' ? 1.08 : 1.0;
  const disciplineMultiplier = buyerTeam.boardProfile.transferDiscipline === 'strict'
    ? 0.92
    : buyerTeam.boardProfile.transferDiscipline === 'aggressive'
      ? 1.10
      : 1.0;

  const contextWage = avgWage * ratingRatio;
  const blendedWage = player.wage * 0.3 + contextWage * 0.7;

  return clamp(Math.round(blendedWage * severityMultiplier * disciplineMultiplier), 1, 500);
};

const determineRolePromise = (
  severity: PlanningSeverity,
  playerRating: number,
  buyerSquadAvgRating: number
): 'starter' | 'rotation' | 'squad' => {
  if (severity === 'urgent') return 'starter';
  if (severity === 'need') {
    return playerRating >= buyerSquadAvgRating ? 'starter' : 'rotation';
  }
  return 'squad';
};

const getBoardContext = (team: Team): AITransferDecision['boardContext'] => ({
  ambition: team.boardProfile.ambition,
  transferDiscipline: team.boardProfile.transferDiscipline,
  managerTransferIdentity: team.manager.transferIdentity,
});

const summarizeNeed = (need: ReturnType<typeof buildSquadPlan>['needs'][number]): AITransferDecision['squadNeed'] => ({
  position: need.position,
  severity: need.severity,
  currentDepth: need.currentDepth,
  targetDepth: need.targetDepth,
  reason: need.reason,
});

const getListingChanceMultiplier = (team: Team) => {
  const disciplineMultiplier = team.boardProfile.transferDiscipline === 'strict'
    ? 1.25
    : team.boardProfile.transferDiscipline === 'aggressive'
      ? 0.85
      : 1;
  const ambitionMultiplier = team.boardProfile.ambition === 'elite'
    ? 1.15
    : team.boardProfile.ambition === 'survival'
      ? 1.05
      : 1;
  return disciplineMultiplier * ambitionMultiplier;
};

const getBudgetLimitShare = (team: Team, severity: PlanningSeverity) => {
  const urgent = severity === 'urgent';
  const disciplineShare = team.boardProfile.transferDiscipline === 'strict'
    ? urgent ? 0.40 : 0.30
    : team.boardProfile.transferDiscipline === 'aggressive'
      ? urgent ? 0.70 : 0.60
      : urgent ? 0.58 : 0.45;
  const ambitionAdjustment =
    team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe'
      ? 0.05
      : team.boardProfile.ambition === 'promotion'
        ? 0.03
        : team.boardProfile.ambition === 'survival'
          ? -0.05
          : 0;
  return clamp(disciplineShare + ambitionAdjustment, 0.22, 0.75);
};

const getBuyChance = (team: Team, severity: PlanningSeverity, baseChance: number) => {
  const identityProfile = getManagerIdentityProfile(team.manager.transferIdentity);
  const disciplineAdjustment = team.boardProfile.transferDiscipline === 'strict'
    ? -0.08
    : team.boardProfile.transferDiscipline === 'aggressive'
      ? 0.08
      : 0;
  const ambitionAdjustment =
    team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe'
      ? 0.04
      : team.boardProfile.ambition === 'promotion'
        ? 0.03
        : team.boardProfile.ambition === 'survival'
          ? -0.03
          : 0;
  const severityAdjustment = severity === 'urgent' ? 0.12 : 0;
  return clamp(baseChance + disciplineAdjustment + ambitionAdjustment + severityAdjustment + identityProfile.buyChanceMod, 0.02, 0.9);
};

const getEffectiveRating = (player: Player) => {
  if (!player.matchRatingHistory || player.matchRatingHistory.length === 0) {
    return player.overallRating / 10;
  }
  const recentRatings = player.matchRatingHistory.slice(-5);
  return recentRatings.reduce((sum, rating) => sum + rating, 0) / recentRatings.length;
};

const expireAiTransferListings = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  userTeamId: string | null
) => {
  const aiTeamIds = new Set(Object.values(teams)
    .filter(team => team.id !== userTeamId)
    .map(team => team.id));
  let changed = false;
  const updatedPlayers = { ...players };

  Object.values(players).forEach(player => {
    if (!player.isTransferListed || !aiTeamIds.has(player.teamId)) return;
    updatedPlayers[player.id] = {
      ...player,
      isTransferListed: false,
      askingPrice: 0,
    };
    changed = true;
  });

  return changed ? updatedPlayers : players;
};

export const computeWeeklyTransfers = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  userTeamId: string | null,
  rng?: RandomGenerator,
  currentWeek?: number
): WeeklyTransferResult => {
  if (currentWeek !== undefined && !isTransferWindowOpen(currentWeek)) {
    return {
      players: expireAiTransferListings(players, teams, userTeamId),
      teams,
      decisions: [],
    };
  }

  const random = resolveRandom(rng);
  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };
  const decisions: AITransferDecision[] = [];

  const aiTeams = Object.values(updatedTeams).filter(t => t.id !== userTeamId);

  // Phase 1: All AI Teams evaluate their squads and list players
  aiTeams.forEach(team => {
    const squad = Object.values(updatedPlayers).filter(p => p.teamId === team.id);
    const squadPlan = buildSquadPlan(team, updatedPlayers);
    const needByPosition = squadPlan.needs.reduce<Record<PositionKey, typeof squadPlan.needs[number]>>((acc, need) => {
      acc[need.position] = need;
      return acc;
    }, {} as Record<PositionKey, typeof squadPlan.needs[number]>);
    const sortedByOverall = [...squad].sort((a, b) => b.overallRating - a.overallRating);
    const protectedPlayers = new Set([
      ...sortedByOverall.slice(0, 8).map(p => p.id),
      ...squad.filter(p => p.isStarting).map(p => p.id),
    ]);

    const depthByPosition = squad.reduce<Record<PositionKey, number>>((acc, player) => {
      acc[player.position] = (acc[player.position] || 0) + 1;
      return acc;
    }, { GK: 0, DEF: 0, MID: 0, FWD: 0 });
    
    const minDepth: Record<PositionKey, number> = { GK: 2, DEF: 6, MID: 6, FWD: 4 };

    squad.forEach(p => {
      if (protectedPlayers.has(p.id) || p.isTransferListed) return;
      const positionNeed = needByPosition[p.position];
      if (positionNeed && NEED_SEVERITY_VALUE[positionNeed.severity] >= NEED_SEVERITY_VALUE.need) return;

      let shouldList = false;
      let listReason = '';
      const minutesShare = Math.min(1, (p.minutesPlayed || 0) / (Math.max(1, team.played) * 90));
      const effectiveRating = getEffectiveRating(p);
      const contractDecision = squadPlan.contractDecisions.find(decision => decision.playerId === p.id);
      const listingChanceMultiplier = getListingChanceMultiplier(team);

      if (contractDecision?.decision === 'sell' || contractDecision?.decision === 'release') {
        shouldList = true;
        listReason = contractDecision.reason;
      } else if (
        minutesShare > ENGINE_CONFIG.TRANSFER_LIST_MIN_MINUTES_SHARE &&
        effectiveRating < 6.4 &&
        random() < clamp(ENGINE_CONFIG.TRANSFER_LIST_POOR_FORM_CHANCE * listingChanceMultiplier, 0, 0.9)
      ) {
        shouldList = true;
        listReason = `${p.name} has poor recent form and does not justify a protected squad role.`;
      } else if (p.age >= 30 && minutesShare < 0.15 && random() < clamp(ENGINE_CONFIG.TRANSFER_LIST_VETERAN_CHANCE * listingChanceMultiplier, 0, 0.9)) {
        shouldList = true;
        listReason = `${p.name} is an older low-minute player and can be moved without creating a depth need.`;
      } else if (!p.isStarting && random() < clamp(ENGINE_CONFIG.TRANSFER_LIST_BACKUP_CHANCE * listingChanceMultiplier, 0, 0.9)) {
        shouldList = true;
        listReason = `${p.name} is a backup outside the protected core and the board will listen to offers.`;
      }

      const minimumDepth = Math.max(positionNeed?.targetDepth || 0, minDepth[p.position] || 2);
      if (shouldList && (depthByPosition[p.position] || 0) > minimumDepth) {
        updatedPlayers[p.id] = { ...updatedPlayers[p.id], isTransferListed: true, askingPrice: p.marketValue };
        depthByPosition[p.position] = Math.max(0, (depthByPosition[p.position] || 0) - 1);
        decisions.push({
          week: currentWeek,
          action: 'listed',
          teamId: team.id,
          playerId: p.id,
          position: p.position,
          reason: listReason,
          squadNeed: positionNeed ? summarizeNeed(positionNeed) : undefined,
          contractDecision: contractDecision
            ? {
              decision: contractDecision.decision,
              priority: contractDecision.priority,
              reason: contractDecision.reason,
            }
            : undefined,
          boardContext: getBoardContext(team),
        });
      }
    });
  });

  // Global Listing Pool populated after all teams have registered their listings.
  // Exclude user-team players so AI never silently purchases a player the user listed
  // in the same weekly cycle.
  const globalListedPlayers = Object.values(updatedPlayers).filter(
    p => p.isTransferListed && p.teamId !== userTeamId
  );

  // Phase 2: All AI Teams attempt to satisfy their weaknesses from the Global Pool
  aiTeams.forEach(team => {
    const squadPlan = buildSquadPlan(team, updatedPlayers);
    const priorityNeed = [...squadPlan.needs]
      .filter(need => NEED_SEVERITY_VALUE[need.severity] >= NEED_SEVERITY_VALUE.need)
      .sort((a, b) => {
        const severityDelta = NEED_SEVERITY_VALUE[b.severity] - NEED_SEVERITY_VALUE[a.severity];
        if (severityDelta !== 0) return severityDelta;
        return (b.targetDepth - b.currentDepth) - (a.targetDepth - a.currentDepth);
      })[0];

    if (!priorityNeed) return;

    const budgetLimit = Math.max(0, updatedTeams[team.id].budget) * getBudgetLimitShare(team, priorityNeed.severity);

    // Filter available targets from the global pool (ensure target team hasn't been modified heavily or isn't the buyer)
    const targets = globalListedPlayers.filter(p =>
      p.teamId !== team.id &&
      p.position === priorityNeed.position &&
      p.askingPrice <= budgetLimit &&
      updatedPlayers[p.id]?.isTransferListed // Ensure another team didn't buy them in this loop
    );

    if (targets.length > 0) {
      const identityProfile = getManagerIdentityProfile(team.manager.transferIdentity);
      const buyerSquad = Object.values(updatedPlayers).filter(p => p.teamId === team.id);
      const buyerSquadAvgRating = buyerSquad.length > 0
        ? buyerSquad.reduce((sum, p) => sum + p.overallRating, 0) / buyerSquad.length
        : 70;

      const bestTarget = targets.sort((a, b) => {
        const aAgeScore = getAgeScore(a.age, identityProfile.agePreference);
        const bAgeScore = getAgeScore(b.age, identityProfile.agePreference);
        const aValue = a.overallRating * 3 * identityProfile.ratingWeight
          - a.askingPrice * identityProfile.priceSensitivity
          - aAgeScore * identityProfile.ageSensitivity;
        const bValue = b.overallRating * 3 * identityProfile.ratingWeight
          - b.askingPrice * identityProfile.priceSensitivity
          - bAgeScore * identityProfile.ageSensitivity;
        return bValue - aValue;
      })[0];

      const buyChanceBase = team.played < 10 ? ENGINE_CONFIG.TRANSFER_EARLY_BUY_CHANCE : ENGINE_CONFIG.TRANSFER_NORMAL_BUY_CHANCE;
      const buyChance = getBuyChance(team, priorityNeed.severity, buyChanceBase);
      
      if (random() < buyChance) {
        const rolePromise = determineRolePromise(priorityNeed.severity, bestTarget.overallRating, buyerSquadAvgRating);
        const newWage = calculateDestinationWage(bestTarget, updatedTeams[team.id], updatedPlayers, priorityNeed.severity);
        const moraleBase = rolePromise === 'starter' ? 75 : rolePromise === 'rotation' ? 65 : 55;

        const buyer = updatedTeams[team.id];
        updatedTeams[team.id] = {
          ...buyer,
          budget: buyer.budget - bestTarget.askingPrice,
          transferSpend: buyer.transferSpend + bestTarget.askingPrice,
        };

        const seller = updatedTeams[bestTarget.teamId];
        if (seller) {
          updatedTeams[bestTarget.teamId] = removePlayerFromTeamSelections(
            { ...seller, budget: seller.budget + bestTarget.askingPrice },
            bestTarget.id
          );
        }

        updatedPlayers[bestTarget.id] = {
          ...updatedPlayers[bestTarget.id],
          teamId: team.id,
          isTransferListed: false,
          askingPrice: 0,
          isStarting: false,
          isSub: false,
          wage: newWage,
          contractLeft: Math.max(updatedPlayers[bestTarget.id].contractLeft, 2),
          morale: Math.max(moraleBase, updatedPlayers[bestTarget.id].morale),
        };
        decisions.push({
          week: currentWeek,
          action: 'bought',
          teamId: team.id,
          playerId: bestTarget.id,
          fromTeamId: bestTarget.teamId,
          fee: bestTarget.askingPrice,
          position: bestTarget.position,
          reason: `${team.name} bought ${bestTarget.name} (${rolePromise}) because ${priorityNeed.reason}`,
          squadNeed: summarizeNeed(priorityNeed),
          boardContext: getBoardContext(team),
          rolePromise,
          newWage,
        });
      }
    }
  });

  // Phase 3: AI Teams evaluate user-listed players for purchase
  if (userTeamId) {
    const userListedPlayers = Object.values(updatedPlayers).filter(
      p => p.isTransferListed && p.teamId === userTeamId
    );

    if (userListedPlayers.length > 0) {
      aiTeams.forEach(team => {
        const squadPlan = buildSquadPlan(team, updatedPlayers);
        const priorityNeed = [...squadPlan.needs]
          .filter(need => NEED_SEVERITY_VALUE[need.severity] >= NEED_SEVERITY_VALUE.need)
          .sort((a, b) => {
            const severityDelta = NEED_SEVERITY_VALUE[b.severity] - NEED_SEVERITY_VALUE[a.severity];
            if (severityDelta !== 0) return severityDelta;
            return (b.targetDepth - b.currentDepth) - (a.targetDepth - a.currentDepth);
          })[0];

        if (!priorityNeed) return;

        const budgetLimit = Math.max(0, updatedTeams[team.id].budget) * getBudgetLimitShare(team, priorityNeed.severity);

        const matchingUserTargets = userListedPlayers.filter(p =>
          p.position === priorityNeed.position &&
          p.askingPrice <= budgetLimit &&
          updatedPlayers[p.id]?.isTransferListed
        );

        if (matchingUserTargets.length > 0) {
          const identityProfile = getManagerIdentityProfile(team.manager.transferIdentity);
          const buyerSquad = Object.values(updatedPlayers).filter(p => p.teamId === team.id);
          const buyerSquadAvgRating = buyerSquad.length > 0
            ? buyerSquad.reduce((sum, p) => sum + p.overallRating, 0) / buyerSquad.length
            : 70;

          const bestUserTarget = matchingUserTargets.sort((a, b) => {
            const aAgeScore = getAgeScore(a.age, identityProfile.agePreference);
            const bAgeScore = getAgeScore(b.age, identityProfile.agePreference);
            const aValue = a.overallRating * 3 * identityProfile.ratingWeight
              - a.askingPrice * identityProfile.priceSensitivity
              - aAgeScore * identityProfile.ageSensitivity;
            const bValue = b.overallRating * 3 * identityProfile.ratingWeight
              - b.askingPrice * identityProfile.priceSensitivity
              - bAgeScore * identityProfile.ageSensitivity;
            return bValue - aValue;
          })[0];

          const buyChanceBase = team.played < 10 ? ENGINE_CONFIG.TRANSFER_EARLY_BUY_CHANCE : ENGINE_CONFIG.TRANSFER_NORMAL_BUY_CHANCE;
          const buyChance = getBuyChance(team, priorityNeed.severity, buyChanceBase);

          if (random() < buyChance) {
            const rolePromise = determineRolePromise(priorityNeed.severity, bestUserTarget.overallRating, buyerSquadAvgRating);
            const newWage = calculateDestinationWage(bestUserTarget, updatedTeams[team.id], updatedPlayers, priorityNeed.severity);
            const moraleBase = rolePromise === 'starter' ? 75 : rolePromise === 'rotation' ? 65 : 55;

            const buyer = updatedTeams[team.id];
            updatedTeams[team.id] = {
              ...buyer,
              budget: buyer.budget - bestUserTarget.askingPrice,
              transferSpend: buyer.transferSpend + bestUserTarget.askingPrice,
            };

            const userTeam = updatedTeams[userTeamId];
            if (userTeam) {
              updatedTeams[userTeamId] = removePlayerFromTeamSelections(
                { ...userTeam, budget: userTeam.budget + bestUserTarget.askingPrice },
                bestUserTarget.id
              );
            }

            updatedPlayers[bestUserTarget.id] = {
              ...updatedPlayers[bestUserTarget.id],
              teamId: team.id,
              isTransferListed: false,
              askingPrice: 0,
              isStarting: false,
              isSub: false,
              wage: newWage,
              contractLeft: Math.max(updatedPlayers[bestUserTarget.id].contractLeft, 2),
              morale: Math.max(moraleBase, updatedPlayers[bestUserTarget.id].morale),
            };

            decisions.push({
              week: currentWeek,
              action: 'bought',
              teamId: team.id,
              playerId: bestUserTarget.id,
              fromTeamId: userTeamId,
              fee: bestUserTarget.askingPrice,
              position: bestUserTarget.position,
              reason: `${team.name} bought ${bestUserTarget.name} (${rolePromise}) from your club because ${priorityNeed.reason}`,
              squadNeed: summarizeNeed(priorityNeed),
              boardContext: getBoardContext(team),
              rolePromise,
              newWage,
            });
          }
        }
      });
    }
  }

  return { players: updatedPlayers, teams: updatedTeams, decisions };
};

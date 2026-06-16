import { Player, Team } from '../models/types';
import { removePlayerFromTeamSelections } from './formationMapUtils';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { RandomGenerator, resolveRandom } from './random';
import { buildSquadPlan } from './squadPlanningEngine';
import { isTransferWindowOpen } from '../utils/calendar';

type PositionKey = Player['position'];
type PlanningSeverity = 'none' | 'watch' | 'need' | 'urgent';

const NEED_SEVERITY_VALUE: Record<PlanningSeverity, number> = {
  none: 0,
  watch: 1,
  need: 2,
  urgent: 3,
};

const getEffectiveRating = (player: Player) => {
  if (!player.matchRatingHistory || player.matchRatingHistory.length === 0) {
    return player.overallRating / 10;
  }
  const recentRatings = player.matchRatingHistory.slice(-5);
  return recentRatings.reduce((sum, rating) => sum + rating, 0) / recentRatings.length;
};

export const computeWeeklyTransfers = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  userTeamId: string | null,
  rng?: RandomGenerator,
  currentWeek?: number
): { players: Record<string, Player>, teams: Record<string, Team> } => {
  if (currentWeek !== undefined && !isTransferWindowOpen(currentWeek)) {
    return { players, teams };
  }

  const random = resolveRandom(rng);
  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };

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
      const minutesShare = Math.min(1, (p.minutesPlayed || 0) / (Math.max(1, team.played) * 90));
      const effectiveRating = getEffectiveRating(p);
      const contractDecision = squadPlan.contractDecisions.find(decision => decision.playerId === p.id);

      if (contractDecision?.decision === 'sell' || contractDecision?.decision === 'release') {
        shouldList = true;
      } else if (minutesShare > ENGINE_CONFIG.TRANSFER_LIST_MIN_MINUTES_SHARE && effectiveRating < 6.4 && random() < ENGINE_CONFIG.TRANSFER_LIST_POOR_FORM_CHANCE) {
        shouldList = true;
      } else if (p.age >= 30 && minutesShare < 0.15 && random() < ENGINE_CONFIG.TRANSFER_LIST_VETERAN_CHANCE) {
        shouldList = true;
      } else if (!p.isStarting && random() < ENGINE_CONFIG.TRANSFER_LIST_BACKUP_CHANCE) {
        shouldList = true;
      }

      const minimumDepth = Math.max(positionNeed?.targetDepth || 0, minDepth[p.position] || 2);
      if (shouldList && (depthByPosition[p.position] || 0) > minimumDepth) {
        updatedPlayers[p.id] = { ...updatedPlayers[p.id], isTransferListed: true, askingPrice: p.marketValue };
        depthByPosition[p.position] = Math.max(0, (depthByPosition[p.position] || 0) - 1);
      }
    });
  });

  // Global Listing Pool populated after all teams have registered their listings
  const globalListedPlayers = Object.values(updatedPlayers).filter(p => p.isTransferListed);

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

    const budgetLimit = Math.max(0, updatedTeams[team.id].budget) * (priorityNeed.severity === 'urgent' ? 0.6 : 0.45);

    // Filter available targets from the global pool (ensure target team hasn't been modified heavily or isn't the buyer)
    const targets = globalListedPlayers.filter(p =>
      p.teamId !== team.id &&
      p.position === priorityNeed.position &&
      p.askingPrice <= budgetLimit &&
      updatedPlayers[p.id]?.isTransferListed // Ensure another team didn't buy them in this loop
    );

    if (targets.length > 0) {
      const bestTarget = targets.sort((a, b) => {
        const aValue = a.overallRating * 3 - a.askingPrice - Math.max(0, a.age - 29);
        const bValue = b.overallRating * 3 - b.askingPrice - Math.max(0, b.age - 29);
        return bValue - aValue;
      })[0];

      const buyChanceBase = team.played < 10 ? ENGINE_CONFIG.TRANSFER_EARLY_BUY_CHANCE : ENGINE_CONFIG.TRANSFER_NORMAL_BUY_CHANCE;
      const buyChance = priorityNeed.severity === 'urgent' ? Math.min(0.9, buyChanceBase + 0.12) : buyChanceBase;
      
      if (random() < buyChance) {
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
        };
      }
    }
  });

  return { players: updatedPlayers, teams: updatedTeams };
};

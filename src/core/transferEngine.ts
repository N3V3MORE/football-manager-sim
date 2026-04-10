import { Player, Team } from '../models/types';
import { removePlayerFromTeamSelections } from './formationMapUtils';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { RandomGenerator, resolveRandom } from './random';

type PositionKey = Player['position'];

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
  rng?: RandomGenerator
): { players: Record<string, Player>, teams: Record<string, Team> } => {
  const random = resolveRandom(rng);
  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };

  const aiTeams = Object.values(updatedTeams).filter(t => t.id !== userTeamId);

  // Phase 1: All AI Teams evaluate their squads and list players
  aiTeams.forEach(team => {
    const squad = Object.values(updatedPlayers).filter(p => p.teamId === team.id);
    const sortedByOverall = [...squad].sort((a, b) => b.overallRating - a.overallRating);
    const protectedPlayers = new Set([
      ...sortedByOverall.slice(0, 8).map(p => p.id),
      ...squad.filter(p => p.isStarting).map(p => p.id),
    ]);

    const depthByPosition = squad.reduce<Record<PositionKey, number>>((acc, player) => {
      if (!player.isTransferListed) acc[player.position] = (acc[player.position] || 0) + 1;
      return acc;
    }, { GK: 0, DEF: 0, MID: 0, FWD: 0 });
    
    const minDepth: Record<PositionKey, number> = { GK: 2, DEF: 6, MID: 6, FWD: 4 };

    squad.forEach(p => {
      if (protectedPlayers.has(p.id) || p.isTransferListed) return;

      let shouldList = false;
      const minutesShare = (p.minutesPlayed || 0) / (Math.max(1, team.played) * 90);
      const effectiveRating = getEffectiveRating(p);

      if (minutesShare > ENGINE_CONFIG.TRANSFER_LIST_MIN_MINUTES_SHARE && effectiveRating < 6.4 && random() < ENGINE_CONFIG.TRANSFER_LIST_POOR_FORM_CHANCE) {
        shouldList = true;
      } else if (p.age >= 30 && minutesShare < 0.15 && random() < ENGINE_CONFIG.TRANSFER_LIST_VETERAN_CHANCE) {
        shouldList = true;
      } else if (!p.isStarting && random() < ENGINE_CONFIG.TRANSFER_LIST_BACKUP_CHANCE) {
        shouldList = true;
      }

      if (shouldList && (depthByPosition[p.position] || 0) > (minDepth[p.position] || 2)) {
        updatedPlayers[p.id] = { ...updatedPlayers[p.id], isTransferListed: true, askingPrice: p.marketValue };
        depthByPosition[p.position] = Math.max(0, (depthByPosition[p.position] || 0) - 1);
      }
    });
  });

  // Global Listing Pool populated after all teams have registered their listings
  const globalListedPlayers = Object.values(updatedPlayers).filter(p => p.isTransferListed && p.teamId !== userTeamId);

  // Phase 2: All AI Teams attempt to satisfy their weaknesses from the Global Pool
  aiTeams.forEach(team => {
    const squad = Object.values(updatedPlayers).filter(p => p.teamId === team.id);
    const starters = squad.filter(p => p.isStarting).sort((a, b) => b.overallRating - a.overallRating);
    if (starters.length === 0) return;

    const starterByPosition: Record<PositionKey, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    starters.forEach(player => starterByPosition[player.position].push(player));

    const weakestPosition = (Object.keys(starterByPosition) as (keyof typeof starterByPosition)[])
      .map(position => ({
        position,
        weakest: starterByPosition[position].sort((a, b) => a.overallRating - b.overallRating)[0],
        depth: starterByPosition[position].length,
      }))
      .filter(item => Boolean(item.weakest))
      .sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return (a.weakest?.overallRating || 0) - (b.weakest?.overallRating || 0);
      })[0];

    if (!weakestPosition?.weakest) return;
    
    const weakestStarter = weakestPosition.weakest;
    const requiredUpgrade = weakestStarter.overallRating + 2;
    const budgetLimit = updatedTeams[team.id].budget * 0.45;

    // Filter available targets from the global pool (ensure target team hasn't been modified heavily or isn't the buyer)
    const targets = globalListedPlayers.filter(p =>
      p.teamId !== team.id &&
      p.position === weakestPosition.position &&
      p.overallRating >= requiredUpgrade &&
      p.askingPrice <= budgetLimit &&
      updatedPlayers[p.id]?.isTransferListed // Ensure another team didn't buy them in this loop
    );

    if (targets.length > 0) {
      const bestTarget = targets.sort((a, b) => {
        const aValue = (a.overallRating - weakestStarter.overallRating) * 3 - a.askingPrice;
        const bValue = (b.overallRating - weakestStarter.overallRating) * 3 - b.askingPrice;
        return bValue - aValue;
      })[0];

      const buyChance = team.played < 10 ? ENGINE_CONFIG.TRANSFER_EARLY_BUY_CHANCE : ENGINE_CONFIG.TRANSFER_NORMAL_BUY_CHANCE;
      
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

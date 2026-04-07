import { Player, Team } from '../models/types';
import { removePlayerFromTeamSelections } from './formationMapUtils';

export const computeWeeklyTransfers = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  userTeamId: string | null
): { players: Record<string, Player>, teams: Record<string, Team> } => {
  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };

  const aiTeams = Object.values(updatedTeams).filter(t => t.id !== userTeamId);

  aiTeams.forEach(team => {
    const squad = Object.values(updatedPlayers).filter(p => p.teamId === team.id);

    const sortedByOverall = [...squad].sort((a, b) => b.overallRating - a.overallRating);
    const protectedPlayers = new Set([
      ...sortedByOverall.slice(0, 8).map(p => p.id),
      ...squad.filter(p => p.isStarting).map(p => p.id),
    ]);

    const squadWithRatings = squad.map(p => {
      let avgRating = p.overallRating / 10;
      if (p.matchRatingHistory && p.matchRatingHistory.length > 0) {
        const recentRatings = p.matchRatingHistory.slice(-5);
        avgRating = recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length;
      }
      return { ...p, effectiveRating: avgRating };
    });

    const getDepth = (pos: string) => Object.values(updatedPlayers)
      .filter(p => p.teamId === team.id && p.position === pos && !p.isTransferListed)
      .length;
    const minDepth: Record<string, number> = { 'GK': 2, 'DEF': 6, 'MID': 6, 'FWD': 4 };

    squadWithRatings.forEach(p => {
      if (protectedPlayers.has(p.id) || p.isTransferListed) return;

      let shouldList = false;
      const minutesShare = (p.minutesPlayed || 0) / (Math.max(1, team.played) * 90);
      if (minutesShare > 0.3 && p.effectiveRating < 6.4 && Math.random() < 0.45) shouldList = true;
      else if (p.age >= 30 && minutesShare < 0.15 && Math.random() < 0.18) shouldList = true;
      else if (!p.isStarting && Math.random() < 0.03) shouldList = true;

      if (shouldList && getDepth(p.position) > (minDepth[p.position] || 2)) {
        updatedPlayers[p.id] = { ...updatedPlayers[p.id], isTransferListed: true, askingPrice: p.marketValue };
      }
    });

    const listedPlayers = Object.values(updatedPlayers).filter(p => p.isTransferListed && p.teamId !== userTeamId);
    const starters = squad
      .filter(p => p.isStarting)
      .sort((a, b) => b.overallRating - a.overallRating);
    if (starters.length === 0) return;

    const starterByPosition: Record<string, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    starters.forEach(player => {
      starterByPosition[player.position].push(player);
    });
    (Object.keys(starterByPosition) as (keyof typeof starterByPosition)[]).forEach(position => {
      starterByPosition[position].sort((a, b) => a.overallRating - b.overallRating);
    });

    const weakestPosition = (Object.keys(starterByPosition) as (keyof typeof starterByPosition)[])
      .map(position => ({
        position,
        weakest: starterByPosition[position][0],
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
    const budgetLimit = team.budget * 0.45;
    const targets = listedPlayers.filter(p =>
      p.teamId !== team.id &&
      p.position === weakestPosition.position &&
      p.overallRating >= requiredUpgrade &&
      p.askingPrice <= budgetLimit
    );

    if (targets.length > 0) {
      const target = targets.sort((a, b) => {
        const aValue = (a.overallRating - weakestStarter.overallRating) * 3 - a.askingPrice;
        const bValue = (b.overallRating - weakestStarter.overallRating) * 3 - b.askingPrice;
        return bValue - aValue;
      })[0];
      const buyChance = team.played < 10 ? 0.15 : 0.35;
      if (Math.random() < buyChance) {
        const buyer = updatedTeams[team.id];
        updatedTeams[team.id] = { ...buyer, budget: buyer.budget - target.askingPrice };

        const seller = updatedTeams[target.teamId];
        if (seller) {
          updatedTeams[target.teamId] = removePlayerFromTeamSelections(
            { ...seller, budget: seller.budget + target.askingPrice },
            target.id
          );
        }
        updatedPlayers[target.id] = {
          ...updatedPlayers[target.id],
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

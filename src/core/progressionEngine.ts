import { Player, Team, Fixture } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';

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
      
      // 1. Importance System: Top 5 players by overall rating are 'untouchable'
      const sortedByOverall = [...squad].sort((a, b) => b.overallRating - a.overallRating);
      const untouchables = new Set(sortedByOverall.slice(0, 5).map(p => p.id));

      // 2. Calculate Effective Rating
      const squadWithRatings = squad.map(p => {
        let avgRating = p.overallRating / 10; // Fallback e.g. 75 -> 7.5
        if (p.matchRatingHistory && p.matchRatingHistory.length > 0) {
          const recentRatings = p.matchRatingHistory.slice(-5); // last 5 games
          avgRating = recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length;
        }
        return { ...p, effectiveRating: avgRating };
      });

      // 3. Depth check helper
      const getDepth = (pos: string) => squad.filter(p => p.position === pos && !p.isTransferListed).length;
      const minDepth: Record<string, number> = { 'GK': 2, 'DEF': 6, 'MID': 6, 'FWD': 4 };

      // 4. List poor performers (Effective rating < 6.5 or random bench warmers)
      squadWithRatings.forEach(p => {
        if (untouchables.has(p.id) || p.isTransferListed) return;

        let shouldList = false;
        // If they play a lot and suck
        if (p.minutesPlayed > 270 && p.effectiveRating < 6.4 && Math.random() < 0.5) shouldList = true;
        // Random bench warmer listing
        else if (!p.isStarting && Math.random() < 0.05) shouldList = true;

        if (shouldList && getDepth(p.position) > (minDepth[p.position] || 2)) {
          updatedPlayers[p.id] = { ...updatedPlayers[p.id], isTransferListed: true, askingPrice: p.marketValue };
        }
      });

      // --- AI BUYING LOGIC ---
      const listedPlayers = Object.values(updatedPlayers).filter(p => p.isTransferListed && p.teamId !== userTeamId);
      const starters = squad.filter(p => p.isStarting);
      if (starters.length === 0) return;
      
      const weakestStarter = starters.sort((a, b) => a.overallRating - b.overallRating)[0];
      
      const targets = listedPlayers.filter(p => 
        (p.position === weakestStarter.position || p.subPosition === weakestStarter.subPosition) && 
        p.overallRating > weakestStarter.overallRating && 
        team.budget >= p.askingPrice &&
        p.teamId !== team.id
      );
      
      if (targets.length > 0) {
        const target = targets.sort((a,b) => b.overallRating - a.overallRating)[0];
        // Only buy if it's a decent upgrade
        if (Math.random() < 0.3) {
            const buyer = updatedTeams[team.id];
            updatedTeams[team.id] = { ...buyer, budget: buyer.budget - target.askingPrice };
            
            const seller = updatedTeams[target.teamId];
            if (seller) {
              updatedTeams[target.teamId] = { ...seller, budget: seller.budget + target.askingPrice };
            }
            updatedPlayers[target.id] = { ...updatedPlayers[target.id], teamId: team.id, isTransferListed: false, askingPrice: 0, isStarting: false, isSub: false };
        }
      }
  });

  return { players: updatedPlayers, teams: updatedTeams };
};

export const computeWeeklyProgression = (
  currentWeek: number,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>,
  oldNews: string[]
): { players: Record<string, Player>, teams: Record<string, Team>, currentWeek: number, news: string[] } => {
  const playedFixtures = Object.values(fixtures).filter(f => f.week === currentWeek);
  const newNews: string[] = [];

  const bigWins = playedFixtures.filter(f => Math.abs((f.homeScore ?? 0) - (f.awayScore ?? 0)) >= 3);
  if (bigWins.length > 0) {
    const f = bigWins[Math.floor(Math.random() * bigWins.length)];
    const winner = (f.homeScore! > f.awayScore!) ? teams[f.homeTeamId] : teams[f.awayTeamId];
    const loser  = (f.homeScore! > f.awayScore!) ? teams[f.awayTeamId] : teams[f.homeTeamId];
    const ws = Math.max(f.homeScore!, f.awayScore!);
    const ls = Math.min(f.homeScore!, f.awayScore!);
    newNews.push(`${winner.name} thrashes ${loser.name} ${ws}-${ls}!`);
  }

  const allPlayers = Object.values(players);
  const updatedPlayers = { ...players };
  allPlayers.forEach(p => {
      const newEnergy = Math.min(100, p.energy + ENGINE_CONFIG.WEEKLY_ENERGY_RECOVERY);
      const newSusp = Math.max(0, p.matchesSuspended - 1);
      if (newEnergy !== p.energy || newSusp !== p.matchesSuspended) {
        updatedPlayers[p.id] = { ...p, energy: newEnergy, matchesSuspended: newSusp };
      }
  });

  // Finance updates
  const updatedTeams = { ...teams };
  Object.values(updatedTeams).forEach(team => {
      // Calculate weekly wages
      const teamPlayers = allPlayers.filter(p => p.teamId === team.id);
      const weeklyWageTotalThousand = teamPlayers.reduce((sum, p) => sum + (p.wage || 0), 0);
      // 1000k = 1M
      const wageCostM = weeklyWageTotalThousand / 1000;
      let newBudget = team.budget - wageCostM;

      // Matchday revenue if they were home
      const homeFix = playedFixtures.find(f => f.homeTeamId === team.id);
      if (homeFix) {
        const revenueM = 1.0 + (team.points * 0.05); // Basic form-based revenue
        newBudget += revenueM;
      }
      
      updatedTeams[team.id] = { ...team, budget: newBudget };
  });

  const sortedByGoals = [...allPlayers].sort((a, b) => b.goals - a.goals);
  if (sortedByGoals.length > 0 && sortedByGoals[0].goals > 0) {
    const top = sortedByGoals[0];
    newNews.push(`${top.name} (${teams[top.teamId]?.name}) leads the golden boot with ${top.goals} goals.`);
    if (Math.random() > 0.5 && sortedByGoals.length > 2) {
      const other = sortedByGoals[1 + Math.floor(Math.random() * 3)];
      if (other && other.goals > 0) {
        newNews.push(`${other.name} continues his excellent form for ${teams[other.teamId]?.name}!`);
      }
    }
  } else if (playedFixtures.length > 0) {
    newNews.push(`Week ${currentWeek} concludes with intense scenes across the league.`);
  }

  if (currentWeek === 38) {
      Object.values(updatedPlayers).forEach(p => {
        if (p.age <= 24) {
            p.overallRating += Math.floor(Math.random() * 3) + 1; // +1 to +3
        } else if (p.age >= 32) {
            p.overallRating -= Math.floor(Math.random() * 2); // 0 to -1
        }
        p.age += 1;
        p.contractLeft = Math.max(0, p.contractLeft - 1);
      });
      newNews.push('The season has concluded! Check your squad for player growth and updates.');
  }

  return {
    currentWeek: currentWeek + 1,
    news: [...newNews, ...oldNews].slice(0, 20),
    players: updatedPlayers,
    teams: updatedTeams,
  };
};

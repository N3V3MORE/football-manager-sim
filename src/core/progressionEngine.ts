import { Player, Team, Fixture, Formation } from '../models/types';
import { ENGINE_CONFIG } from '../config/engineConfig';
import { getSlotsForFormation } from '../constants/formations';

const ADAPTIVE_FORMATIONS: Formation[] = [
  '4-3-3',
  '4-2-3-1',
  '4-4-2',
  '4-1-4-1',
  '4-3-2-1',
  '3-5-2',
  '5-2-3',
];

const scoreFormationFit = (players: Player[], formation: Formation) => {
  const slots = getSlotsForFormation(formation).flat();
  const available = [...players]
    .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1));
  const used = new Set<string>();
  let score = 0;

  slots.forEach(slot => {
    const candidates = available.filter(player => !used.has(player.id));
    if (candidates.length === 0) {
      score -= 35;
      return;
    }
    const picked = candidates
      .map(player => {
        let fit = player.overallRating + player.energy * 0.2;
        if (player.subPosition === slot.label) fit += 18;
        else if (player.altPositions?.includes(slot.label)) fit += 10;
        if (player.position === slot.pos) fit += 8;
        else fit -= 6;
        return { player, fit };
      })
      .sort((a, b) => b.fit - a.fit)[0];
    used.add(picked.player.id);
    score += picked.fit;
  });

  const cbDepth = players.filter(player => (player.subPosition || '').toUpperCase().includes('CB')).length;
  const wbDepth = players.filter(player => {
    const raw = (player.subPosition || '').toUpperCase();
    return raw.includes('WB') || raw === 'LM' || raw === 'RM' || raw === 'LB' || raw === 'RB';
  }).length;
  if (formation.startsWith('3') && cbDepth < 3) score -= 24;
  if (formation.startsWith('5') && wbDepth < 2) score -= 10;
  return score;
};

const pickAdaptiveFormation = (
  team: Team,
  players: Player[],
  mode: 'attack' | 'defense' | 'stable'
): Formation | null => {
  const modePool: Formation[] = mode === 'defense'
    ? ['5-2-3', '3-5-2', '4-1-4-1', '4-4-2']
    : mode === 'attack'
      ? ['4-3-3', '4-2-3-1', '3-5-2', '4-3-2-1']
      : ADAPTIVE_FORMATIONS;
  const formationScores = modePool.map(formation => {
    let bias = 0;
    if (mode === 'defense') {
      if (formation.startsWith('5')) bias += 18;
      if (formation === '3-5-2') bias += 10;
      if (formation === '4-1-4-1') bias += 8;
    } else if (mode === 'attack') {
      if (formation === '4-3-3' || formation === '4-2-3-1') bias += 12;
      if (formation === '3-5-2') bias += 8;
    }
    return { formation, score: scoreFormationFit(players, formation) + bias };
  }).sort((a, b) => b.score - a.score);

  const best = formationScores[0];
  if (!best || best.formation === team.activeFormation) return null;
  const currentScore = scoreFormationFit(players, team.activeFormation);
  if (mode === 'defense' && team.activeFormation.startsWith('4')) {
    const backFive = formationScores.find(row => row.formation.startsWith('5'));
    if (backFive && backFive.formation !== team.activeFormation && backFive.score >= currentScore - 6) {
      return backFive.formation;
    }
  }
  const minDelta = mode === 'stable' ? 12 : 6;
  const changeChance = mode === 'stable' ? 0.35 : 0.7;
  if (best.score - currentScore >= minDelta && Math.random() < changeChance) return best.formation;
  if (mode !== 'stable' && Math.random() < 0.16) return best.formation;
  return null;
};

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
      
      // 1. Importance System: protect the core squad from random AI churn
      const sortedByOverall = [...squad].sort((a, b) => b.overallRating - a.overallRating);
      const protectedPlayers = new Set([
        ...sortedByOverall.slice(0, 8).map(p => p.id),
        ...squad.filter(p => p.isStarting).map(p => p.id),
      ]);

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
      const getDepth = (pos: string) => Object.values(updatedPlayers)
        .filter(p => p.teamId === team.id && p.position === pos && !p.isTransferListed)
        .length;
      const minDepth: Record<string, number> = { 'GK': 2, 'DEF': 6, 'MID': 6, 'FWD': 4 };

      // 4. List poor performers (Effective rating < 6.5 or random bench warmers)
      squadWithRatings.forEach(p => {
        if (protectedPlayers.has(p.id) || p.isTransferListed) return;

        let shouldList = false;
        const minutesShare = (p.minutesPlayed || 0) / (Math.max(1, team.played) * 90);
        // If they play a lot and suck
        if (minutesShare > 0.3 && p.effectiveRating < 6.4 && Math.random() < 0.45) shouldList = true;
        // Older squad players with low usage are more likely to be listed.
        else if (p.age >= 30 && minutesShare < 0.15 && Math.random() < 0.18) shouldList = true;
        // Random bench warmer listing
        else if (!p.isStarting && Math.random() < 0.03) shouldList = true;

        if (shouldList && getDepth(p.position) > (minDepth[p.position] || 2)) {
          updatedPlayers[p.id] = { ...updatedPlayers[p.id], isTransferListed: true, askingPrice: p.marketValue };
        }
      });

      // --- AI BUYING LOGIC ---
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

  // Tactical adaptation with cooldown and stepwise changes to reduce weekly flip-flopping.
  Object.values(updatedTeams).forEach(team => {
    if (team.played < 6 || team.played % 3 !== 0) return;
    const recentForm = (team.form || []).slice(-5);
    const wins = recentForm.filter(token => token === 'W').length;
    const losses = recentForm.filter(token => token === 'L').length;
    const goalsForPerGame = team.played > 0 ? team.goalsFor / team.played : 0;
    const goalsAgainstPerGame = team.played > 0 ? team.goalsAgainst / team.played : 0;
    const nextTactics = { ...team.tactics };
    let changed = false;
    let adaptationChance = 0;
    let formationMode: 'attack' | 'defense' | 'stable' | null = null;

    const nudgeMentality = (target: 'Defensive' | 'Balanced' | 'Attacking') => {
      if (nextTactics.mentality === target) return;
      if (target === 'Attacking' && nextTactics.mentality === 'Defensive') {
        nextTactics.mentality = 'Balanced';
      } else if (target === 'Defensive' && nextTactics.mentality === 'Attacking') {
        nextTactics.mentality = 'Balanced';
      } else {
        nextTactics.mentality = target;
      }
      changed = true;
    };

    if (losses >= 3 && goalsAgainstPerGame > 1.75 && goalsForPerGame < 1.2) {
      nudgeMentality('Balanced');
      if (nextTactics.defensiveLine === 'High') { nextTactics.defensiveLine = 'Standard'; changed = true; }
      if (nextTactics.pressing === 'High') { nextTactics.pressing = 'Medium'; changed = true; }
      if (nextTactics.tempo === 'Fast') { nextTactics.tempo = 'Normal'; changed = true; }
      adaptationChance = 0.8;
      formationMode = 'defense';
    } else if (losses >= 3 && goalsAgainstPerGame > 1.7) {
      nudgeMentality('Defensive');
      if (nextTactics.defensiveLine !== 'Deep') { nextTactics.defensiveLine = 'Deep'; changed = true; }
      if (nextTactics.pressing === 'High') { nextTactics.pressing = 'Medium'; changed = true; }
      if (nextTactics.tempo === 'Fast') { nextTactics.tempo = 'Normal'; changed = true; }
      adaptationChance = 0.72;
      formationMode = 'defense';
    } else if (losses >= 3 && goalsForPerGame < 1.1) {
      nudgeMentality('Attacking');
      if (nextTactics.tempo === 'Slow') { nextTactics.tempo = 'Normal'; changed = true; }
      if (nextTactics.passingStyle === 'Short') { nextTactics.passingStyle = 'Mixed'; changed = true; }
      if (nextTactics.pressing === 'None') { nextTactics.pressing = 'Medium'; changed = true; }
      adaptationChance = 0.72;
      formationMode = 'attack';
    } else if (wins >= 3 && losses <= 1 && goalsForPerGame > 1.6 && goalsAgainstPerGame < 1.3) {
      nudgeMentality('Balanced');
      if (nextTactics.defensiveLine === 'Deep') { nextTactics.defensiveLine = 'Standard'; changed = true; }
      if (nextTactics.pressing === 'None') { nextTactics.pressing = 'Medium'; changed = true; }
      adaptationChance = 0.5;
      formationMode = 'stable';
    }

    const canApplyTactics = changed && Math.random() < adaptationChance;
    let nextTeam = updatedTeams[team.id];
    let teamChanged = false;
    if (canApplyTactics) {
      nextTeam = { ...nextTeam, tactics: nextTactics };
      teamChanged = true;
    }

    const shouldTryFormationChange = Boolean(
      formationMode &&
      (formationMode === 'defense' ? team.played % 2 === 0 : team.played % 4 === 0)
    );
    if (shouldTryFormationChange) {
      const teamPlayers = Object.values(updatedPlayers)
        .filter(player => player.teamId === team.id && player.matchesSuspended === 0);
      const candidate = pickAdaptiveFormation(nextTeam, teamPlayers, formationMode!);
      if (candidate && candidate !== nextTeam.activeFormation) {
        nextTeam = { ...nextTeam, activeFormation: candidate };
        teamChanged = true;
      }
    }

    if (teamChanged) {
      updatedTeams[team.id] = nextTeam;
    }
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
        let overallRating = p.overallRating;
        if (p.age <= 24) {
            overallRating += Math.floor(Math.random() * 3) + 1; // +1 to +3
        } else if (p.age >= 32) {
            overallRating -= Math.floor(Math.random() * 2); // 0 to -1
        }
        updatedPlayers[p.id] = {
          ...p,
          overallRating,
          age: p.age + 1,
          contractLeft: Math.max(0, p.contractLeft - 1),
        };
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

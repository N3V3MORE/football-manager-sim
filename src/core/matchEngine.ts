import { Team, Player, Fixture } from '../models/types';
import { getSlotsForFormation } from '../constants/formations';
import { ENGINE_CONFIG } from '../config/engineConfig';

// ─── Support: Auto-assign best XI for AI or simulated matches ────────────────
export const autoAssignLineup = (teamId: string, players: Record<string, Player>, formation: string) => {
  const teamPlayers = Object.values(players)
    .filter(p => p.teamId === teamId)
    .sort((a, b) => b.overallRating - a.overallRating);

  const slots = getSlotsForFormation(formation);
  const assignedIds = new Set<string>();
  const updates: Record<string, Partial<Player>> = {};

  // Reset all
  teamPlayers.forEach(p => {
    updates[p.id] = { isStarting: false, isSub: false };
  });

  slots.forEach((row) => {
    row.forEach((slot) => {
      let candidate = teamPlayers.find(p => p.subPosition === slot.label && !assignedIds.has(p.id) && (p.matchesSuspended || 0) === 0);
      if (!candidate) candidate = teamPlayers.find(p => p.position === slot.pos && !assignedIds.has(p.id) && (p.matchesSuspended || 0) === 0);
      if (!candidate) candidate = teamPlayers.find(p => !assignedIds.has(p.id) && (p.matchesSuspended || 0) === 0);

      if (candidate) {
        updates[candidate.id] = { isStarting: true, isSub: false };
        assignedIds.add(candidate.id);
      }
    });
  });

  return updates;
};

export const runDuel = (att: number, def: number, luck: number = 30) => {
  const compress = (s: number) => (s <= ENGINE_CONFIG.STAT_COMPRESSION_BASE ? s : ENGINE_CONFIG.STAT_COMPRESSION_BASE + (s - ENGINE_CONFIG.STAT_COMPRESSION_BASE) * ENGINE_CONFIG.STAT_COMPRESSION_FACTOR);
  const rollA = compress(att) + (Math.random() * 2 - 1) * luck;
  const rollB = compress(def) + (Math.random() * 2 - 1) * luck;
  return rollA > rollB;
};

// ─── Tier 3 Match Engine Phase Simulation ────────────────────────────────────
export const simulatePossession = (
  attacker: Team, 
  defender: Team, 
  attPlayers: Player[], 
  defPlayers: Player[],
  attackerGoals: number, // Track current match score
  defenderGoals: number
): { goal: boolean; scorer?: Player; assister?: Player; event: string | null; foul?: { player: Player; type: 'Y' | 'R' } } => {
  
  const midAtt = attPlayers.filter(p => p.position === 'MID');
  const midDef = defPlayers.filter(p => p.position === 'MID');
  const fwdAtt = attPlayers.filter(p => p.position === 'FWD');
  const defDef = defPlayers.filter(p => p.position === 'DEF');
  const gkDef  = defPlayers.filter(p => p.position === 'GK');

  if (attPlayers.length === 0 || defPlayers.length === 0) return { goal: false, event: null };

  // --- Tactical Multipliers ---
  let passBonus = 1.0;
  let shootingBonus = 1.0;
  let defBonus = 1.0;
  let throughBallChance = 0.4; 

  const aTac = attacker.tactics;
  const dTac = defender.tactics;

  // Mentality
  if (aTac.mentality === 'Attacking') { shootingBonus *= 1.1; passBonus *= 1.05; defBonus *= 0.9; }
  if (aTac.mentality === 'Defensive') { defBonus *= 1.25; shootingBonus *= 0.8; passBonus *= 1.1; }

  // Passing Style (Rock-Paper-Scissors vs Line height)
  if (aTac.passingStyle === 'Short') { passBonus *= 1.15; throughBallChance = 0.25; }
  if (aTac.passingStyle === 'Direct') { passBonus *= 0.85; throughBallChance = 0.8; }

  // Defensive Line height multipliers
  const isHighLine = dTac.defensiveLine === 'High';
  const isDeepLine = dTac.defensiveLine === 'Deep';

  // Anti-Steamroll
  if (attackerGoals - defenderGoals >= ENGINE_CONFIG.STEAMROLL_MARGIN_1) defBonus *= ENGINE_CONFIG.STEAMROLL_BONUS_1; 
  if (attackerGoals - defenderGoals >= ENGINE_CONFIG.STEAMROLL_MARGIN_2) defBonus *= ENGINE_CONFIG.STEAMROLL_BONUS_2; 

  // Chance a possession is interesting
  if (Math.random() > ENGINE_CONFIG.BIG_MOMENT_CHANCE) return { goal: false, event: null };

  // Phase 1: Midfield Build-up
  // Use a weighted midfielder passing vs defender/midfielder average defending
  const activeMid = midAtt.length > 0 
    ? midAtt[Math.floor(Math.random() * midAtt.length)] 
    : (attPlayers.find(p => p.position === 'DEF') || attPlayers[0]);
    
  const defensiveWall = [...midDef, ...defDef];
  const midDefending = defensiveWall.length > 0 
    ? defensiveWall.reduce((sum, p) => sum + (p.stats.defending || 50), 0) / defensiveWall.length
    : 50;
  
  let interceptBonus = isHighLine ? 1.15 : (isDeepLine ? 0.92 : 1.0);

  // UNDERDOG BUFF: Small chance every build-up works regardless of stats (Chaos factor)
  if (Math.random() > 0.08) {
    if (!runDuel(activeMid.stats.passing * passBonus * 1.1, midDefending * interceptBonus, ENGINE_CONFIG.DUEL_LUCK_MIDFIELD)) {
      return { goal: false, event: null }; 
    }
  }

  // Phase 2: Final Third / Chance Creation
  const activeAttacker = [...fwdAtt, ...midAtt].length > 0 
    ? [...fwdAtt, ...midAtt][Math.floor(Math.random() * (fwdAtt.length + midAtt.length))] 
    : attPlayers[0];
    
  const activeDefender = defDef.length > 0 
    ? defDef[Math.floor(Math.random() * defDef.length)] 
    : defPlayers[0];

  const isAttackerImpact = (activeAttacker.impactCoefficient || 1) >= 1.35 && Math.random() < 0.05;
  const isDefenderImpact = (activeDefender.impactCoefficient || 1) >= 1.35 && Math.random() * 1.2 < 0.05;

  const isThroughBall = activeAttacker.stats.passing > 70 && Math.random() < throughBallChance;
  let attackStat = isThroughBall ? (activeAttacker.stats.passing * 1.1) : (activeAttacker.stats.dribbling || 70);
  
  if (isAttackerImpact) attackStat *= 1.3;
  attackStat *= passBonus;
  
  let currentDefStat = (activeDefender.stats.defending || 60) * defBonus;
  if (isDefenderImpact) currentDefStat *= 1.3;
  
  if (isThroughBall && isHighLine) currentDefStat *= 0.75;
  if (isThroughBall && isDeepLine) currentDefStat *= 1.15;

  if (!runDuel(attackStat, currentDefStat, ENGINE_CONFIG.DUEL_LUCK_ATTACK)) {
    if (isDefenderImpact) {
      return { goal: false, event: `🛡️ BRILLIANT DEFENDING! ${activeDefender.name} pulls off a last-ditch slide tackle!` };
    }
    if (Math.random() < ENGINE_CONFIG.FOUL_CHANCE) {
      const type = Math.random() < ENGINE_CONFIG.RED_CARD_CHANCE ? 'R' : 'Y';
      return { goal: false, event: `💥 CRUNCHING TACKLE! ${activeDefender.name} stops ${activeAttacker.name} but sees ${type === 'R' ? '🟥 RED' : '🟨 YELLOW'}!`, foul: { player: activeDefender, type } };
    }
    return { goal: false, event: null };
  }

  // Phase 3: Finishing
  const gk = gkDef[0] || defPlayers[0];
  const isGkImpact = (gk.impactCoefficient || 1) >= 1.35 && Math.random() < 0.05;
  
  let shotStat = (activeAttacker.stats.shooting || 70) * 1.1 * shootingBonus;
  if (isAttackerImpact) shotStat *= 1.3;

  let reflexStat = (gk.stats.gk_reflexes || gk.stats.defending || 50);
  if (isGkImpact) reflexStat *= 1.4;

  const shotSuccess = runDuel(shotStat, reflexStat, ENGINE_CONFIG.DUEL_LUCK_SHOOTING);

  if (shotSuccess) {
    const eligibleAssisters = attPlayers.filter(p => p.id !== activeAttacker.id && (p.position === 'MID' || p.position === 'FWD'));
    const assister = eligibleAssisters.length > 0 
      ? eligibleAssisters[Math.floor(Math.random() * eligibleAssisters.length)] 
      : undefined;
    
    let eventDesc = `⚽ GOAL! ${activeAttacker.name} drills it into the corner!`;
    if (assister) eventDesc += ` (Assist: ${assister.name})`;

    return { goal: true, scorer: activeAttacker, assister, event: eventDesc };
  }

  const missEvents = [
    `🧤 GREAT SAVE! ${gk.name} denies ${activeAttacker.name}!`,
    `❌ DRAGGED WIDE! ${activeAttacker.name} flashes it past the post.`,
    `🚀 OVER THE BAR! ${activeAttacker.name} leans back too much.`,
    `🛑 BLOCK! The shot by ${activeAttacker.name} is charged down.`
  ];
  return { goal: false, event: missEvents[Math.floor(Math.random() * missEvents.length)] };
};


/** Pure function to simulate a match without Zustand overhead */
export const quickSimMatch = (
  fixtureId: string,
  players: Record<string, Player>,
  teams: Record<string, Team>,
  fixtures: Record<string, Fixture>
): { players: Record<string, Player>, teams: Record<string, Team>, fixture: Fixture } => {
  const fixture = fixtures[fixtureId];
  if (!fixture || fixture.isPlayed) return { players, teams, fixture };

  const updatedPlayers = { ...players };
  const updatedTeams = { ...teams };

  const getTeamStarters = (teamId: string) => {
    let starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
    if (starters.length < 11) {
      const team = updatedTeams[teamId];
      const lineupUpdates = autoAssignLineup(teamId, updatedPlayers, team.activeFormation);
      Object.keys(lineupUpdates).forEach(id => {
          updatedPlayers[id] = { ...updatedPlayers[id], ...lineupUpdates[id] };
      });
      starters = Object.values(updatedPlayers).filter(p => p.teamId === teamId && p.isStarting && p.matchesSuspended === 0);
    }
    return starters;
  };

  const homeTeam = updatedTeams[fixture.homeTeamId];
  const awayTeam = updatedTeams[fixture.awayTeamId];
  const homeStarters = getTeamStarters(fixture.homeTeamId);
  const awayStarters = getTeamStarters(fixture.awayTeamId);

  if (homeStarters.length === 0 || awayStarters.length === 0) return { players, teams, fixture };

  let hScore = 0;
  let aScore = 0;
  const homeFormMult = getFormModifier(homeTeam.form);
  const awayFormMult = getFormModifier(awayTeam.form);
  const homeMoraleMult = getMoraleModifier(homeStarters);
  const awayMoraleMult = getMoraleModifier(awayStarters);
  const GLOBAL_HOME_ADVANTAGE = ENGINE_CONFIG.GLOBAL_HOME_ADVANTAGE;

  const scaledHome = homeStarters.map((p: Player) => ({ ...p, stats: { ...p.stats, 
    passing: p.stats.passing * homeFormMult * homeMoraleMult * GLOBAL_HOME_ADVANTAGE, 
    shooting: p.stats.shooting * homeFormMult * homeMoraleMult * GLOBAL_HOME_ADVANTAGE,
    defending: (p.stats.defending || 50) * homeFormMult * homeMoraleMult * GLOBAL_HOME_ADVANTAGE,
    dribbling: (p.stats.dribbling || 50) * homeFormMult * homeMoraleMult * GLOBAL_HOME_ADVANTAGE } }));
  
  const scaledAway = awayStarters.map((p: Player) => ({ ...p, stats: { ...p.stats, 
    passing: p.stats.passing * awayFormMult * awayMoraleMult, 
    shooting: p.stats.shooting * awayFormMult * awayMoraleMult,
    defending: (p.stats.defending || 50) * awayFormMult * awayMoraleMult,
    dribbling: (p.stats.dribbling || 50) * awayFormMult * awayMoraleMult } }));

  for (let i = 0; i < ENGINE_CONFIG.TOTAL_POSSESSIONS; i++) {
    const isHomeAttacking = i % 2 === 0;
    const attTeam = isHomeAttacking ? homeTeam : awayTeam;
    const defTeam = isHomeAttacking ? awayTeam : homeTeam;
    const attPlayers = isHomeAttacking ? scaledHome : scaledAway;
    const defPlayers = isHomeAttacking ? scaledAway : scaledHome;

    const poss = simulatePossession(attTeam, defTeam, attPlayers, defPlayers, isHomeAttacking ? hScore : aScore, isHomeAttacking ? aScore : hScore);
    if (poss.goal) {
      if (isHomeAttacking) hScore++; else aScore++;
      if (poss.scorer) updatedPlayers[poss.scorer.id].goals++;
      if (poss.assister) updatedPlayers[poss.assister.id].assists++;
    }
    if (poss.foul) {
      if (poss.foul.type === 'Y') updatedPlayers[poss.foul.player.id].yellowCards++;
      else {
        updatedPlayers[poss.foul.player.id].redCards++;
        updatedPlayers[poss.foul.player.id].matchesSuspended = 3;
      }
    }
  }

  // Clean sheets
  if (aScore === 0) homeStarters.filter(p => p.position === 'GK' || p.position === 'DEF').forEach(p => { updatedPlayers[p.id].cleanSheets++; });
  if (hScore === 0) awayStarters.filter(p => p.position === 'GK' || p.position === 'DEF').forEach(p => { updatedPlayers[p.id].cleanSheets++; });

  const assignPostMatchStats = (teamStarters: Player[], teamGoals: number, oppGoals: number, isWin: boolean, isDraw: boolean) => {
    teamStarters.forEach(p => { 
        const team = updatedTeams[p.teamId];
        const drain = 25 * (team.tactics.tempo === 'Fast' ? 1.3 : 1.0) * (team.tactics.pressing === 'High' ? 1.3 : 1.0);
        let rating = 6.0 + (Math.random() * 1.2 - 0.4);
        if (isWin) rating += 0.8;
        if (isDraw) rating += 0.2;
        if (!isWin && !isDraw) rating -= 0.6;
        if (oppGoals === 0 && (p.position === 'DEF' || p.position === 'GK')) rating += 1.0;
        rating += (p.impactCoefficient - 1.0);
        rating = Math.max(1.0, Math.min(10.0, Math.round(rating * 10) / 10));
        updatedPlayers[p.id] = {
           ...updatedPlayers[p.id],
           energy: Math.max(0, updatedPlayers[p.id].energy - drain),
           minutesPlayed: (updatedPlayers[p.id].minutesPlayed || 0) + 90,
           matchRatingHistory: [...(updatedPlayers[p.id].matchRatingHistory || []), rating]
        };
    });
  };

  assignPostMatchStats(homeStarters, hScore, aScore, hScore > aScore, hScore === aScore);
  assignPostMatchStats(awayStarters, aScore, hScore, aScore > hScore, aScore === hScore);

  const updatedFixture = { ...fixture, homeScore: hScore, awayScore: aScore, isPlayed: true };

  const updateLog = (t: Team, gf: number, ga: number, matchStarters: Player[]) => {
    const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
    const token = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
    return {
      ...t,
      played: t.played + 1,
      wins: t.wins + (gf > ga ? 1 : 0),
      draws: t.draws + (gf === ga ? 1 : 0),
      losses: t.losses + (gf < ga ? 1 : 0),
      goalsFor: t.goalsFor + gf,
      goalsAgainst: t.goalsAgainst + ga,
      points: t.points + pts,
      form: [...(t.form || []), token].slice(-5),
      lastStartingXI: matchStarters.map(p => p.id)
    };
  };

  updatedTeams[homeTeam.id] = updateLog(homeTeam, hScore, aScore, homeStarters);
  updatedTeams[awayTeam.id] = updateLog(awayTeam, aScore, hScore, awayStarters);

  return { players: updatedPlayers, teams: updatedTeams, fixture: updatedFixture };
};

// ─── Form & Morale modifiers applied at match call site ─────────────────────
export const getFormModifier = (form: string[]): number => {
  if (!form || form.length === 0) return 1.0;
  const wins   = form.filter(x => x === 'W').length;
  const losses = form.filter(x => x === 'L').length;
  return 1.0 + (wins * 0.02) - (losses * 0.02);
};

export const getMoraleModifier = (teamPlayers: Player[]): number => {
  if (teamPlayers.length === 0) return 1.0;
  const avgMorale = teamPlayers.reduce((s, p) => s + p.morale, 0) / teamPlayers.length;
  return 1.0 + ((avgMorale - 50) / 50) * 0.05;
};

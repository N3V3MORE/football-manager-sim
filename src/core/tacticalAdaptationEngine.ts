import { Formation, Player, Team } from '../models/types';
import { getSlotsForFormation } from '../constants/formations';
import { RandomGenerator, resolveRandom } from './random';
import { isPlayerUnavailable } from './playerStatusUtils';
import { isPlayableClub } from './freeAgentPool';
import { buildQuickSimLineup } from './lineupEngine';
import { rebuildFormationMap } from './formationMapUtils';

const ADAPTIVE_FORMATIONS: Formation[] = [
  '4-3-3',
  '4-2-3-1',
  '4-4-2',
  '4-1-4-1',
  '4-3-2-1',
  '3-4-3',
  '3-4-2-1',
  '4-5-1',
  '4-2-2-2',
  '3-2-4-1',
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

  if ((formation.startsWith('3') || formation.startsWith('5')) && cbDepth < 3) score -= 80;
  if (formation.startsWith('5') && wbDepth < 2) score -= 10;
  return score;
};

const pickAdaptiveFormation = (
  team: Team,
  players: Player[],
  mode: 'attack' | 'defense' | 'stable',
  rng?: RandomGenerator
): Formation | null => {
  const random = resolveRandom(rng);
  const modePool: Formation[] = mode === 'defense'
    ? ['5-2-3', '3-5-2', '4-1-4-1', '4-4-2', '3-4-2-1', '4-5-1']
    : mode === 'attack'
      ? ['4-3-3', '4-2-3-1', '3-4-3', '3-5-2', '4-3-2-1', '3-4-2-1', '4-2-2-2', '3-2-4-1']
      : ADAPTIVE_FORMATIONS;

  const formationScores = modePool.map(formation => {
    let bias = 0;
    if (team.manager?.preferredFormations?.includes(formation)) bias += 16;
    if (mode === 'defense') {
      if (formation === '5-2-3') bias += 30;
      if (formation.startsWith('5')) bias += 18;
      if (formation === '3-5-2') bias += 10;
      if (formation === '4-1-4-1') bias += 8;
      if (formation === '4-5-1' || formation === '3-4-2-1') bias += 6;
    } else if (mode === 'attack') {
      if (formation === '4-3-3' || formation === '4-2-3-1') bias += 12;
      if (formation === '3-4-3') bias += 10;
      if (formation === '3-5-2') bias += 8;
      if (formation === '4-2-2-2' || formation === '3-2-4-1') bias += 8;
    }
    if (team.manager?.jobSecurity < 35) bias += 5;
    if (team.manager?.jobSecurity > 80 && formation === team.activeFormation) bias += 4;
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
  const securitySwing = team.manager ? (50 - team.manager.jobSecurity) / 200 : 0;
  const changeChance = Math.max(0.2, Math.min(0.9, (mode === 'stable' ? 0.35 : 0.7) + securitySwing));
  if (best.score - currentScore >= minDelta && random() < changeChance) return best.formation;
  if (mode !== 'stable' && random() < 0.16) return best.formation;
  return null;
};

const applyAtomicFormationChange = (
  team: Team,
  formation: Formation,
  updatedPlayers: Record<string, Player>
): Team => {
  const lineupUpdates = buildQuickSimLineup(team.id, updatedPlayers, formation);
  Object.entries(lineupUpdates).forEach(([playerId, updates]) => {
    const player = updatedPlayers[playerId];
    if (player) updatedPlayers[playerId] = { ...player, ...updates };
  });
  const starters = Object.values(updatedPlayers).filter(player => player.teamId === team.id && player.isStarting && !isPlayerUnavailable(player));
  return {
    ...team,
    activeFormation: formation,
    formationMap: rebuildFormationMap(getSlotsForFormation(formation), starters, {}),
    lastStartingXI: starters.map(player => player.id).slice(0, 11),
  };
};

export const applyTacticalAdaptation = (
  updatedPlayers: Record<string, Player>,
  updatedTeams: Record<string, Team>,
  excludedTeamIds = new Set<string>(),
  rng?: RandomGenerator
) => {
  const random = resolveRandom(rng);
  Object.values(updatedTeams).forEach(team => {
    if (!isPlayableClub(team)) return;
    if (excludedTeamIds.has(team.id)) return;
    if (team.played < 4 || team.played % 2 !== 0) return;
    if (team.lastTacticalAdaptationPlayed === team.played) return;

    const recentForm = (team.form || []).slice(-5);
    const wins = recentForm.filter(token => token === 'W').length;
    const draws = recentForm.filter(token => token === 'D').length;
    const losses = recentForm.filter(token => token === 'L').length;
    const goalsForPerGame = team.played > 0 ? team.goalsFor / team.played : 0;
    const goalsAgainstPerGame = team.played > 0 ? team.goalsAgainst / team.played : 0;
    const pressureScore = team.manager?.pressureScore || 40;
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

    if ((losses >= 2 && goalsAgainstPerGame > 1.7) || goalsAgainstPerGame > 2.1) {
      if (goalsForPerGame < 1.2) {
        nudgeMentality('Balanced');
        if (nextTactics.defensiveLine === 'High') { nextTactics.defensiveLine = 'Standard'; changed = true; }
        if (nextTactics.pressing === 'High') { nextTactics.pressing = 'Medium'; changed = true; }
        if (nextTactics.tempo === 'Fast') { nextTactics.tempo = 'Normal'; changed = true; }
        adaptationChance = pressureScore >= 60 ? 0.86 : 0.78;
      } else {
        nudgeMentality('Defensive');
        if (nextTactics.defensiveLine !== 'Deep') { nextTactics.defensiveLine = 'Deep'; changed = true; }
        if (nextTactics.pressing === 'High') { nextTactics.pressing = 'Medium'; changed = true; }
        if (nextTactics.tempo === 'Fast') { nextTactics.tempo = 'Normal'; changed = true; }
        adaptationChance = pressureScore >= 60 ? 0.82 : 0.72;
      }
      formationMode = 'defense';
    } else if (
      (losses >= 2 && goalsForPerGame < 1.1) ||
      (wins === 0 && losses + draws >= 4 && goalsForPerGame < 1.25)
    ) {
      nudgeMentality('Attacking');
      if (nextTactics.tempo === 'Slow') { nextTactics.tempo = 'Normal'; changed = true; }
      if (nextTactics.passingStyle === 'Short') { nextTactics.passingStyle = 'Mixed'; changed = true; }
      if (nextTactics.pressing === 'None') { nextTactics.pressing = 'Medium'; changed = true; }
      adaptationChance = pressureScore >= 60 ? 0.8 : 0.7;
      formationMode = 'attack';
    } else if (wins >= 3 && losses <= 1 && goalsForPerGame > 1.6 && goalsAgainstPerGame < 1.3) {
      nudgeMentality('Balanced');
      if (nextTactics.defensiveLine === 'Deep') { nextTactics.defensiveLine = 'Standard'; changed = true; }
      if (nextTactics.pressing === 'None') { nextTactics.pressing = 'Medium'; changed = true; }
      adaptationChance = 0.5;
      formationMode = 'stable';
    } else if (pressureScore >= 58 && losses >= 2) {
      if (goalsAgainstPerGame >= goalsForPerGame) {
        nudgeMentality('Balanced');
        if (nextTactics.defensiveLine === 'High') { nextTactics.defensiveLine = 'Standard'; changed = true; }
        if (nextTactics.tempo === 'Fast') { nextTactics.tempo = 'Normal'; changed = true; }
        formationMode = 'defense';
      } else {
        nudgeMentality('Attacking');
        if (nextTactics.tempo === 'Slow') { nextTactics.tempo = 'Normal'; changed = true; }
        formationMode = 'attack';
      }
      adaptationChance = 0.6;
    }

    const canApplyTactics = changed && random() < adaptationChance;
    let nextTeam = updatedTeams[team.id];
    let teamChanged = false;

    if (canApplyTactics) {
      nextTeam = { ...nextTeam, tactics: nextTactics };
      teamChanged = true;
    }

    const shouldTryFormationChange = Boolean(
      formationMode &&
      (
        formationMode === 'defense'
          ? team.played % 2 === 0
          : formationMode === 'attack'
            ? team.played % 3 === 0
            : team.played % 4 === 0
      )
    );
    if (shouldTryFormationChange) {
      const teamPlayers = Object.values(updatedPlayers)
        .filter(player => player.teamId === team.id && !isPlayerUnavailable(player));
      const candidate = pickAdaptiveFormation(nextTeam, teamPlayers, formationMode!, rng);
      if (candidate && candidate !== nextTeam.activeFormation) {
        nextTeam = applyAtomicFormationChange(nextTeam, candidate, updatedPlayers);
        teamChanged = true;
      }
    }

    if (!teamChanged && pressureScore >= 68 && team.played % 4 === 0 && random() < 0.24) {
      const teamPlayers = Object.values(updatedPlayers)
        .filter(player => player.teamId === team.id && !isPlayerUnavailable(player));
      const pressureMode: 'attack' | 'defense' = goalsAgainstPerGame >= goalsForPerGame ? 'defense' : 'attack';
      const candidate = pickAdaptiveFormation(nextTeam, teamPlayers, pressureMode, rng);
      if (candidate && candidate !== nextTeam.activeFormation) {
        nextTeam = applyAtomicFormationChange(nextTeam, candidate, updatedPlayers);
        teamChanged = true;
      }
    }

    updatedTeams[team.id] = teamChanged
      ? { ...nextTeam, lastTacticalAdaptationPlayed: team.played }
      : { ...updatedTeams[team.id], lastTacticalAdaptationPlayed: team.played };
  });
};

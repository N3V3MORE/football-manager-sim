import {
  BoardObjective,
  BoardProfile,
  BoardReviewVerdict,
  BoardSignalBreakdown,
  CompetitionId,
  CompetitionRoundKey,
  CompetitionState,
  Division,
  LeagueDivision,
  Manager,
  Player,
  Team,
} from '../models/types';
import { getDivisionTeamCount, sortTeamsByTable } from './leagueUtils';
import { getCompetitionResultForTeam, hasReachedCompetitionRound } from './competitionEngine';
import { getSquadPolicy } from './squadPolicy';
import { isClubTeam } from './freeAgentPool';

type ObjectiveResult = {
  objective: BoardObjective;
  approvalDelta: number;
};

type BoardObjectiveContext = {
  isSeasonComplete?: boolean;
  competitions?: Record<string, CompetitionState>;
  players?: Record<string, Player>;
};

export type BoardReview = {
  updatedObjectives: BoardObjective[];
  approvalChange: number;
  nextApproval: number;
  nextManager: Manager;
  verdict: BoardReviewVerdict;
  reasons: string[];
  position: number | null;
  positionDelta: number | null;
  metObjectives: number;
  totalObjectives: number;
  signalBreakdown: BoardSignalBreakdown;
};

type SquadContextSignal = {
  approvalAdjustment: number;
  pressureAdjustment: number;
  reasons: string[];
  breakdown: BoardSignalBreakdown;
};

const EMPTY_SIGNAL_BREAKDOWN: BoardSignalBreakdown = {
  ageProfile: { score: 0 },
  wagePosture: {
    score: 0,
    wageBill: 0,
    wagePressureRatio: 0,
    spendRatio: 0,
  },
  registrationDepth: {
    score: 0,
    availablePlayers: 0,
    positionShortages: 0,
    missingDepth: 0,
  },
};

const getNormalizedDivision = (division: Division): LeagueDivision => (
  division === 'Continental' ? 'Premier League' : division
);

const getPatienceModifier = (profile: BoardProfile) => (
  profile.patience === 'low' ? 1.25 : profile.patience === 'high' ? 0.8 : 1
);

const getPatienceRiskModifier = (profile: BoardProfile) => (
  profile.patience === 'low' ? 10 : profile.patience === 'high' ? -8 : 0
);

const buildObjectiveId = (...parts: (string | number | undefined)[]) => (
  `objective-${parts
    .filter(part => part !== undefined && part !== '')
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`
);

const getAmbitionWeight = (profile: BoardProfile) => {
  switch (profile.ambition) {
    case 'elite':
      return 5;
    case 'europe':
      return 4;
    case 'promotion':
      return 3;
    case 'stability':
      return 2;
    case 'survival':
    default:
      return 1;
  }
};

const getWagePressureThresholds = (discipline: BoardProfile['transferDiscipline']) => {
  if (discipline === 'strict') {
    return { low: 0.46, high: 0.9, spendHigh: 0.72 };
  }
  if (discipline === 'aggressive') {
    return { low: 0.35, high: 1.35, spendHigh: 0.95 };
  }
  return { low: 0.4, high: 1.1, spendHigh: 0.84 };
};

export const buildBoardSignalBreakdown = (
  team: Team,
  players?: Record<string, Player>
): BoardSignalBreakdown => {
  if (!players) {
    return EMPTY_SIGNAL_BREAKDOWN;
  }

  const squad = Object.values(players).filter(player => player.teamId === team.id);
  if (squad.length === 0) {
    return EMPTY_SIGNAL_BREAKDOWN;
  }

  const avgAge = squad.reduce((sum, player) => sum + player.age, 0) / squad.length;
  const youthShare = squad.filter(player => player.age <= 21).length / squad.length;
  const veteranShare = squad.filter(player => player.age >= 31).length / squad.length;
  let ageProfile: BoardSignalBreakdown['ageProfile'] = { score: 0 };

  if (
    (team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe') &&
    veteranShare >= 0.38
  ) {
    ageProfile = {
      score: -2,
      reason: 'squad age profile looks too veteran-heavy for board ambition',
    };
  } else if (team.boardProfile.ambition === 'survival' && avgAge < 24.5 && youthShare >= 0.42) {
    ageProfile = {
      score: -1,
      reason: 'squad age profile is too inexperienced for a survival fight',
    };
  } else if (avgAge >= 24 && avgAge <= 28 && youthShare >= 0.18 && veteranShare <= 0.34) {
    ageProfile = { score: 1 };
  }

  const wageBill = squad.reduce((sum, player) => sum + (Number.isFinite(player.wage) ? player.wage : 0), 0);
  const spendRatio = (team.transferSpend || 0) / Math.max(1, team.budget + (team.transferSpend || 0));
  const wageResourceBase = team.operatingBudget !== undefined ? team.operatingBudget : team.budget;
  const wagePressureRatio = wageBill / Math.max(450, wageResourceBase * 100);
  const wageThresholds = getWagePressureThresholds(team.boardProfile.transferDiscipline);
  let wagePosture: BoardSignalBreakdown['wagePosture'] = {
    score: 0,
    wageBill,
    wagePressureRatio,
    spendRatio,
  };

  if (wagePressureRatio > wageThresholds.high || spendRatio > wageThresholds.spendHigh) {
    wagePosture = {
      ...wagePosture,
      score: -2,
      reason: 'wage posture and spend profile are outside board comfort',
    };
  } else if (
    team.boardProfile.transferDiscipline === 'strict' &&
    wagePressureRatio <= wageThresholds.low &&
    spendRatio <= 0.58
  ) {
    wagePosture = { ...wagePosture, score: 1 };
  }

  const policy = getSquadPolicy(team);
  const structuralByPosition = squad.reduce<Record<'GK' | 'DEF' | 'MID' | 'FWD', number>>(
    (acc, player) => {
      if (player.position in acc) acc[player.position] += 1;
      return acc;
    },
    { GK: 0, DEF: 0, MID: 0, FWD: 0 }
  );
  const positionShortages = [
    Math.max(0, policy.positionalMinimums.GK - structuralByPosition.GK),
    Math.max(0, policy.positionalMinimums.DEF - structuralByPosition.DEF),
    Math.max(0, policy.positionalMinimums.MID - structuralByPosition.MID),
    Math.max(0, policy.positionalMinimums.FWD - structuralByPosition.FWD),
  ].reduce((sum, missing) => sum + missing, 0);
  const missingDepth = Math.max(0, policy.structuralMinimum - squad.length);
  let registrationDepth: BoardSignalBreakdown['registrationDepth'] = {
    score: 0,
    availablePlayers: squad.length,
    positionShortages,
    missingDepth,
  };

  if (missingDepth >= 3 || positionShortages >= 3) {
    registrationDepth = {
      ...registrationDepth,
      score: -3,
      reason: 'registration depth is stretched by availability and role shortages',
    };
  } else if (missingDepth > 0 || positionShortages > 0) {
    registrationDepth = {
      ...registrationDepth,
      score: -1,
      reason: 'registration depth is trending thin',
    };
  } else if (squad.length >= policy.structuralMinimum + 2 && positionShortages === 0) {
    registrationDepth = { ...registrationDepth, score: 1 };
  }

  return {
    ageProfile,
    wagePosture,
    registrationDepth,
  };
};

const getPressureAdjustmentForSignal = (
  signal: keyof BoardSignalBreakdown,
  score: number
) => {
  if (score > 0) return -2;
  if (score === 0) return 0;

  if (signal === 'ageProfile') return score <= -2 ? 7 : 4;
  if (signal === 'wagePosture') return 6;
  return score <= -3 ? 9 : 3;
};

const buildSquadContextSignal = (
  team: Team,
  players?: Record<string, Player>
): SquadContextSignal => {
  const breakdown = buildBoardSignalBreakdown(team, players);
  const signalScores = [
    breakdown.ageProfile.score,
    breakdown.wagePosture.score,
    breakdown.registrationDepth.score,
  ];
  const approvalAdjustment = signalScores.reduce((sum, score) => sum + score, 0);
  const pressureAdjustment =
    getPressureAdjustmentForSignal('ageProfile', breakdown.ageProfile.score) +
    getPressureAdjustmentForSignal('wagePosture', breakdown.wagePosture.score) +
    getPressureAdjustmentForSignal('registrationDepth', breakdown.registrationDepth.score);
  const reasons = [
    breakdown.ageProfile.reason,
    breakdown.wagePosture.reason,
    breakdown.registrationDepth.reason,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    approvalAdjustment,
    pressureAdjustment,
    reasons,
    breakdown,
  };
};

const getTeamPosition = (team: Team, teams: Record<string, Team>) => {
  const divisionTable = sortTeamsByTable(
    Object.values(teams).filter(candidate => isClubTeam(candidate) && candidate.division === team.division)
  );
  const position = divisionTable.findIndex(candidate => candidate.id === team.id);
  return position >= 0 ? position + 1 : null;
};

const buildPositionObjective = (teamClass: string, division: LeagueDivision): BoardObjective => {
  const teamCount = getDivisionTeamCount(division);
  const topHalf = Math.ceil(teamCount / 2);
  const safeZone = Math.max(teamCount - 3, topHalf + 1);

  const posTargets: Record<string, { desc: string; target: number }> = {
    S: { desc: `Win the ${division} title`, target: 1 },
    A: { desc: `Finish in the Top 4 in the ${division}`, target: 4 },
    B: { desc: `Finish in the Top 8 in the ${division}`, target: 8 },
    C: { desc: `Finish in the Top Half of the ${division}`, target: topHalf },
    D: { desc: `Finish above the relegation zone in the ${division}`, target: safeZone },
    E: { desc: `Stay clear of the drop in the ${division}`, target: safeZone },
    F: { desc: `Secure survival in the ${division}`, target: safeZone },
  };
  const positionTarget = posTargets[teamClass] || posTargets.C;

  return {
    id: buildObjectiveId('position', teamClass, division, positionTarget.target),
    description: positionTarget.desc,
    type: 'position',
    target: positionTarget.target,
    met: false,
  };
};

const buildWinsObjective = (teamClass: string, division: LeagueDivision): BoardObjective => {
  const teamCount = getDivisionTeamCount(division);
  const seasonMatches = Math.max(1, (teamCount - 1) * 2);
  const winTargetByClass: Record<string, number> = {
    S: Math.max(22, Math.round(seasonMatches * 0.60)),
    A: Math.max(18, Math.round(seasonMatches * 0.50)),
    B: Math.max(13, Math.round(seasonMatches * 0.40)),
    C: Math.max(10, Math.round(seasonMatches * 0.35)),
    D: Math.max(8, Math.round(seasonMatches * 0.28)),
    E: Math.max(6, Math.round(seasonMatches * 0.22)),
    F: Math.max(5, Math.round(seasonMatches * 0.18)),
  };
  const target = winTargetByClass[teamClass] || 10;

  return {
    id: buildObjectiveId('wins', teamClass, division, target),
    description: `Win at least ${target} league matches`,
    type: 'wins',
    target,
    met: false,
  };
};

const buildFinancialObjective = (teamClass: string, profile: BoardProfile): BoardObjective => {
  const minSpendTargets: Record<string, number> = {
    S: 65,
    A: 35,
    B: 20,
    C: 10,
    D: 5,
    E: 3,
    F: 2,
  };
  const maxSpendTargets: Record<string, number> = {
    S: 110,
    A: 65,
    B: 35,
    C: 20,
    D: 10,
    E: 6,
    F: 4,
  };

  if (profile.transferDiscipline === 'strict') {
    const target = maxSpendTargets[teamClass] || 8;
    return {
      id: buildObjectiveId('max-spend', teamClass, profile.transferDiscipline, target),
      description: `Keep gross transfer spend below GBP ${target}m`,
      type: 'max_spend',
      target,
      met: false,
    };
  }

  const disciplineBoost = profile.transferDiscipline === 'aggressive' ? 1.15 : 1;
  const target = Math.round((minSpendTargets[teamClass] || 5) * disciplineBoost);
  return {
    id: buildObjectiveId('spend', teamClass, profile.transferDiscipline, target),
    description: `Invest at least GBP ${target}m in transfers`,
    type: 'spend',
    target,
    met: false,
  };
};

const buildCupObjective = (
  competitionId: CompetitionId,
  description: string,
  targetRound: CompetitionRoundKey
): BoardObjective => ({
  id: buildObjectiveId('cup-round', competitionId, targetRound, description),
  description,
  type: 'cup_round',
  target: 1,
  met: false,
  competitionId,
  targetRound,
});

export const clampBoardMetric = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export const getSackingApprovalThreshold = (team?: Team | null) => (
  team?.boardProfile.patience === 'low'
    ? 28
    : team?.boardProfile.patience === 'high'
      ? 18
      : 22
);

export const describeBoardSeasonExpectations = (
  profile: BoardProfile,
  division: Division
) => {
  if (division === 'Continental') return 'Make a serious European run';
  switch (profile.ambition) {
    case 'elite':
      return 'Deliver trophies and stay in the biggest competitions';
    case 'europe':
      return 'Challenge for Europe and push deep into the cups';
    case 'promotion':
      return division === 'Championship' || division === 'League One' || division === 'League Two'
        ? 'Push hard for promotion and stay alive in the cups'
        : 'Compete at the top end of the division';
    case 'stability':
      return 'Keep the club competitive and build toward the top half';
    case 'survival':
    default:
      return 'Protect league status and avoid a collapse';
  }
};

export const buildBoardProfile = (
  teamClass: string,
  division: Division,
  isExternal = false
): BoardProfile => {
  if (division === 'Continental' || isExternal) {
    return {
      ambition: 'elite',
      patience: 'medium',
      transferDiscipline: 'aggressive',
      targetCompetitions: ['europe'],
      identity: 'Compete deep into Europe and maintain elite standards.',
    };
  }

  if (division === 'Premier League') {
    if (teamClass === 'S') {
      return {
        ambition: 'elite',
        patience: 'low',
        transferDiscipline: 'aggressive',
        targetCompetitions: ['premier-league', 'fa-cup', 'carabao-cup', 'europe'],
        identity: 'Deliver silverware and keep the club at the top of the game.',
      };
    }
    if (teamClass === 'A') {
      return {
        ambition: 'europe',
        patience: 'medium',
        transferDiscipline: 'aggressive',
        targetCompetitions: ['premier-league', 'fa-cup', 'carabao-cup', 'europe'],
        identity: 'Stay in the European race and make credible trophy runs.',
      };
    }
    if (teamClass === 'B') {
      return {
        ambition: 'stability',
        patience: 'medium',
        transferDiscipline: 'balanced',
        targetCompetitions: ['premier-league', 'fa-cup'],
        identity: 'Push the club into the top half and stay relevant in the cups.',
      };
    }
    if (teamClass === 'C') {
      return {
        ambition: 'stability',
        patience: 'high',
        transferDiscipline: 'balanced',
        targetCompetitions: ['premier-league', 'fa-cup'],
        identity: 'Keep the side stable and build without drama.',
      };
    }
    return {
      ambition: 'survival',
      patience: 'high',
      transferDiscipline: 'strict',
      targetCompetitions: ['premier-league'],
      identity: 'Stay in the division first. Everything else is secondary.',
    };
  }

  if (division === 'Championship') {
    if (['S', 'A', 'B', 'C'].includes(teamClass)) {
      return {
        ambition: 'promotion',
        patience: teamClass === 'C' ? 'medium' : 'low',
        transferDiscipline: teamClass === 'C' ? 'balanced' : 'aggressive',
        targetCompetitions: ['championship', 'fa-cup', 'carabao-cup'],
        identity: 'Push the promotion race and show real intent in knockout ties.',
      };
    }
    return {
      ambition: 'survival',
      patience: 'high',
      transferDiscipline: 'strict',
      targetCompetitions: ['championship', 'fa-cup'],
      identity: 'Avoid a slide and keep the club on a stable footing.',
    };
  }

  if (division === 'League One') {
    if (['C', 'D'].includes(teamClass)) {
      return {
        ambition: 'promotion',
        patience: 'medium',
        transferDiscipline: 'balanced',
        targetCompetitions: ['league-one', 'fa-cup', 'carabao-cup'],
        identity: 'Build toward the top end and take cup nights seriously.',
      };
    }
    return {
      ambition: 'survival',
      patience: 'high',
      transferDiscipline: 'strict',
      targetCompetitions: ['league-one', 'fa-cup'],
      identity: 'Keep the club competitive and stay clear of danger.',
    };
  }

  if (['D', 'E'].includes(teamClass)) {
    return {
      ambition: 'stability',
      patience: 'high',
      transferDiscipline: 'strict',
      targetCompetitions: ['league-two', 'fa-cup'],
      identity: 'Create a stable platform and stay away from the bottom places.',
    };
  }

  return {
    ambition: 'survival',
    patience: 'high',
    transferDiscipline: 'strict',
    targetCompetitions: ['league-two', 'fa-cup'],
    identity: 'Protect league status and keep the club under control.',
  };
};

export const buildBoardObjectives = (
  teamClass: string,
  division: Division,
  boardProfile = buildBoardProfile(teamClass, division),
  activeCompetitionIds: CompetitionId[] = []
): BoardObjective[] => {
  if (division === 'Continental') {
    return activeCompetitionIds.includes('europe')
      ? [buildCupObjective('europe', 'Reach the Europe semi-final', 'semi_final')]
      : [];
  }

  const normalizedDivision = getNormalizedDivision(division);
  const objectives: BoardObjective[] = [
    buildPositionObjective(teamClass, normalizedDivision),
    buildWinsObjective(teamClass, normalizedDivision),
    buildFinancialObjective(teamClass, boardProfile),
  ];

  if (boardProfile.targetCompetitions.includes('fa-cup')) {
    const targetRound =
      boardProfile.ambition === 'elite' || boardProfile.ambition === 'europe'
        ? 'quarter_final'
        : boardProfile.ambition === 'promotion' || boardProfile.ambition === 'stability'
          ? 'round_4'
          : 'round_3';
    objectives.push(buildCupObjective(
      'fa-cup',
      `Reach the FA Cup ${targetRound === 'quarter_final' ? 'quarter-final' : targetRound === 'round_4' ? 'Round 4' : 'Round 3'}`,
      targetRound
    ));
  }

  if (boardProfile.targetCompetitions.includes('carabao-cup')) {
    const targetRound =
      boardProfile.ambition === 'elite'
        ? 'semi_final'
        : boardProfile.ambition === 'europe' || boardProfile.ambition === 'promotion'
          ? 'quarter_final'
          : 'round_3';
    objectives.push(buildCupObjective(
      'carabao-cup',
      `Reach the Carabao Cup ${targetRound === 'semi_final' ? 'semi-final' : targetRound === 'quarter_final' ? 'quarter-final' : 'Round 3'}`,
      targetRound
    ));
  }

  if (activeCompetitionIds.includes('europe')) {
    const targetRound = boardProfile.ambition === 'elite' ? 'final' : 'semi_final';
    objectives.push(buildCupObjective(
      'europe',
      `Reach the Europe ${targetRound === 'final' ? 'final' : 'semi-final'}`,
      targetRound
    ));
  }

  return objectives;
};

const evaluateObjective = (
  objective: BoardObjective,
  team: Team,
  teams: Record<string, Team>,
  context?: BoardObjectiveContext
): ObjectiveResult => {
  let met = objective.met;
  let failed = objective.failed || false;
  let approvalDelta = 0;
  const isSeasonComplete = Boolean(context?.isSeasonComplete);

  switch (objective.type) {
    case 'position': {
      if (!isSeasonComplete) {
        met = false;
        break;
      }
      const position = getTeamPosition(team, teams);
      if (position !== null && position <= objective.target && !met) {
        met = true;
        approvalDelta += 10;
      }
      if (!met && isSeasonComplete) {
        failed = true;
      }
      break;
    }
    case 'wins':
      if (team.wins >= objective.target && !met) {
        met = true;
        approvalDelta += 10;
      }
      if (!met && isSeasonComplete) {
        failed = true;
      }
      break;
    case 'cup_round': {
      const competition = objective.competitionId
        ? context?.competitions?.[objective.competitionId]
        : undefined;
      if (
        objective.competitionId &&
        objective.targetRound &&
        hasReachedCompetitionRound(competition, team.id, objective.targetRound) &&
        !met
      ) {
        met = true;
        approvalDelta += objective.competitionId === 'europe' ? 16 : 12;
      }
      // Mark as failed when the team is eliminated and cannot reach the target round any longer
      if (!met && competition && competition.eliminatedTeamIds.includes(team.id)) {
        failed = true;
      }
      if (!met && isSeasonComplete) {
        failed = true;
      }
      break;
    }
    case 'spend':
      if ((team.transferSpend || 0) >= objective.target && !met) {
        met = true;
        approvalDelta += 10;
      }
      if (!met && isSeasonComplete) {
        failed = true;
      }
      break;
    case 'max_spend':
      if (isSeasonComplete && (team.transferSpend || 0) <= objective.target && !met) {
        met = true;
        approvalDelta += 8;
      }
      if (!met && isSeasonComplete) {
        failed = true;
      }
      break;
    default:
      break;
  }

  return { objective: { ...objective, met, failed }, approvalDelta };
};

export const evaluateBoardObjectives = (
  objectives: BoardObjective[],
  team: Team,
  teams: Record<string, Team>,
  context?: BoardObjectiveContext
) => {
  let approvalChange = 0;
  const updatedObjectives = objectives.map(objective => {
    const result = evaluateObjective(objective, team, teams, context);
    approvalChange += result.approvalDelta;
    return result.objective;
  });

  return { updatedObjectives, approvalChange };
};

export const getFormApprovalDelta = (form: string[]) => {
  if (!form || form.length === 0) return 0;
  const recent = form.slice(-3);
  const losses = recent.filter(r => r === 'L').length;
  const wins = recent.filter(r => r === 'W').length;
  return wins - losses;
};

export const getReviewVerdict = (
  nextApproval: number,
  pressureScore: number,
  replacementRisk: number
): BoardReviewVerdict => {
  if (nextApproval < 20 || replacementRisk >= 75 || pressureScore >= 80) return 'critical';
  if (nextApproval < 35 || replacementRisk >= 60 || pressureScore >= 60) return 'warning';
  if (nextApproval >= 70 && pressureScore < 35 && replacementRisk < 30) return 'thriving';
  return 'stable';
};

export const runBoardReview = (
  team: Team,
  teams: Record<string, Team>,
  objectives: BoardObjective[],
  context?: BoardObjectiveContext
): BoardReview => {
  const alreadyFailedObjectiveIds = new Set(
    objectives.filter(objective => objective.failed).map(objective => objective.id)
  );
  const objectiveResult = evaluateBoardObjectives(objectives, team, teams, context);
  const updatedObjectives = objectiveResult.updatedObjectives;
  const reasons: string[] = [];
  const patienceModifier = getPatienceModifier(team.boardProfile);
  const squadContext = buildSquadContextSignal(team, context?.players);
  let approvalChange = objectiveResult.approvalChange + getFormApprovalDelta(team.form || []) + squadContext.approvalAdjustment;

  const positionObjective = updatedObjectives.find(objective => objective.type === 'position');
  const position = positionObjective ? getTeamPosition(team, teams) : null;
  const positionDelta = positionObjective && position !== null ? position - positionObjective.target : null;
  const isSeasonComplete = Boolean(context?.isSeasonComplete);

  if (positionDelta !== null && (isSeasonComplete || team.played >= 6)) {
    if (positionDelta > 0) {
      const penaltyBase = isSeasonComplete ? 3 : 1;
      const penalty = Math.min(10, Math.round((penaltyBase + Math.min(positionDelta, 4)) * patienceModifier));
      approvalChange -= penalty;
      reasons.push(`league position is ${positionDelta} place${positionDelta === 1 ? '' : 's'} off target`);
    } else if (positionDelta <= -2) {
      const bonus = isSeasonComplete ? 2 : 1;
      approvalChange += bonus;
      reasons.push('league position is ahead of the board target');
    }
  }

  updatedObjectives
    .filter(objective => objective.type === 'cup_round' && objective.competitionId)
    .forEach(objective => {
      if (objective.met || alreadyFailedObjectiveIds.has(objective.id)) return;
      const competition = objective.competitionId
        ? context?.competitions?.[objective.competitionId]
        : undefined;
      if (!competition) return;
      const isCompetitionResolved = competition.eliminatedTeamIds.includes(team.id);
      if (!isSeasonComplete && !isCompetitionResolved) return;
      const penalty = objective.competitionId === 'europe'
        ? 5
        : team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe'
          ? 3
          : 2;
      approvalChange -= penalty;
      objective.failed = true;
      reasons.push(`${objective.description.toLowerCase()} was missed`);
    });

  const financialObjective = updatedObjectives.find(objective => (
    objective.type === 'spend' || objective.type === 'max_spend'
  ));
  // Idempotency: skip penalty if the financial objective was already failed
  // before this review run. evaluateObjective sets failed=true for unmet
  // spend/max_spend when seasonComplete, so alreadyFailedObjectiveIds will
  // contain it on any re-invocation after the first season-end review.
  if (
    financialObjective &&
    isSeasonComplete &&
    !financialObjective.met &&
    !alreadyFailedObjectiveIds.has(financialObjective.id)
  ) {
    const penalty = financialObjective.type === 'max_spend'
      ? team.boardProfile.transferDiscipline === 'strict' ? 5 : 3
      : team.boardProfile.transferDiscipline === 'aggressive' ? 3 : 2;
    approvalChange -= penalty;
    financialObjective.failed = true;
    reasons.push(financialObjective.description.toLowerCase());
  }

  if (squadContext.reasons.length > 0) {
    reasons.push(...squadContext.reasons);
  }

  if (isSeasonComplete) {
    team.boardProfile.targetCompetitions.forEach(competitionId => {
      const result = context?.competitions?.[competitionId]
        ? getCompetitionResultForTeam(context.competitions[competitionId], team.id)
        : null;
      if (!result) return;
      if (result.finish === 'winner') {
        approvalChange += competitionId === 'europe' ? 5 : 3;
      } else if (result.finish === 'runner_up') {
        approvalChange += competitionId === 'europe' ? 3 : 1;
      }
    });
  }

  const metObjectives = updatedObjectives.filter(objective => objective.met).length;
  const totalObjectives = updatedObjectives.length;
  const missedObjectives = totalObjectives - metObjectives;
  const ambitionWeight = getAmbitionWeight(team.boardProfile);
  const nextApproval = clampBoardMetric(team.boardApproval + approvalChange);
  const boardTrust = clampBoardMetric(
    team.manager.boardTrust + approvalChange - Math.max(0, missedObjectives - 1)
  );
  const jobSecurity = clampBoardMetric(
    team.manager.jobSecurity +
    Math.round(approvalChange / 2) -
    (Math.max(0, positionDelta || 0) * ambitionWeight) -
    Math.max(0, Math.round(squadContext.pressureAdjustment / 3))
  );
  const pressureScore = clampBoardMetric(Math.round(
    ((100 - nextApproval) * 0.45) +
    ((100 - jobSecurity) * 0.20) +
    (Math.max(0, positionDelta || 0) * 6) +
    (missedObjectives * 5) +
    getPatienceRiskModifier(team.boardProfile) +
    squadContext.pressureAdjustment
  ));
  const replacementRisk = clampBoardMetric(Math.round(
    (pressureScore * 0.65) +
    ((100 - boardTrust) * 0.20) +
    ((100 - nextApproval) * 0.15)
  ));
  const verdict = getReviewVerdict(nextApproval, pressureScore, replacementRisk);

  const nextManager: Manager = {
    ...team.manager,
    boardTrust,
    jobSecurity,
    pressureScore,
    replacementRisk,
    seasonExpectations: describeBoardSeasonExpectations(team.boardProfile, team.division),
  };

  return {
    updatedObjectives,
    approvalChange,
    nextApproval,
    nextManager,
    verdict,
    reasons,
    position,
    positionDelta,
    metObjectives,
    totalObjectives,
    signalBreakdown: squadContext.breakdown,
  };
};

export const shouldReplaceManagerAfterReview = (
  team: Team,
  review: BoardReview
) => {
  if (review.verdict === 'critical') {
    return {
      shouldReplace: true,
      reason: review.reasons.find(r => r.length > 0) || 'season targets were missed badly',
    };
  }

  if (
    review.nextManager.replacementRisk >= 68 &&
    (
      (review.positionDelta !== null && review.positionDelta >= 3) ||
      review.metObjectives <= Math.max(1, Math.floor(review.totalObjectives / 2))
    )
  ) {
    return {
      shouldReplace: true,
      reason: review.reasons.find(r => r.length > 0) || 'results and board confidence both fell away',
    };
  }

  if (
    team.boardProfile.patience === 'low' &&
    review.nextApproval < getSackingApprovalThreshold(team) &&
    review.positionDelta !== null &&
    review.positionDelta >= 2
  ) {
    return {
      shouldReplace: true,
      reason: review.reasons.find(r => r.length > 0) || 'the board decided the trajectory was no longer acceptable',
    };
  }

  return { shouldReplace: false, reason: '' };
};

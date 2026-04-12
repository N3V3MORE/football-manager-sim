import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import {
  BoardObjective,
  BoardProfile,
  BoardReviewVerdict,
  CompetitionId,
  CompetitionRoundKey,
  CompetitionState,
  Division,
  LeagueDivision,
  Manager,
  Team,
} from '../models/types';
import { getDivisionTeamCount, sortTeamsByTable } from './leagueUtils';
import { getCompetitionResultForTeam, hasReachedCompetitionRound } from './competitionEngine';

type ObjectiveResult = {
  objective: BoardObjective;
  approvalDelta: number;
};

type BoardObjectiveContext = {
  isSeasonComplete?: boolean;
  competitions?: Record<string, CompetitionState>;
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

const getTeamPosition = (team: Team, teams: Record<string, Team>) => {
  const divisionTable = sortTeamsByTable(
    Object.values(teams).filter(candidate => candidate.division === team.division)
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
    id: uuidv4(),
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
    id: uuidv4(),
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
      id: uuidv4(),
      description: `Keep gross transfer spend below GBP ${target}m`,
      type: 'max_spend',
      target,
      met: false,
    };
  }

  const disciplineBoost = profile.transferDiscipline === 'aggressive' ? 1.15 : 1;
  const target = Math.round((minSpendTargets[teamClass] || 5) * disciplineBoost);
  return {
    id: uuidv4(),
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
  id: uuidv4(),
  description,
  type: 'cup_round',
  target: 1,
  met: false,
  competitionId,
  targetRound,
});

export const clampBoardMetric = (value: number) => Math.min(100, Math.max(0, value));

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
      break;
    }
    case 'wins':
      if (team.wins >= objective.target && !met) {
        met = true;
        approvalDelta += 10;
      }
      break;
    case 'cup_round':
      if (
        objective.competitionId &&
        objective.targetRound &&
        hasReachedCompetitionRound(context?.competitions?.[objective.competitionId], team.id, objective.targetRound) &&
        !met
      ) {
        met = true;
        approvalDelta += objective.competitionId === 'europe' ? 16 : 12;
      }
      break;
    case 'spend':
      if ((team.transferSpend || 0) >= objective.target && !met) {
        met = true;
        approvalDelta += 10;
      }
      break;
    case 'max_spend':
      if (isSeasonComplete && (team.transferSpend || 0) <= objective.target && !met) {
        met = true;
        approvalDelta += 8;
      }
      break;
    case 'goalDiff':
    default:
      break;
  }

  return { objective: { ...objective, met }, approvalDelta };
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
  const last = form[form.length - 1];
  if (last === 'L') return -2;
  if (last === 'W') return 1;
  return 0;
};

const getReviewVerdict = (
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
  const objectiveResult = evaluateBoardObjectives(objectives, team, teams, context);
  const updatedObjectives = objectiveResult.updatedObjectives;
  const reasons: string[] = [];
  const patienceModifier = getPatienceModifier(team.boardProfile);
  let approvalChange = objectiveResult.approvalChange + getFormApprovalDelta(team.form || []);

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
      if (objective.met) return;
      const competition = objective.competitionId
        ? context?.competitions?.[objective.competitionId]
        : undefined;
      const isCompetitionResolved = !competition || competition.eliminatedTeamIds.includes(team.id);
      if (!isSeasonComplete && !isCompetitionResolved) return;
      const penalty = objective.competitionId === 'europe'
        ? 5
        : team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe'
          ? 3
          : 2;
      approvalChange -= penalty;
      reasons.push(`${objective.description.toLowerCase()} was missed`);
    });

  const financialObjective = updatedObjectives.find(objective => (
    objective.type === 'spend' || objective.type === 'max_spend'
  ));
  if (financialObjective && isSeasonComplete && !financialObjective.met) {
    const penalty = financialObjective.type === 'max_spend'
      ? team.boardProfile.transferDiscipline === 'strict' ? 5 : 3
      : team.boardProfile.transferDiscipline === 'aggressive' ? 3 : 2;
    approvalChange -= penalty;
    reasons.push(financialObjective.description.toLowerCase());
  }

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
    Math.max(0, positionDelta || 0) * ambitionWeight
  );
  const pressureScore = clampBoardMetric(Math.round(
    ((100 - nextApproval) * 0.45) +
    ((100 - jobSecurity) * 0.20) +
    (Math.max(0, positionDelta || 0) * 6) +
    (missedObjectives * 5) +
    getPatienceRiskModifier(team.boardProfile)
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
  };
};

export const shouldReplaceManagerAfterReview = (
  team: Team,
  review: BoardReview
) => {
  if (review.verdict === 'critical') {
    return {
      shouldReplace: true,
      reason: review.reasons[0] || 'season targets were missed badly',
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
      reason: review.reasons[0] || 'results and board confidence both fell away',
    };
  }

  if (
    team.boardProfile.patience === 'low' &&
    review.nextApproval < 28 &&
    review.positionDelta !== null &&
    review.positionDelta >= 2
  ) {
    return {
      shouldReplace: true,
      reason: review.reasons[0] || 'the board decided the trajectory was no longer acceptable',
    };
  }

  return { shouldReplace: false, reason: '' };
};

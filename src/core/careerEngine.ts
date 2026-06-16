import { CareerRecord, CompetitionState, SeasonSummary, Team, TrophyEntry } from '../models/types';
import { DIVISION_ORDER, PROMOTION_COUNT, RELEGATION_COUNT, sortTeamsByTable } from './leagueUtils';
import { getCompetitionResultForTeam } from './competitionEngine';

const getBoardVerdict = (team: Team): SeasonSummary['boardVerdict'] => {
  if (team.boardApproval < 20 || team.manager.replacementRisk >= 75 || team.manager.pressureScore >= 80) {
    return 'critical';
  }
  if (team.boardApproval < 35 || team.manager.replacementRisk >= 60 || team.manager.pressureScore >= 60) {
    return 'warning';
  }
  if (team.boardApproval >= 70 && team.manager.replacementRisk < 30 && team.manager.pressureScore < 35) {
    return 'thriving';
  }
  return 'stable';
};

type CareerTrajectory = 'upward' | 'steady' | 'downward';

const getDivisionIndex = (division: Team['division']) => (
  division === 'Continental' ? 0 : DIVISION_ORDER.indexOf(division)
);

const getTrajectoryAmbitionScore = (
  ambition: Team['boardProfile']['ambition'],
  trajectory: CareerTrajectory
) => {
  if (trajectory === 'upward') {
    if (ambition === 'elite') return 18;
    if (ambition === 'europe') return 12;
    if (ambition === 'promotion') return 6;
    if (ambition === 'survival') return -8;
    return 2;
  }

  if (trajectory === 'downward') {
    if (ambition === 'survival') return 14;
    if (ambition === 'stability') return 10;
    if (ambition === 'promotion') return 4;
    if (ambition === 'elite') return -12;
    return -3;
  }

  if (ambition === 'stability' || ambition === 'promotion') return 6;
  if (ambition === 'elite') return 2;
  return 0;
};

const getJobOfferCandidateScore = (
  team: Team,
  currentDivisionIndex: number,
  trajectory: CareerTrajectory
) => {
  const ambitionWeight = {
    elite: 35,
    europe: 26,
    promotion: 18,
    stability: 10,
    survival: 4,
  }[team.boardProfile.ambition];
  const teamDivisionIndex = getDivisionIndex(team.division);
  const divisionDelta = currentDivisionIndex - teamDivisionIndex;
  const divisionTrajectoryScore = trajectory === 'upward'
    ? divisionDelta * 14
    : trajectory === 'downward'
      ? (-divisionDelta) * 8
      : -Math.abs(divisionDelta) * 4;
  const urgencyScore =
    team.manager.replacementRisk +
    ((100 - team.manager.jobSecurity) * 0.55) +
    (team.boardProfile.patience === 'low' ? 8 : 0);
  const ambitionFit = getTrajectoryAmbitionScore(team.boardProfile.ambition, trajectory);

  return (
    (team.budget * 2) +
    ambitionWeight +
    urgencyScore +
    ambitionFit +
    divisionTrajectoryScore
  );
};

export const createDefaultCareerRecord = (): CareerRecord => ({
  seasonsManaged: 0,
  totalWins: 0,
  totalDraws: 0,
  totalLosses: 0,
  totalGoalsFor: 0,
  totalGoalsAgainst: 0,
  reputation: 50,
  trophies: [],
  seasonHistory: [],
  consecutiveLowApprovalWeeks: 0,
});

export const buildSeasonSummary = (
  season: number,
  team: Team,
  allTeams: Record<string, Team>,
  competitions: Record<string, CompetitionState>
): SeasonSummary => {
  const divisionTeams = sortTeamsByTable(
    Object.values(allTeams).filter(t => t.division === team.division)
  );
  const totalTeams = divisionTeams.length;
  const position = divisionTeams.findIndex(t => t.id === team.id) + 1 || 1;
  const leagueDivision = team.division === 'Continental' ? 'Premier League' : team.division;
  const divIndex = DIVISION_ORDER.indexOf(leagueDivision);
  const hasUpperDivision = divIndex > 0;
  const hasLowerDivision = divIndex < DIVISION_ORDER.length - 1;

  let outcome: SeasonSummary['outcome'] = 'stayed';
  if (position === 1) outcome = 'champion';
  else if (hasUpperDivision && position <= PROMOTION_COUNT) outcome = 'promoted';
  else if (hasLowerDivision && totalTeams > 0 && position > totalTeams - RELEGATION_COUNT) outcome = 'relegated';

  return {
    season,
    teamId: team.id,
    teamName: team.name,
    division: team.division,
    wins: team.wins,
    draws: team.draws,
    losses: team.losses,
    goalsFor: team.goalsFor,
    goalsAgainst: team.goalsAgainst,
    finalPosition: position,
    outcome,
    boardVerdict: getBoardVerdict(team),
    competitionResults: ['carabao-cup', 'fa-cup', 'europe']
      .map(competitionId => getCompetitionResultForTeam(competitions[competitionId], team.id))
      .filter((result): result is NonNullable<typeof result> => Boolean(result)),
  };
};

export const applySeasonEndToCareer = (
  careerRecord: CareerRecord,
  summary: SeasonSummary
): { careerRecord: CareerRecord; reputationDelta: number } => {
  let reputationDelta = 0;
  if (summary.outcome === 'champion') reputationDelta = 8;
  else if (summary.outcome === 'promoted') reputationDelta = 4;
  else if (summary.outcome === 'relegated') reputationDelta = -10;
  else if (summary.outcome === 'sacked') reputationDelta = -5;
  else if (summary.wins > summary.losses) reputationDelta = 2;

  if (summary.boardVerdict === 'thriving') reputationDelta += 1;
  else if (summary.boardVerdict === 'warning') reputationDelta -= 1;
  else if (summary.boardVerdict === 'critical') reputationDelta -= 2;

  const trophies: TrophyEntry[] = [...careerRecord.trophies];
  if (summary.outcome === 'champion') {
    trophies.push({ season: summary.season, division: summary.division, type: 'champion' });
  } else if (summary.outcome === 'promoted') {
    trophies.push({ season: summary.season, division: summary.division, type: 'promoted' });
  } else if (summary.outcome === 'relegated') {
    trophies.push({ season: summary.season, division: summary.division, type: 'relegated' });
  }

  summary.competitionResults.forEach(result => {
    if (result.finish === 'winner') {
      const isEurope = result.competitionId === 'europe';
      reputationDelta += isEurope ? 6 : 3;
      trophies.push({
        season: summary.season,
        division: summary.division,
        type: isEurope ? 'continental_winner' : 'cup_winner',
        competitionId: result.competitionId,
        label: result.name,
      });
      return;
    }
    if (result.finish === 'runner_up') {
      reputationDelta += result.competitionId === 'europe' ? 3 : 1;
      return;
    }
    if (result.finish === 'semi_final') {
      reputationDelta += 1;
    }
  });

  const updatedRecord: CareerRecord = {
    ...careerRecord,
    seasonsManaged: careerRecord.seasonsManaged + 1,
    totalWins: careerRecord.totalWins + summary.wins,
    totalDraws: careerRecord.totalDraws + summary.draws,
    totalLosses: careerRecord.totalLosses + summary.losses,
    totalGoalsFor: careerRecord.totalGoalsFor + summary.goalsFor,
    totalGoalsAgainst: careerRecord.totalGoalsAgainst + summary.goalsAgainst,
    reputation: Math.max(0, Math.min(100, careerRecord.reputation + reputationDelta)),
    trophies,
    seasonHistory: [...careerRecord.seasonHistory, summary].slice(-10),
    consecutiveLowApprovalWeeks: 0,
  };

  return { careerRecord: updatedRecord, reputationDelta };
};

export const evaluateSackingRisk = (
  boardApproval: number | Team,
  consecutiveLowApprovalWeeks: number
): { newConsecutiveWeeks: number; shouldWarn: boolean; isSackingImminent: boolean } => {
  const team = typeof boardApproval === 'number' ? null : boardApproval;
  const approval = typeof boardApproval === 'number' ? boardApproval : boardApproval.boardApproval;
  const lowThreshold = team?.boardProfile.patience === 'low'
    ? 28
    : team?.boardProfile.patience === 'high'
      ? 18
      : 22;
  const warnWeek = team?.boardProfile.patience === 'low' ? 2 : 3;
  const imminentWeek = team?.boardProfile.patience === 'high' ? 5 : team?.boardProfile.patience === 'low' ? 3 : 4;
  const replacementBuffer = team && team.manager.replacementRisk < 55 ? 1 : 0;

  if (approval < lowThreshold) {
    const newWeeks = consecutiveLowApprovalWeeks + 1;
    return {
      newConsecutiveWeeks: newWeeks,
      shouldWarn: newWeeks === warnWeek,
      isSackingImminent: newWeeks >= (imminentWeek + replacementBuffer),
    };
  }
  return { newConsecutiveWeeks: 0, shouldWarn: false, isSackingImminent: false };
};

export const generateJobOfferCandidates = (
  allTeams: Record<string, Team>,
  userTeamId: string,
  summary: SeasonSummary
): Team[] => {
  const leagueDivision = summary.division === 'Continental' ? 'Premier League' : summary.division;
  const divIndex = DIVISION_ORDER.indexOf(leagueDivision);
  const normalizedDivIndex = divIndex < 0 ? 0 : divIndex;
  const targetDivisions: Team['division'][] = [];
  const cupBoost = summary.competitionResults.some(result => (
    result.finish === 'winner' ||
    result.finish === 'runner_up' ||
    result.finish === 'semi_final'
  ));

  const trajectory: CareerTrajectory =
    summary.outcome === 'champion' ||
    summary.outcome === 'promoted' ||
    cupBoost ||
    summary.boardVerdict === 'thriving'
      ? 'upward'
      : summary.outcome === 'relegated' ||
          summary.outcome === 'sacked' ||
          summary.boardVerdict === 'critical'
        ? 'downward'
        : 'steady';

  if (trajectory === 'upward') {
    if (normalizedDivIndex > 0) targetDivisions.push(DIVISION_ORDER[normalizedDivIndex - 1]!);
    targetDivisions.push(leagueDivision);
  } else if (trajectory === 'downward') {
    targetDivisions.push(leagueDivision);
    if (normalizedDivIndex < DIVISION_ORDER.length - 1) targetDivisions.push(DIVISION_ORDER[normalizedDivIndex + 1]!);
  } else {
    targetDivisions.push(leagueDivision);
    if (summary.boardVerdict === 'warning' && normalizedDivIndex < DIVISION_ORDER.length - 1) {
      targetDivisions.push(DIVISION_ORDER[normalizedDivIndex + 1]!);
    }
  }

  const divisionCandidates = Object.values(allTeams)
    .filter(t => (
      t.id !== userTeamId &&
      targetDivisions.includes(t.division) &&
      t.division !== 'Continental'
    ));

  const ambitionFilteredCandidates = divisionCandidates.filter(team => {
    if (trajectory === 'upward') return team.boardProfile.ambition !== 'survival';
    if (trajectory === 'downward') return team.boardProfile.ambition !== 'elite';
    return true;
  });

  const candidatePool = ambitionFilteredCandidates.length > 0
    ? ambitionFilteredCandidates
    : divisionCandidates;

  return candidatePool
    .sort((a, b) => getJobOfferCandidateScore(b, normalizedDivIndex, trajectory) - getJobOfferCandidateScore(a, normalizedDivIndex, trajectory))
    .slice(0, 2);
};

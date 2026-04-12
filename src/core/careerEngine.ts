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

const getJobOfferCandidateScore = (team: Team) => {
  const ambitionWeight = {
    elite: 35,
    europe: 26,
    promotion: 18,
    stability: 10,
    survival: 4,
  }[team.boardProfile.ambition];
  return (
    (team.budget * 2) +
    ambitionWeight +
    (team.manager.replacementRisk * 0.8) +
    ((100 - team.manager.jobSecurity) * 0.3)
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
  const targetDivisions: string[] = [];
  const cupBoost = summary.competitionResults.some(result => (
    result.finish === 'winner' ||
    result.finish === 'runner_up' ||
    result.finish === 'semi_final'
  ));
  const strongBoardStanding = summary.boardVerdict === 'thriving';

  if (summary.outcome === 'champion' || summary.outcome === 'promoted' || cupBoost || strongBoardStanding) {
    if (divIndex > 0) targetDivisions.push(DIVISION_ORDER[divIndex - 1]);
    targetDivisions.push(summary.division);
  } else if (summary.outcome === 'relegated' || summary.outcome === 'sacked') {
    targetDivisions.push(summary.division);
    if (divIndex < DIVISION_ORDER.length - 1) targetDivisions.push(DIVISION_ORDER[divIndex + 1]);
  } else {
    targetDivisions.push(summary.division);
  }

  return Object.values(allTeams)
    .filter(t => (
      t.id !== userTeamId &&
      targetDivisions.includes(t.division) &&
      t.division !== 'Continental'
    ))
    .sort((a, b) => getJobOfferCandidateScore(b) - getJobOfferCandidateScore(a))
    .slice(0, 2);
};

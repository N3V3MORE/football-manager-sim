import { CareerRecord, Division, SeasonSummary, Team, TrophyEntry } from '../models/types';
import { DIVISION_ORDER, PROMOTION_COUNT, RELEGATION_COUNT, sortTeamsByTable } from './leagueUtils';

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
  allTeams: Record<string, Team>
): SeasonSummary => {
  const divisionTeams = sortTeamsByTable(
    Object.values(allTeams).filter(t => t.division === team.division)
  );
  const totalTeams = divisionTeams.length;
  const position = divisionTeams.findIndex(t => t.id === team.id) + 1 || 1;
  const divIndex = DIVISION_ORDER.indexOf(team.division as Division);
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

  const trophies: TrophyEntry[] = [...careerRecord.trophies];
  if (summary.outcome === 'champion') {
    trophies.push({ season: summary.season, division: summary.division, type: 'champion' });
  } else if (summary.outcome === 'promoted') {
    trophies.push({ season: summary.season, division: summary.division, type: 'promoted' });
  } else if (summary.outcome === 'relegated') {
    trophies.push({ season: summary.season, division: summary.division, type: 'relegated' });
  }

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
  boardApproval: number,
  consecutiveLowApprovalWeeks: number
): { newConsecutiveWeeks: number; shouldWarn: boolean; isSackingImminent: boolean } => {
  const LOW_THRESHOLD = 20;
  if (boardApproval < LOW_THRESHOLD) {
    const newWeeks = consecutiveLowApprovalWeeks + 1;
    return {
      newConsecutiveWeeks: newWeeks,
      shouldWarn: newWeeks === 3,
      isSackingImminent: newWeeks >= 4,
    };
  }
  return { newConsecutiveWeeks: 0, shouldWarn: false, isSackingImminent: false };
};

export const generateJobOfferCandidates = (
  allTeams: Record<string, Team>,
  userTeamId: string,
  summary: SeasonSummary
): Team[] => {
  const divIndex = DIVISION_ORDER.indexOf(summary.division as Division);
  const targetDivisions: string[] = [];

  if (summary.outcome === 'champion' || summary.outcome === 'promoted') {
    if (divIndex > 0) targetDivisions.push(DIVISION_ORDER[divIndex - 1]);
    targetDivisions.push(summary.division);
  } else if (summary.outcome === 'relegated' || summary.outcome === 'sacked') {
    targetDivisions.push(summary.division);
    if (divIndex < DIVISION_ORDER.length - 1) targetDivisions.push(DIVISION_ORDER[divIndex + 1]);
  } else {
    targetDivisions.push(summary.division);
  }

  return Object.values(allTeams)
    .filter(t => t.id !== userTeamId && targetDivisions.includes(t.division))
    .sort((a, b) => b.budget - a.budget)
    .slice(0, 2);
};

import { CareerRecord, CompetitionId, CompetitionState, Manager, SeasonSummary, Team, TrophyEntry, UserManagerIdentity } from '../models/types';
import { DIVISION_ORDER, PROMOTION_COUNT, RELEGATION_COUNT, sortTeamsByTable } from './leagueUtils';
import { getCompetitionResultForTeam } from './competitionEngine';
import { getReviewVerdict, getSackingApprovalThreshold } from './boardEngine';
import { appointReplacementManager, calculateAgeFromDob } from './managerUtils';

/** Build a stable unique key for a trophy entry: `season|type|competitionId|label` */
export const buildTrophyId = (
  season: number,
  type: TrophyEntry['type'],
  competitionId?: CompetitionId,
  label?: string
): string => `${season}|${type}|${competitionId ?? ''}|${label ?? ''}`;

const getBoardVerdict = (team: Team): SeasonSummary['boardVerdict'] => (
  getReviewVerdict(team.boardApproval, team.manager.pressureScore, team.manager.replacementRisk)
);

type CareerTrajectory = 'upward' | 'steady' | 'downward';

const getDivisionIndex = (division: Team['division']) => {
  if (division === 'Continental') return 0;
  const idx = DIVISION_ORDER.indexOf(division);
  return idx >= 0 ? idx : DIVISION_ORDER.length;
};

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

export const buildUserManagerIdentity = (manager: Manager): UserManagerIdentity => ({
  name: manager.name,
  nationality: manager.nationality,
  dateOfBirth: manager.dateOfBirth,
  preferredFormations: manager.preferredFormations,
  tacticalIdentity: manager.tacticalIdentity,
  transferIdentity: manager.transferIdentity,
});

const applyUserIdentityToManager = (
  manager: Manager,
  team: Team,
  userManager: UserManagerIdentity
): Manager => {
  const computedAge = calculateAgeFromDob(userManager.dateOfBirth);

  return {
    ...manager,
    id: team.id,
    teamId: team.id,
    teamName: team.name,
    name: userManager.name,
    nationality: userManager.nationality,
    dateOfBirth: userManager.dateOfBirth,
    age: Number.isFinite(computedAge) ? computedAge : manager.age,
    preferredFormations: userManager.preferredFormations.length > 0
      ? userManager.preferredFormations
      : manager.preferredFormations,
    tacticalIdentity: userManager.tacticalIdentity,
    transferIdentity: userManager.transferIdentity,
    status: 'Permanent',
  };
};

const buildVacatedClubManager = (team: Team, userManager: UserManagerIdentity): Manager => {
  const replacement = appointReplacementManager(team, team.division);
  const replacementName = replacement.name === userManager.name
    ? `${team.name} Caretaker`
    : replacement.name;

  return {
    ...replacement,
    id: team.id,
    teamId: team.id,
    teamName: team.name,
    name: replacementName,
    status: 'Caretaker',
  };
};

export const moveUserManagerToTeam = (
  allTeams: Record<string, Team>,
  currentTeamId: string | null | undefined,
  targetTeamId: string,
  careerRecord: CareerRecord
): { teams: Record<string, Team>; careerRecord: CareerRecord; userManager?: UserManagerIdentity } => {
  const targetTeam = allTeams[targetTeamId];
  if (!targetTeam) {
    return { teams: allTeams, careerRecord, userManager: careerRecord.userManager };
  }

  const currentTeam = currentTeamId ? allTeams[currentTeamId] : undefined;
  const userManager = careerRecord.userManager ?? (currentTeam ? buildUserManagerIdentity(currentTeam.manager) : undefined);
  if (!userManager) {
    return { teams: allTeams, careerRecord };
  }

  const nextTeams = { ...allTeams };
  if (currentTeam && currentTeam.id !== targetTeamId) {
    nextTeams[currentTeam.id] = {
      ...currentTeam,
      manager: buildVacatedClubManager(currentTeam, userManager),
    };
  }

  const updatedTargetTeam = nextTeams[targetTeamId] || targetTeam;
  nextTeams[targetTeamId] = {
    ...updatedTargetTeam,
    manager: applyUserIdentityToManager(updatedTargetTeam.manager, updatedTargetTeam, userManager),
  };

  return {
    teams: nextTeams,
    careerRecord: {
      ...careerRecord,
      userManager,
    },
    userManager,
  };
};

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
  const idx = divisionTeams.findIndex(t => t.id === team.id);
  const position = idx >= 0 ? idx + 1 : totalTeams;
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
  const existingIds = new Set(careerRecord.trophies.map(t => t.id).filter(Boolean) as string[]);
  const addTrophy = (entry: TrophyEntry) => {
    const id = buildTrophyId(entry.season, entry.type, entry.competitionId, entry.label);
    if (!existingIds.has(id)) {
      existingIds.add(id);
      trophies.push({ ...entry, id });
    }
  };
  if (summary.outcome === 'champion') {
    addTrophy({ season: summary.season, division: summary.division, type: 'champion' });
  } else if (summary.outcome === 'promoted') {
    addTrophy({ season: summary.season, division: summary.division, type: 'promoted' });
  }
  // NOTE: Relegation is recorded in seasonHistory but no longer stored as a trophy entry.

  summary.competitionResults.forEach(result => {
    if (result.finish === 'winner') {
      const isEurope = result.competitionId === 'europe';
      reputationDelta += isEurope ? 6 : 3;
      addTrophy({
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

export const getSackingImminentWeek = (team?: Team | null): number => {
  const baseWeek = team?.boardProfile.patience === 'high'
    ? 5
    : team?.boardProfile.patience === 'low'
      ? 3
      : 4;
  const replacementBuffer = team && team.manager.replacementRisk < 55 ? 1 : 0;
  return baseWeek + replacementBuffer;
};

export const dismissUserManagerFromTeam = (
  allTeams: Record<string, Team>,
  competitions: Record<string, CompetitionState>,
  teamId: string,
  careerRecord: CareerRecord,
  season: number
): {
  teams: Record<string, Team>;
  careerRecord: CareerRecord;
  summary: SeasonSummary;
  reputationDelta: number;
} | null => {
  const team = allTeams[teamId];
  if (!team) return null;
  const userManager = careerRecord.userManager ?? buildUserManagerIdentity(team.manager);
  const summary = buildSeasonSummary(season, team, allTeams, competitions);
  summary.outcome = 'sacked';
  const careerUpdate = applySeasonEndToCareer(
    { ...careerRecord, userManager },
    summary
  );

  return {
    teams: {
      ...allTeams,
      [team.id]: {
        ...team,
        manager: buildVacatedClubManager(team, userManager),
      },
    },
    careerRecord: careerUpdate.careerRecord,
    summary,
    reputationDelta: careerUpdate.reputationDelta,
  };
};

export const evaluateSackingRisk = (
  boardApproval: number | Team,
  consecutiveLowApprovalWeeks: number
): { newConsecutiveWeeks: number; shouldWarn: boolean; isSackingImminent: boolean } => {
  const team = typeof boardApproval === 'number' ? null : boardApproval;
  const approval = typeof boardApproval === 'number' ? boardApproval : boardApproval.boardApproval;
  const lowThreshold = getSackingApprovalThreshold(team);
  const warnWeek = team?.boardProfile.patience === 'low' ? 2 : 3;
  const imminentWeek = getSackingImminentWeek(team);

  if (approval < lowThreshold) {
    const newWeeks = consecutiveLowApprovalWeeks + 1;
    return {
      newConsecutiveWeeks: newWeeks,
      shouldWarn: newWeeks === warnWeek,
      isSackingImminent: newWeeks >= imminentWeek,
    };
  }
  return { newConsecutiveWeeks: 0, shouldWarn: false, isSackingImminent: false };
};

/**
 * Returns true when a club is unlikely to be hiring — the manager is secure and
 * not at immediate risk of replacement.
 */
const isManagerStable = (team: Team): boolean => {
  const { manager } = team;
  // High job security + low replacement risk + good board approval → stable
  if (manager.jobSecurity >= 70 && manager.replacementRisk <= 25 && team.boardApproval >= 65) {
    return true;
  }
  // Manager recently appointed (contract > 2.5 years) and board is happy
  if (manager.contractYearsRemaining > 2.5 && team.boardApproval >= 60) {
    return true;
  }
  return false;
};

export const generateJobOfferCandidates = (
  allTeams: Record<string, Team>,
  userTeamId: string,
  summary: SeasonSummary,
  /** The user's career reputation (0-100). Defaults to 50 if not provided. */
  reputation = 50,
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

  // --- Reputation gates: high rep can reach further up; low rep is limited ---
  const canReachUpward = reputation >= 60 || trajectory === 'upward';
  const upwardSteps = reputation >= 80 ? 2 : 1;

  if (trajectory === 'upward') {
    if (canReachUpward && normalizedDivIndex > 0) {
      // Allow reaching 1 division up (or 2 for very high rep)
      for (let step = 1; step <= Math.min(upwardSteps, normalizedDivIndex); step++) {
        targetDivisions.push(DIVISION_ORDER[normalizedDivIndex - step]);
      }
    }
    targetDivisions.push(leagueDivision);
  } else if (trajectory === 'downward') {
    targetDivisions.push(leagueDivision);
    if (normalizedDivIndex < DIVISION_ORDER.length - 1) targetDivisions.push(DIVISION_ORDER[normalizedDivIndex + 1]);
    // Low reputation can also push further down
    if (reputation <= 30 && normalizedDivIndex < DIVISION_ORDER.length - 2) {
      targetDivisions.push(DIVISION_ORDER[normalizedDivIndex + 2]);
    }
  } else {
    targetDivisions.push(leagueDivision);
    if (summary.boardVerdict === 'warning' && normalizedDivIndex < DIVISION_ORDER.length - 1) {
      targetDivisions.push(DIVISION_ORDER[normalizedDivIndex + 1]);
    }
    // High rep in steady trajectory might still attract interest from above
    if (canReachUpward && normalizedDivIndex > 0 && reputation >= 70) {
      targetDivisions.push(DIVISION_ORDER[normalizedDivIndex - 1]);
    }
  }

  // --- Vacancy / instability filter ---
  const divisionCandidates = Object.values(allTeams)
    .filter(t => (
      t.id !== userTeamId &&
      targetDivisions.includes(t.division) &&
      t.division !== 'Continental' &&
      !isManagerStable(t)
    ));

  const ambitionFilteredCandidates = divisionCandidates.filter(team => {
    if (trajectory === 'upward') return team.boardProfile.ambition !== 'survival';
    if (trajectory === 'downward') return team.boardProfile.ambition !== 'elite';
    return true;
  });

  const candidatePool = ambitionFilteredCandidates.length > 0
    ? ambitionFilteredCandidates
    : divisionCandidates;

  // --- Reputation-weighted scoring ---
  const reputationFactor = reputation / 50; // 1.0 at 50, 0.2 at 10, 2.0 at 100

  return candidatePool
    .sort((a, b) => {
      const scoreA = getJobOfferCandidateScore(a, normalizedDivIndex, trajectory) * reputationFactor;
      const scoreB = getJobOfferCandidateScore(b, normalizedDivIndex, trajectory) * reputationFactor;
      return scoreB - scoreA;
    })
    .slice(0, 2);
};

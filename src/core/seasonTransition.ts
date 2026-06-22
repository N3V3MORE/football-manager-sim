import { BoardObjective, CompetitionState, ContractDecision, Division, Fixture, LeagueDivision, Player, Team } from '../models/types';
import {
  DIVISION_ORDER,
  PROMOTION_COUNT,
  RELEGATION_COUNT,
  sortTeamsByTable,
} from './leagueUtils';
import { getRenewalOffer } from './contractUtils';
import { buildSquadPlan } from './squadPlanningEngine';
import { rebuildFormationMap, removePlayerFromTeamSelections } from './formationMapUtils';
import { getSlotsForFormation } from '../constants/formations';
import { buildSeasonCompetitionBundle, getSeasonEuropeQualifiedTeamIds } from './competitionEngine';
import {
  buildBoardObjectives,
  buildBoardProfile,
  clampBoardMetric,
  runBoardReview,
  shouldReplaceManagerAfterReview,
} from './boardEngine';
import { appointReplacementManager, refreshManagerForNewSeason } from './managerUtils';
import { buildQuickSimLineup } from './lineupEngine';
import { getBudgetForClass } from '../utils/calendar';

const resetTeamStats = (team: Team): Team => ({
  ...team,
  points: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  played: 0,
  form: [],
  transferSpend: 0,
});

const getDivisionTeams = (teams: Record<string, Team>, division: LeagueDivision) => (
  sortTeamsByTable(Object.values(teams).filter(team => team.division === division))
);

const formatTeamList = (teams: Team[]) => teams.map(team => team.name).join(', ');

/**
 * Recompute a team's clubClass when it changes division via promotion or relegation.
 * Keeps the algorithm simple: promoted teams get a mid-table class for the new division,
 * relegated teams get a top-half class since they were strong enough to play above.
 */
const recomputeClubClassForDivision = (
  previousDivision: Division,
  nextDivision: Division
): string => {
  // Promotion: assign class appropriate for lower-mid table in the new, higher division.
  if (nextDivision === 'Premier League' && previousDivision !== 'Premier League') return 'C';
  if (nextDivision === 'Championship' && previousDivision === 'League One') return 'D';
  if (nextDivision === 'League One' && previousDivision === 'League Two') return 'E';

  // Relegation: assign class appropriate for top-half in the new, lower division.
  if (nextDivision === 'Championship' && previousDivision === 'Premier League') return 'B';
  if (nextDivision === 'League One' && previousDivision === 'Championship') return 'C';
  if (nextDivision === 'League Two' && previousDivision === 'League One') return 'D';

  // Within same division tier — keep the existing class.
  return '';
};

const getActiveCompetitionIdsForTeam = (
  teamId: string,
  competitions: Record<string, CompetitionState>
) => (
  Object.values(competitions)
    .filter(competition => competition.entrantTeamIds.includes(teamId))
    .map(competition => competition.id)
);

const resetPlayerSeasonStats = (player: Player): Player => ({
  ...player,
  matchesSuspended: 0,
  injuryWeeks: 0,
  injuryType: undefined,
  minutesPlayed: 0,
  goals: 0,
  assists: 0,
  cleanSheets: 0,
  yellowCards: 0,
  redCards: 0,
  matchRatingHistory: [],
});

const MAX_SQUAD_SIZE = 28;
const PREFERRED_SQUAD_SIZE = 24;

const findContractDestinationTeamId = (
  player: Player,
  teams: Record<string, Team>,
  userTeamId: string | null,
  players: Record<string, Player>
) => {
  const currentDivision = teams[player.teamId]?.division;

  const candidateTeams = Object.values(teams)
    .filter(team => team.id !== player.teamId && team.id !== userTeamId)
    .map(team => {
      const squad = Object.values(players).filter(p => p.teamId === team.id);
      const squadSize = squad.length;
      // Count players of the same position already on the candidate team
      const positionDepth = squad.filter(p => p.position === player.position).length;
      // A positional need exists when the team has few players of this position
      const positionalNeedScore = Math.max(0, 3 - positionDepth);
      // Prefer teams that are not at capacity
      const capacityScore = squadSize < PREFERRED_SQUAD_SIZE ? 2 : squadSize < MAX_SQUAD_SIZE ? 1 : 0;
      // Budget fit: prefer teams that can afford the player's market value
      const budgetFit = team.budget - player.marketValue;
      const budgetScore = budgetFit >= 0 ? 1 : 0;
      // Wage context: prefer teams where the player's wage is not an outlier
      const avgWage = squad.length > 0
        ? squad.reduce((sum, p) => sum + p.wage, 0) / squad.length
        : player.wage;
      const wageRatio = avgWage > 0 ? player.wage / avgWage : 1;
      const wageScore = wageRatio <= 1.5 ? 1 : wageRatio <= 2.5 ? 0 : -1;

      return {
        team,
        divisionMatch: team.division === currentDivision ? 1 : 0,
        positionalNeedScore,
        capacityScore,
        budgetScore,
        wageScore,
        budget: team.budget,
      };
    });

  if (candidateTeams.length === 0) return null;

  candidateTeams.sort((a, b) => {
    // 1. Division match
    if (a.divisionMatch !== b.divisionMatch) return b.divisionMatch - a.divisionMatch;
    // 2. Positional need
    if (a.positionalNeedScore !== b.positionalNeedScore) return b.positionalNeedScore - a.positionalNeedScore;
    // 3. Squad capacity
    if (a.capacityScore !== b.capacityScore) return b.capacityScore - a.capacityScore;
    // 4. Budget score (can afford vs cannot)
    if (a.budgetScore !== b.budgetScore) return b.budgetScore - a.budgetScore;
    // 5. Wage fit
    if (a.wageScore !== b.wageScore) return b.wageScore - a.wageScore;
    // 6. Budget size as tiebreaker (higher budget = more room)
    if (b.budget !== a.budget) return b.budget - a.budget;
    // 7. Stable tiebreaker
    return a.team.name.localeCompare(b.team.name);
  });

  return candidateTeams[0].team.id;
};

const reseedTeamLineupForNewSeason = (
  team: Team,
  players: Record<string, Player>
): { team: Team; players: Record<string, Player> } => {
  const updatedPlayers = { ...players };
  const lineupUpdates = buildQuickSimLineup(team.id, updatedPlayers, team.activeFormation);

  Object.entries(lineupUpdates).forEach(([playerId, updates]) => {
    const player = updatedPlayers[playerId];
    if (!player) return;
    updatedPlayers[playerId] = { ...player, ...updates };
  });

  const starters = Object.values(updatedPlayers).filter(player => player.teamId === team.id && player.isStarting);
  const formationMap = rebuildFormationMap(
    getSlotsForFormation(team.activeFormation),
    starters,
    team.formationMap || {}
  );

  return {
    team: {
      ...team,
      formationMap,
      lastStartingXI: starters.map(player => player.id).slice(0, 11),
    },
    players: updatedPlayers,
  };
};

export const advanceSeason = (
  players: Record<string, Player>,
  teams: Record<string, Team>,
  competitions: Record<string, CompetitionState>,
  userTeamId: string | null,
  news: string[],
  skipReviewTeamIds?: string[]
): {
  players: Record<string, Player>;
  teams: Record<string, Team>;
  fixtures: Record<string, Fixture>;
  competitions: Record<string, CompetitionState>;
  currentWeek: number;
  news: string[];
  generatedNews: string[];
  boardObjectives: BoardObjective[];
} => {
  const seasonNews: string[] = [];
  const contractAdjustedPlayers = { ...players };
  const contractAdjustedTeams = { ...teams };

  // Pre-compute squad-plan contract decisions for all AI teams that have expired
  // players so a single, consistent plan drives renew/release/sell decisions.
  const squadContractDecisionMap = new Map<string, ContractDecision>();
  const aiTeamsWithExpiring = new Set<string>();
  for (const player of Object.values(players)) {
    if (player.contractLeft <= 0 && player.teamId !== userTeamId && contractAdjustedTeams[player.teamId]) {
      aiTeamsWithExpiring.add(player.teamId);
    }
  }
  for (const teamId of aiTeamsWithExpiring) {
    const team = contractAdjustedTeams[teamId];
    if (!team) continue;
    const plan = buildSquadPlan(team, contractAdjustedPlayers);
    for (const decision of plan.contractDecisions) {
      squadContractDecisionMap.set(decision.playerId, decision);
    }
  }

  Object.values(players).forEach(player => {
    if (player.contractLeft > 0) return;
    const currentTeam = contractAdjustedTeams[player.teamId];
    if (!currentTeam) return;

    if (player.teamId === userTeamId) {
      const destinationTeamId = findContractDestinationTeamId(player, contractAdjustedTeams, userTeamId, contractAdjustedPlayers);
      if (!destinationTeamId) {
        contractAdjustedPlayers[player.id] = {
          ...player,
          contractLeft: 1,
        };
        return;
      }
      contractAdjustedPlayers[player.id] = {
        ...player,
        teamId: destinationTeamId,
        isStarting: false,
        isSub: false,
        morale: Math.max(60, player.morale),
        contractLeft: 2,
      };
      contractAdjustedTeams[currentTeam.id] = removePlayerFromTeamSelections(currentTeam, player.id);
      seasonNews.push(`${player.name} leaves ${currentTeam.name} after running down his contract.`);
      return;
    }

    // AI-team: use squad-plan contract decision instead of shouldRenewContract.
    const squadDecision = squadContractDecisionMap.get(player.id);
    if (squadDecision && squadDecision.decision === 'renew') {
      const renewal = getRenewalOffer(player);
      contractAdjustedPlayers[player.id] = {
        ...player,
        contractLeft: renewal.years,
        wage: renewal.wage,
      };
      return;
    }

    // Release, sell, or no squad-plan decision: attempt to move to a destination team.
    const destinationTeamId = findContractDestinationTeamId(player, contractAdjustedTeams, userTeamId, contractAdjustedPlayers);
    if (!destinationTeamId) {
      // Conservative fallback: renew with standard terms when no suitable destination exists.
      const renewal = getRenewalOffer(player);
      contractAdjustedPlayers[player.id] = {
        ...player,
        contractLeft: renewal.years,
        wage: renewal.wage,
      };
      return;
    }

    contractAdjustedPlayers[player.id] = {
      ...player,
      teamId: destinationTeamId,
      isStarting: false,
      isSub: false,
      contractLeft: 2,
    };
    contractAdjustedTeams[currentTeam.id] = removePlayerFromTeamSelections(currentTeam, player.id);
  });

  const nextPlayers = Object.fromEntries(
    Object.entries(contractAdjustedPlayers).map(([playerId, player]) => [
      playerId,
      resetPlayerSeasonStats(player),
    ])
  );
  const divisionTables = Object.fromEntries(
    DIVISION_ORDER.map(division => [division, getDivisionTeams(contractAdjustedTeams, division)])
  ) as Record<LeagueDivision, Team[]>;
  const nextDivisionByTeamId: Record<string, Division> = Object.fromEntries(
    Object.values(contractAdjustedTeams).map(team => [team.id, team.division])
  ) as Record<string, Division>;

  DIVISION_ORDER.forEach((division, index) => {
    const divisionTeams = divisionTables[division] || [];
    const upperDivision = DIVISION_ORDER[index - 1];
    const lowerDivision = DIVISION_ORDER[index + 1];
    const promotedCount = upperDivision ? Math.min(PROMOTION_COUNT, divisionTeams.length) : 0;

    if (upperDivision) {
      const promoted = divisionTeams.slice(0, promotedCount);
      promoted.forEach(team => {
        nextDivisionByTeamId[team.id] = upperDivision;
      });
      if (promoted.length > 0) seasonNews.push(`Promoted to ${upperDivision}: ${formatTeamList(promoted)}.`);
    }

    if (lowerDivision) {
      const relegationStart = Math.max(promotedCount, divisionTeams.length - RELEGATION_COUNT);
      const relegated = divisionTeams.slice(relegationStart);
      relegated.forEach(team => {
        nextDivisionByTeamId[team.id] = lowerDivision;
      });
      if (relegated.length > 0) seasonNews.push(`Relegated to ${lowerDivision}: ${formatTeamList(relegated)}.`);
    }
  });

  // Recompute clubClass for teams that changed division via promotion/relegation.
  const nextClubClassByTeamId: Record<string, string> = {};
  Object.entries(nextDivisionByTeamId).forEach(([teamId, nextDivision]) => {
    const team = contractAdjustedTeams[teamId];
    if (!team || nextDivision === team.division) return;
    const newClass = recomputeClubClassForDivision(team.division, nextDivision);
    if (newClass) {
      nextClubClassByTeamId[teamId] = newClass;
    }
  });

  const skipReviewSet = new Set(skipReviewTeamIds ?? []);

  const reviewedTeams = Object.fromEntries(
    Object.entries(contractAdjustedTeams).map(([teamId, team]) => {
      const nextDivision = nextDivisionByTeamId[teamId] || team.division;
      const nextClubClass = nextClubClassByTeamId[teamId] || team.clubClass || 'C';
      const nextBoardProfile = buildBoardProfile(nextClubClass, nextDivision, Boolean(team.isExternal));

      // Skip review for teams that already had a season-end review applied (e.g. user team via weekly lifecycle)
      if (skipReviewSet.has(teamId)) {
        const nextTeam: Team = {
          ...team,
          division: nextDivision,
          clubClass: nextClubClass,
          boardProfile: nextBoardProfile,
          boardApproval: team.boardApproval,
          budget: nextClubClassByTeamId[teamId]
            ? getBudgetForClass(nextClubClass)
            : team.budget,
          operatingBudget: nextClubClassByTeamId[teamId]
            ? getBudgetForClass(nextClubClass)
            : team.operatingBudget,
          manager: refreshManagerForNewSeason(team.manager, nextBoardProfile, nextDivision),
        };
        return [teamId, resetTeamStats(nextTeam)];
      }

      const currentBoardProfile = team.boardProfile || buildBoardProfile(
        team.clubClass || 'C',
        team.division,
        Boolean(team.isExternal)
      );
      // Review objectives are based on the season just ended (OLD division & clubClass).
      const reviewObjectives = buildBoardObjectives(
        team.clubClass || 'C',
        team.division,
        currentBoardProfile,
        getActiveCompetitionIdsForTeam(teamId, competitions)
      );
      const review = runBoardReview(
        { ...team, boardProfile: currentBoardProfile },
        contractAdjustedTeams,
        reviewObjectives,
        {
          isSeasonComplete: true,
          competitions,
          players: nextPlayers,
        }
      );

      let nextTeam: Team = {
        ...team,
        division: nextDivision,
        clubClass: nextClubClass,
        boardProfile: nextBoardProfile,
        boardApproval: review.nextApproval,
        budget: nextClubClassByTeamId[teamId]
          ? getBudgetForClass(nextClubClass)
          : team.budget,
        operatingBudget: nextClubClassByTeamId[teamId]
          ? getBudgetForClass(nextClubClass)
          : team.operatingBudget,
        manager: refreshManagerForNewSeason(review.nextManager, nextBoardProfile, nextDivision),
      };

      if (teamId !== userTeamId) {
        const replacementDecision = shouldReplaceManagerAfterReview(nextTeam, review);
        if (replacementDecision.shouldReplace) {
          const previousManagerName = team.manager.name;
          const replacementManager = appointReplacementManager(nextTeam, nextDivision);
          nextTeam = {
            ...nextTeam,
            manager: replacementManager,
            boardApproval: clampBoardMetric(Math.max(review.nextApproval, 42) + 6),
          };
          seasonNews.push(
            `${team.name} part ways with ${previousManagerName} after the board judged that ${replacementDecision.reason}. ${replacementManager.name} takes charge.`
          );
        }
      }

      return [teamId, resetTeamStats(nextTeam)];
    })
  ) as Record<string, Team>;

  let lineupSeededPlayers = nextPlayers;
  const lineupSeededTeams = Object.fromEntries(
    Object.entries(reviewedTeams).map(([teamId, team]) => {
      const seeded = reseedTeamLineupForNewSeason(team, lineupSeededPlayers);
      lineupSeededPlayers = seeded.players;
      return [teamId, seeded.team];
    })
  ) as Record<string, Team>;

  const europeQualifiedTeamIds = getSeasonEuropeQualifiedTeamIds(contractAdjustedTeams, competitions);
  if (europeQualifiedTeamIds.length > 0) {
    const qualifierNames = europeQualifiedTeamIds
      .map(teamId => contractAdjustedTeams[teamId]?.name)
      .filter((name): name is string => Boolean(name));
    seasonNews.push(`European places secured: ${qualifierNames.join(', ')}.`);
  }

  const currentSeasonNumber = Object.values(competitions).reduce((max, competition) => (
    Math.max(max, competition.season || 0)
  ), 0);
  const nextSeasonBundle = buildSeasonCompetitionBundle(
    lineupSeededTeams,
    currentSeasonNumber + 1,
    europeQualifiedTeamIds
  );

  const boardObjectives = userTeamId && lineupSeededTeams[userTeamId]
    ? buildBoardObjectives(
        lineupSeededTeams[userTeamId].clubClass || 'C',
        lineupSeededTeams[userTeamId].division as LeagueDivision,
        lineupSeededTeams[userTeamId].boardProfile,
        getActiveCompetitionIdsForTeam(userTeamId, nextSeasonBundle.competitions)
      )
    : [];

  return {
    players: lineupSeededPlayers,
    teams: lineupSeededTeams,
    fixtures: nextSeasonBundle.fixtures,
    competitions: nextSeasonBundle.competitions,
    currentWeek: 1,
    boardObjectives,
    generatedNews: [...seasonNews, 'A new season has begun.'],
    news: [...seasonNews, 'A new season has begun.', ...news].slice(0, 20),
  };
};

import { BoardObjective, CompetitionState, Division, Fixture, LeagueDivision, Player, Team } from '../models/types';
import {
  DIVISION_ORDER,
  PROMOTION_COUNT,
  RELEGATION_COUNT,
  sortTeamsByTable,
} from './leagueUtils';
import { getRenewalOffer, shouldRenewContract } from './contractUtils';
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

const findContractDestinationTeamId = (
  player: Player,
  teams: Record<string, Team>,
  userTeamId: string | null
) => {
  const currentDivision = teams[player.teamId]?.division;
  return Object.values(teams)
    .filter(team => team.id !== player.teamId && team.id !== userTeamId)
    .sort((a, b) => {
      if (a.division === currentDivision && b.division !== currentDivision) return -1;
      if (b.division === currentDivision && a.division !== currentDivision) return 1;
      return a.budget - b.budget;
    })[0]?.id || null;
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
  news: string[]
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

  Object.values(players).forEach(player => {
    if (player.contractLeft > 0) return;
    const currentTeam = contractAdjustedTeams[player.teamId];
    if (!currentTeam) return;

    if (player.teamId === userTeamId) {
      const destinationTeamId = findContractDestinationTeamId(player, contractAdjustedTeams, userTeamId);
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

    if (shouldRenewContract(player, currentTeam)) {
      const renewal = getRenewalOffer(player);
      contractAdjustedPlayers[player.id] = {
        ...player,
        contractLeft: renewal.years,
        wage: renewal.wage,
      };
      return;
    }

    const destinationTeamId = findContractDestinationTeamId(player, contractAdjustedTeams, userTeamId);
    if (!destinationTeamId) {
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

  const reviewedTeams = Object.fromEntries(
    Object.entries(contractAdjustedTeams).map(([teamId, team]) => {
      const currentBoardProfile = team.boardProfile || buildBoardProfile(
        team.clubClass || 'C',
        team.division,
        Boolean(team.isExternal)
      );
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
      const nextDivision = nextDivisionByTeamId[teamId] || team.division;
      const nextBoardProfile = buildBoardProfile(team.clubClass || 'C', nextDivision, Boolean(team.isExternal));

      let nextTeam: Team = {
        ...team,
        division: nextDivision,
        boardProfile: nextBoardProfile,
        boardApproval: review.nextApproval,
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

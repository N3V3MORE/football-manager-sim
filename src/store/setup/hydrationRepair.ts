import { buildInitialCupStates } from '../../core/cupUtils';
import { DEFAULT_COMPETITION_ID, DEFAULT_LEAGUE_ID, getFixtureCompetitionId, getTeamLeagueId } from '../../core/domainRegistry';
import { extractTraitIds } from '../../core/tacticalEffects';
import { ensureTrophyCabinetShape } from '../../core/trophyUtils';
import { CupCompetition, CupState, Fixture, Player, SeasonResult, Team, TrophyCabinet, TrophyHistoryEntry } from '../../models/types';

type HydrationSnapshot = {
  teams: Record<string, Team>;
  players: Record<string, Player>;
  cups?: Record<CupCompetition, CupState>;
  fixtures: Record<string, Fixture>;
  season?: number;
  isSeasonSkipInProgress?: boolean;
  trophyCabinet?: TrophyCabinet;
  trophyHistory?: TrophyHistoryEntry[];
  seasonResults?: SeasonResult[];
};

type HydrationRepairs = Partial<HydrationSnapshot>;

export const getHydrationRepairs = (state: HydrationSnapshot): HydrationRepairs => {
  const repairs: HydrationRepairs = {};

  if (Object.values(state.teams).some(team => !team.leagueId || !team.division)) {
    repairs.teams = Object.fromEntries(
      Object.entries(state.teams).map(([teamId, team]) => [
        teamId,
        {
          ...team,
          leagueId: getTeamLeagueId(team),
          division: getTeamLeagueId(team),
          countryId: team.countryId || 'england',
          clubClass: team.clubClass || 'C',
        },
      ])
    );
  }

  if (Object.values(state.players).some(player => !Array.isArray(player.traitIds))) {
    repairs.players = Object.fromEntries(
      Object.entries(state.players).map(([playerId, player]) => [
        playerId,
        {
          ...player,
          traitIds: Array.isArray(player.traitIds) ? player.traitIds : extractTraitIds(player),
        },
      ])
    );
  }

  if (!state.cups || Object.keys(state.cups).length === 0) {
    repairs.cups = {
      ...buildInitialCupStates(state.teams),
      ...(state.cups || {}),
    };
  }

  if (Object.values(state.fixtures).some(fixture => !fixture.competitionId || !fixture.competition)) {
    repairs.fixtures = Object.fromEntries(
      Object.entries(state.fixtures).map(([fixtureId, fixture]) => [
        fixtureId,
        {
          ...fixture,
          competitionId: getFixtureCompetitionId(fixture),
          competition: getFixtureCompetitionId(fixture),
          leagueId: fixture.leagueId || fixture.division || state.teams[fixture.homeTeamId]?.leagueId || DEFAULT_LEAGUE_ID,
          division: fixture.leagueId || fixture.division || state.teams[fixture.homeTeamId]?.leagueId || DEFAULT_LEAGUE_ID,
          roundNumber: fixture.roundNumber || 1,
          roundName: fixture.roundName || state.teams[fixture.homeTeamId]?.leagueId || DEFAULT_LEAGUE_ID,
        },
      ])
    );
  }

  if (state.cups && Object.values(state.cups).some(cup => !cup.competitionId || !cup.competition)) {
    repairs.cups = Object.fromEntries(
      Object.entries(state.cups).map(([competitionId, cup]) => [
        competitionId,
        {
          ...cup,
          competitionId: cup.competitionId || cup.competition || competitionId || DEFAULT_COMPETITION_ID,
          competition: cup.competitionId || cup.competition || competitionId || DEFAULT_COMPETITION_ID,
        },
      ])
    );
  }

  if (!state.season || state.season < 1) {
    repairs.season = 1;
  }

  if (state.isSeasonSkipInProgress) {
    repairs.isSeasonSkipInProgress = false;
  }

  const hasAnyTrophyState = Boolean(state.trophyCabinet) && Array.isArray(state.trophyHistory) && Array.isArray(state.seasonResults);
  if (!hasAnyTrophyState) {
    repairs.trophyCabinet = ensureTrophyCabinetShape(state.trophyCabinet);
    repairs.trophyHistory = Array.isArray(state.trophyHistory) ? state.trophyHistory : [];
    repairs.seasonResults = Array.isArray(state.seasonResults) ? state.seasonResults : [];
    return repairs;
  }

  const shapedTrophies = ensureTrophyCabinetShape(state.trophyCabinet);
  const hasAllTrophyKeys = Object.keys(shapedTrophies).every(
    key => shapedTrophies[key as keyof TrophyCabinet] === state.trophyCabinet?.[key as keyof TrophyCabinet]
  );
  if (!hasAllTrophyKeys) {
    repairs.trophyCabinet = shapedTrophies;
  }

  return repairs;
};

export const hasHydrationRepairs = (repairs: HydrationRepairs) => Object.keys(repairs).length > 0;

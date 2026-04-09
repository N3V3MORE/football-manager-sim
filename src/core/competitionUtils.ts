import { CompetitionId, Fixture } from '../models/types';
import { getCompetitionDefinition, getCompetitionDisplayName, getFixtureCompetitionId, isCupCompetitionId } from './domainRegistry';

export const isCupCompetition = (competitionId: CompetitionId) => isCupCompetitionId(competitionId);

export const getFixtureCompetitionLabel = (fixture: Fixture) => {
  const competitionId = getFixtureCompetitionId(fixture);
  if (!isCupCompetitionId(competitionId)) {
    return fixture.roundName || getCompetitionDisplayName(competitionId);
  }

  const roundLabel = fixture.roundName || `Round ${fixture.roundNumber || 1}`;
  return `${getCompetitionDisplayName(competitionId)} ${roundLabel}`;
};

export const resolveCupWinnerTeamId = (
  fixture: Fixture,
  homeScore: number,
  awayScore: number,
  random: () => number = Math.random
) => {
  if (!isCupCompetitionId(getFixtureCompetitionId(fixture))) return undefined;
  if (homeScore > awayScore) return fixture.homeTeamId;
  if (awayScore > homeScore) return fixture.awayTeamId;
  if (fixture.winnerTeamId) return fixture.winnerTeamId;
  return random() < 0.5 ? fixture.homeTeamId : fixture.awayTeamId;
};

export const getCompetitionCountryScope = (competitionId: CompetitionId) => (
  getCompetitionDefinition(competitionId).countryScope
);

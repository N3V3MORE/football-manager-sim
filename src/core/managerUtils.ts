import { Division, Formation, Manager, ManagerStatus } from '../models/types';
import { PremierLeagueManagerSource } from '../data/premier_league_managers';

export const ratingToPercent = (value: number) => Math.max(0, Math.min(100, Math.round((value / 5) * 100)));

export const parsePreferredFormations = (value: string[]): Formation[] => (
  value.filter((formation): formation is Formation => [
    '4-3-3',
    '3-4-3',
    '5-2-3',
    '4-4-2',
    '4-2-3-1',
    '3-5-2',
    '4-1-4-1',
    '4-3-2-1',
    '3-4-2-1',
    '4-5-1',
    '4-2-2-2',
    '3-2-4-1',
  ].includes(formation))
);

export const calculateAgeFromDob = (dob: string) => {
  const [day, month, year] = dob.split('/').map(Number);
  const birth = new Date(year, month - 1, day);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
};

export const buildManager = (source: PremierLeagueManagerSource, teamId: string): Manager => ({
  id: teamId,
  teamId,
  teamName: source.teamName,
  name: source.manager,
  nationality: source.nationality,
  dateOfBirth: source.dateOfBirth,
  age: calculateAgeFromDob(source.dateOfBirth),
  appointedAt: source.appointed,
  contractUntil: source.contractUntil,
  status: source.status as ManagerStatus,
  reputation: ratingToPercent(source.reputation),
  preferredFormations: parsePreferredFormations(source.preferredFormations),
  tacticalIdentity: source.tacticalIdentity,
  transferIdentity: source.transferIdentity,
  boardTrust: ratingToPercent(source.boardTrust),
  jobSecurity: ratingToPercent(source.jobSecurity),
  seasonExpectations: source.seasonExpectations,
  clubFit: ratingToPercent(source.clubFit),
  record: {
    played: source.played,
    wins: source.wins,
    draws: source.draws,
    losses: source.losses,
    goalsFor: source.goalsFor,
    goalsAgainst: source.goalsAgainst,
    position: source.position,
  },
});

const getGenericManagerIdentity = (division: Division, clubFit: number) => {
  if (division === 'Premier League') {
    return {
      tacticalIdentity: clubFit >= 70 ? 'Balanced possession with a high defensive line' : 'Disciplined and direct',
      transferIdentity: 'Structured recruitment with selective upgrades',
      seasonExpectations: clubFit >= 70 ? 'Challenge for Europe' : 'Stay competitive in the league',
      preferredFormations: clubFit >= 70 ? ['4-3-3', '4-2-3-1'] : ['4-2-3-1', '4-4-2'],
    };
  }
  if (division === 'Championship') {
    return {
      tacticalIdentity: clubFit >= 68 ? 'Aggressive pressing and quick transitions' : 'Compact shape and counter attack',
      transferIdentity: 'Promotion-focused recruitment with loan market use',
      seasonExpectations: clubFit >= 68 ? 'Push for promotion' : 'Stay clear of relegation',
      preferredFormations: clubFit >= 68 ? ['4-2-3-1', '3-5-2'] : ['4-4-2', '4-2-3-1'],
    };
  }
  if (division === 'League One') {
    return {
      tacticalIdentity: clubFit >= 64 ? 'Direct football with strong set-piece focus' : 'Compact shape and transition play',
      transferIdentity: 'Loans, free transfers and value signings',
      seasonExpectations: clubFit >= 64 ? 'Push into the promotion places' : 'Build stability and stay competitive',
      preferredFormations: clubFit >= 64 ? ['4-4-2', '3-5-2'] : ['4-2-3-1', '4-4-2'],
    };
  }
  return {
    tacticalIdentity: clubFit >= 60 ? 'Direct football with aggressive wide play' : 'Compact and pragmatic football',
    transferIdentity: 'Value signings, loans and free transfers',
    seasonExpectations: clubFit >= 60 ? 'Compete for promotion' : 'Build stability and stay up',
    preferredFormations: clubFit >= 60 ? ['4-4-2', '4-2-3-1'] : ['4-4-2', '3-5-2'],
  };
};

export const buildGenericManager = (
  teamName: string,
  teamId: string,
  division: Division,
  clubFit: number
): Manager => {
  const reputation = Math.max(35, Math.min(80, Math.round(45 + (clubFit * 0.5))));
  const identity = getGenericManagerIdentity(division, clubFit);
  const status: ManagerStatus = 'Permanent';
  const currentYear = new Date().getFullYear();
  return {
    id: teamId,
    teamId,
    teamName,
    name: `${teamName} Head Coach`,
    nationality: 'England',
    dateOfBirth: `${currentYear - 48}-01-01`,
    age: 48,
    appointedAt: `${currentYear - 1}-07-01`,
    contractUntil: `${currentYear + 1}-06-30`,
    status,
    reputation,
    preferredFormations: identity.preferredFormations as Formation[],
    tacticalIdentity: identity.tacticalIdentity,
    transferIdentity: identity.transferIdentity,
    boardTrust: Math.max(30, Math.min(85, Math.round(clubFit * 0.8))),
    jobSecurity: Math.max(30, Math.min(85, Math.round(clubFit * 0.85))),
    seasonExpectations: identity.seasonExpectations,
    clubFit,
    record: {
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      position: 0,
    },
  };
};

export const deriveInitialBoardApproval = (manager: Manager) => (
  Math.round(manager.boardTrust * 0.5 + manager.jobSecurity * 0.3 + manager.clubFit * 0.2)
);

import { BoardProfile, Division, Formation, Manager, ManagerStatus, Team } from '../models/types';
import { PremierLeagueManagerSource } from '../data/premier_league_managers';
import { describeBoardSeasonExpectations } from './boardEngine';

const clampMetric = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

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

const getCurrentYear = () => new Date().getFullYear();

const REPLACEMENT_FIRST_NAMES = [
  'Marco',
  'Adrian',
  'Tobias',
  'Luca',
  'Ruben',
  'Mateo',
  'Julien',
  'Nico',
  'Stefan',
  'Dario',
  'Bruno',
  'Kieran',
  'Aidan',
  'Victor',
  'Enzo',
  'Pablo',
];

const REPLACEMENT_LAST_NAMES = [
  'Varga',
  'Navarro',
  'Ilic',
  'Molina',
  'Rossi',
  'Meyer',
  'Costa',
  'Petrov',
  'Duarte',
  'Santos',
  'Silva',
  'Turner',
  'Hughes',
  'Bennett',
  'Keller',
  'Romero',
];

const REPLACEMENT_NATIONALITIES = [
  'England',
  'Spain',
  'Portugal',
  'Germany',
  'Italy',
  'France',
  'Netherlands',
  'Denmark',
  'Croatia',
  'Belgium',
  'Argentina',
  'Brazil',
];

const REPLACEMENT_TACTICAL_IDENTITIES = [
  'Vertical attacking with high wing overloads',
  'Controlled possession with compact rest defence',
  'Counter-pressing structure with direct final-third play',
  'Low-block discipline with fast transition attacks',
  'Set-piece heavy game model with territorial pressure',
  'Wide rotations and aggressive half-space entries',
  'Pragmatic medium block with direct striker service',
];

const REPLACEMENT_TRANSFER_IDENTITIES = [
  'Data-led recruitment with role-specific profiling',
  'Loan market leverage with high-upside contracts',
  'Experience-first window strategy for short-term stability',
  'Athletic profile prioritization across the spine',
  'Budget-discipline model with targeted value additions',
  'Resale-value model with age-curve control',
];

const REPLACEMENT_FORMATION_POOLS: Formation[][] = [
  ['4-3-3', '4-2-3-1', '4-3-2-1'],
  ['4-4-2', '4-1-4-1', '4-5-1'],
  ['3-4-2-1', '3-5-2', '3-4-3'],
  ['5-2-3', '3-5-2', '4-4-2'],
  ['4-2-2-2', '4-3-3', '3-2-4-1'],
];

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seedAt = (seed: number, salt: number) => (
  (seed ^ Math.imul((salt + 1), 2654435761)) >>> 0
);

const pickSeeded = <T,>(pool: T[], seed: number, salt: number): T => (
  pool[seedAt(seed, salt) % pool.length]
);

const parseYearFromDate = (value: string) => {
  if (!value) return getCurrentYear() + 1;
  if (value.includes('/')) {
    const parts = value.split('/').map(Number);
    return parts[2] || getCurrentYear() + 1;
  }
  if (value.includes('-')) {
    return Number(value.split('-')[0]) || getCurrentYear() + 1;
  }
  return Number(value) || getCurrentYear() + 1;
};

export const deriveContractYearsRemaining = (contractUntil: string) => (
  Math.max(1, parseYearFromDate(contractUntil) - getCurrentYear())
);

export const buildContractUntil = (contractYearsRemaining: number) => (
  `${getCurrentYear() + Math.max(1, contractYearsRemaining)}-06-30`
);

const buildInitialManagerContext = (
  boardTrust: number,
  jobSecurity: number,
  boardProfile?: BoardProfile
) => {
  const patienceModifier = boardProfile?.patience === 'low' ? 10 : boardProfile?.patience === 'high' ? -8 : 0;
  const pressureScore = clampMetric(
    ((100 - boardTrust) * 0.35) +
    ((100 - jobSecurity) * 0.35) +
    patienceModifier +
    18
  );
  const replacementRisk = clampMetric(
    (pressureScore * 0.6) +
    ((100 - jobSecurity) * 0.2) +
    ((100 - boardTrust) * 0.2)
  );
  return { pressureScore, replacementRisk };
};

export const buildManager = (
  source: PremierLeagueManagerSource,
  teamId: string,
  boardProfile?: BoardProfile
): Manager => {
  const boardTrust = ratingToPercent(source.boardTrust);
  const jobSecurity = ratingToPercent(source.jobSecurity);
  const contractYearsRemaining = deriveContractYearsRemaining(source.contractUntil);
  const context = buildInitialManagerContext(boardTrust, jobSecurity, boardProfile);

  return {
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
    boardTrust,
    jobSecurity,
    contractYearsRemaining,
    pressureScore: context.pressureScore,
    replacementRisk: context.replacementRisk,
    seasonExpectations: boardProfile
      ? describeBoardSeasonExpectations(boardProfile, 'Premier League')
      : source.seasonExpectations,
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
  };
};

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
  if (division === 'Continental') {
    return {
      tacticalIdentity: clubFit >= 68 ? 'Aggressive continental pressing with front-foot possession' : 'Structured transition football with compact lines',
      transferIdentity: 'Cross-border recruitment with premium scouting',
      seasonExpectations: 'Compete deep into Europe',
      preferredFormations: clubFit >= 68 ? ['4-3-3', '4-2-3-1'] : ['4-4-2', '4-2-3-1'],
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
  clubFit: number,
  boardProfile?: BoardProfile
): Manager => {
  const reputation = Math.max(35, Math.min(80, Math.round(45 + (clubFit * 0.5))));
  const identity = getGenericManagerIdentity(division, clubFit);
  const status: ManagerStatus = 'Permanent';
  const currentYear = getCurrentYear();
  const boardTrust = Math.max(30, Math.min(85, Math.round(clubFit * 0.8)));
  const jobSecurity = Math.max(30, Math.min(85, Math.round(clubFit * 0.85)));
  const contractYearsRemaining = 2;
  const context = buildInitialManagerContext(boardTrust, jobSecurity, boardProfile);

  return {
    id: teamId,
    teamId,
    teamName,
    name: `${teamName} Head Coach`,
    nationality: 'England',
    dateOfBirth: `${currentYear - 48}-01-01`,
    age: 48,
    appointedAt: `${currentYear - 1}-07-01`,
    contractUntil: `${currentYear + 2}-06-30`,
    status,
    reputation,
    preferredFormations: identity.preferredFormations as Formation[],
    tacticalIdentity: identity.tacticalIdentity,
    transferIdentity: identity.transferIdentity,
    boardTrust,
    jobSecurity,
    contractYearsRemaining,
    pressureScore: context.pressureScore,
    replacementRisk: context.replacementRisk,
    seasonExpectations: boardProfile
      ? describeBoardSeasonExpectations(boardProfile, division)
      : identity.seasonExpectations,
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

export const hydrateManagerContext = (
  manager: Manager,
  boardProfile: BoardProfile,
  division: Division
): Manager => {
  const contractYearsRemaining = Number.isFinite(manager.contractYearsRemaining)
    ? Math.max(1, Math.round(manager.contractYearsRemaining))
    : deriveContractYearsRemaining(manager.contractUntil);
  const context = buildInitialManagerContext(manager.boardTrust, manager.jobSecurity, boardProfile);
  return {
    ...manager,
    contractYearsRemaining,
    contractUntil: manager.contractUntil || buildContractUntil(contractYearsRemaining),
    pressureScore: Number.isFinite(manager.pressureScore) ? manager.pressureScore : context.pressureScore,
    replacementRisk: Number.isFinite(manager.replacementRisk) ? manager.replacementRisk : context.replacementRisk,
    seasonExpectations: describeBoardSeasonExpectations(boardProfile, division),
  };
};

export const deriveInitialBoardApproval = (manager: Manager, boardProfile?: BoardProfile) => (
  clampMetric(
    (manager.boardTrust * 0.5) +
    (manager.jobSecurity * 0.3) +
    (manager.clubFit * 0.2) +
    (boardProfile?.patience === 'low' ? -4 : boardProfile?.patience === 'high' ? 4 : 0)
  )
);

export const refreshManagerForNewSeason = (
  manager: Manager,
  boardProfile: BoardProfile,
  division: Division
): Manager => {
  const shouldExtend = manager.jobSecurity >= 65 || manager.boardTrust >= 68;
  const nextContractYears = manager.contractYearsRemaining > 1
    ? manager.contractYearsRemaining - 1
    : shouldExtend ? 2 : 1;

  return {
    ...manager,
    contractYearsRemaining: nextContractYears,
    contractUntil: buildContractUntil(nextContractYears),
    pressureScore: clampMetric(Math.max(15, manager.pressureScore * 0.65)),
    replacementRisk: clampMetric(Math.max(10, manager.replacementRisk * 0.55)),
    seasonExpectations: describeBoardSeasonExpectations(boardProfile, division),
  };
};

export const appointReplacementManager = (
  team: Team,
  division: Division = team.division
): Manager => {
  const seed = hashString([
    team.id,
    team.name,
    division,
    team.manager?.name || '',
    String(team.points || 0),
    String(team.boardApproval || 0),
    String(team.manager?.replacementRisk || 0),
    String(team.manager?.pressureScore || 0),
  ].join('|'));
  const ambitionBase = {
    elite: 80,
    europe: 74,
    promotion: 69,
    stability: 63,
    survival: 58,
  }[team.boardProfile.ambition];
  const fitJitter = ((seedAt(seed, 1) % 9) - 4);
  const fitScore = Math.max(
    45,
    Math.min(
      88,
      ambitionBase +
      (team.boardProfile.patience === 'low' ? 4 : 0) +
      fitJitter
    )
  );
  const replacement = buildGenericManager(team.name, team.id, division, fitScore, team.boardProfile);
  const firstName = pickSeeded(REPLACEMENT_FIRST_NAMES, seed, 2);
  const lastName = pickSeeded(REPLACEMENT_LAST_NAMES, seed, 3);
  const nationality = pickSeeded(REPLACEMENT_NATIONALITIES, seed, 4);
  const tacticalIdentity = pickSeeded(REPLACEMENT_TACTICAL_IDENTITIES, seed, 5);
  const transferIdentity = pickSeeded(REPLACEMENT_TRANSFER_IDENTITIES, seed, 6);
  const formationPool = pickSeeded(REPLACEMENT_FORMATION_POOLS, seed, 7);
  const preferredFormations = parsePreferredFormations(formationPool);

  const contractBase = team.boardProfile.patience === 'low'
    ? 1
    : team.boardProfile.patience === 'high'
      ? 3
      : 2;
  const ambitionContractModifier = team.boardProfile.ambition === 'elite'
    ? -1
    : team.boardProfile.ambition === 'survival'
      ? 1
      : 0;
  const contractJitter = ((seedAt(seed, 8) % 3) - 1);
  const contractYears = Math.max(1, Math.min(4, contractBase + ambitionContractModifier + contractJitter));

  const ageBase = team.boardProfile.ambition === 'elite'
    ? 44
    : team.boardProfile.ambition === 'survival'
      ? 50
      : 47;
  const ageJitter = ((seedAt(seed, 9) % 13) - 6);
  const age = Math.max(36, Math.min(62, ageBase + ageJitter));
  const boardTrust = clampMetric(
    replacement.boardTrust +
    ((seedAt(seed, 10) % 11) - 5) -
    (contractYears === 1 ? 6 : 0)
  );
  const jobSecurity = clampMetric(
    replacement.jobSecurity +
    ((seedAt(seed, 11) % 9) - 4) -
    (contractYears === 1 ? 12 : contractYears === 2 ? 5 : -2)
  );
  const context = buildInitialManagerContext(boardTrust, jobSecurity, team.boardProfile);
  const currentYear = getCurrentYear();

  return {
    ...replacement,
    name: `${firstName} ${lastName}`,
    nationality,
    age,
    dateOfBirth: `${currentYear - age}-07-01`,
    appointedAt: `${currentYear}-07-01`,
    contractYearsRemaining: contractYears,
    contractUntil: buildContractUntil(contractYears),
    status: contractYears === 1 && team.boardProfile.patience === 'low' ? 'Caretaker' : 'Permanent',
    preferredFormations: preferredFormations.length > 0 ? preferredFormations : replacement.preferredFormations,
    tacticalIdentity,
    transferIdentity,
    boardTrust,
    jobSecurity,
    pressureScore: context.pressureScore,
    replacementRisk: context.replacementRisk,
    reputation: clampMetric(replacement.reputation + ((seedAt(seed, 12) % 9) - 4)),
    seasonExpectations: describeBoardSeasonExpectations(team.boardProfile, division),
    clubFit: clampMetric(replacement.clubFit + ((seedAt(seed, 13) % 13) - 6)),
  };
};

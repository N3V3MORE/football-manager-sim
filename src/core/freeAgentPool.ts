import { Manager, Team } from '../models/types';

export const FREE_AGENT_TEAM_ID = '__free_agent__';

export const isFreeAgentTeamId = (teamId?: string | null): boolean => teamId === FREE_AGENT_TEAM_ID;

export const isFreeAgentTeam = (team?: Pick<Team, 'id'> | null): boolean => Boolean(team && isFreeAgentTeamId(team.id));

export const isClubTeam = (team?: Pick<Team, 'id'> | null): boolean => Boolean(team && !isFreeAgentTeam(team));

export const isPlayableClub = isClubTeam;

const createFreeAgentManager = (): Manager => ({
  id: 'free-agent-manager',
  teamId: FREE_AGENT_TEAM_ID,
  teamName: 'Free Agent Pool',
  name: 'Pool Administrator',
  nationality: 'N/A',
  dateOfBirth: '01/01/1970',
  age: 55,
  appointedAt: '01/07/2024',
  contractUntil: '30/06/2099',
  status: 'Permanent',
  reputation: 0,
  preferredFormations: ['4-4-2'],
  tacticalIdentity: 'Holding pool',
  transferIdentity: 'No recruitment activity',
  boardTrust: 50,
  jobSecurity: 50,
  contractYearsRemaining: 99,
  pressureScore: 0,
  replacementRisk: 0,
  seasonExpectations: 'No competitive activity',
  clubFit: 50,
  record: {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    position: 0,
  },
});

export const createFreeAgentTeam = (): Team => ({
  id: FREE_AGENT_TEAM_ID,
  name: 'Free Agent Pool',
  division: 'Continental',
  isExternal: true,
  clubClass: 'F',
  boardProfile: {
    ambition: 'stability',
    patience: 'high',
    transferDiscipline: 'strict',
    targetCompetitions: [],
    identity: 'Holding entity for unattached players; excluded from club systems.',
  },
  manager: createFreeAgentManager(),
  points: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  played: 0,
  activeFormation: '4-4-2',
  form: [],
  tactics: { mentality: 'Balanced', passingStyle: 'Mixed', tempo: 'Normal', defensiveLine: 'Standard', pressing: 'Medium' },
  budget: 0,
  operatingBudget: 0,
  transferSpend: 0,
  boardApproval: 50,
  lastStartingXI: [],
  formationMap: {},
});

export const ensureFreeAgentTeam = (teams: Record<string, Team>): Record<string, Team> => (
  teams[FREE_AGENT_TEAM_ID] ? teams : { ...teams, [FREE_AGENT_TEAM_ID]: createFreeAgentTeam() }
);

import { getSlotsForFormation } from '../constants/formations';
import { getSlotFitScore, rebuildFormationMap, rebuildFormationSlotPlayers } from '../core/formationMapUtils';
import { isPlayerUnavailable } from '../core/playerStatusUtils';
import {
  CompetitionState,
  Fixture,
  InboxAction,
  InboxMessage,
  InboxMessageCategory,
  Player,
  SeasonSummary,
  Team,
  TeamTactics,
} from '../models/types';
import { getCompetitionRoundLabel } from '../core/competitionEngine';

export const MAX_INBOX_MESSAGES = 60;

export const getInboxSeason = (
  competitions: Record<string, CompetitionState>,
  fixture?: Fixture
): number => {
  const fixtureSeason = fixture ? competitions[fixture.competitionId]?.season : undefined;
  if (typeof fixtureSeason === 'number' && fixtureSeason > 0) return fixtureSeason;

  return Object.values(competitions).reduce(
    (current, competition) => (
      typeof competition.season === 'number' && competition.season > current
        ? competition.season
        : current
    ),
    1
  );
};

export type MessageDraft = Omit<InboxMessage, 'id'>;

export type WeeklyAssistantInput = {
  currentWeek: number;
  season?: number;
  userTeamId: string | null;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  fixtures: Record<string, Fixture>;
  previousPlayers?: Record<string, Player>;
};

export type PostMatchReportInput = {
  currentWeek: number;
  season?: number;
  userTeamId: string | null;
  fixture: Fixture;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  previousPlayers: Record<string, Player>;
};

export type BoardInboxInput = {
  week: number;
  teamBefore: Team;
  teamAfter: Team;
  objectivesBefore: { id: string; description: string; met: boolean }[];
  objectivesAfter: { id: string; description: string; met: boolean }[];
};

export const LOW_ENERGY_WARNING_THRESHOLD = 52;
export const LINEUP_ROTATION_THRESHOLD = 45;
export const LOW_SQUAD_ENERGY_THRESHOLD = 65;

export const slugify = (value: string) => (
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item'
);

export const buildMessageId = (draft: MessageDraft) => {
  const entity = draft.fixtureId || draft.playerId || draft.teamId || `${draft.title}-${draft.body}`;
  // Only include season prefix for season >= 2 to preserve backward compatibility
  // with existing season-1 saves that have IDs without season.
  const seasonPrefix = typeof draft.season === 'number' && draft.season > 1
    ? `s${draft.season}-`
    : '';
  return `${draft.source}-${draft.category}-${seasonPrefix}w${draft.week}-${slugify(entity)}`;
};

export const buildMessage = (draft: MessageDraft): InboxMessage => ({
  ...draft,
  id: buildMessageId(draft),
});

export const hashSeed = (value: string) => (
  Array.from(value).reduce((hash, char, index) => (
    (hash * 31 + char.charCodeAt(0) + index) % 2147483647
  ), 7)
);

export const pickTemplate = <T,>(seed: string, options: T[]): T => (
  options[hashSeed(seed) % options.length]
);

export const average = (values: number[]) => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

export const getLatestRating = (player: Player) => player.matchRatingHistory[player.matchRatingHistory.length - 1] || 0;

export const getTeamSquad = (players: Record<string, Player>, teamId: string) => (
  Object.values(players).filter(player => player.teamId === teamId)
);

export const getCurrentStarters = (teamId: string, players: Record<string, Player>) => (
  getTeamSquad(players, teamId).filter(player => player.isStarting && !isPlayerUnavailable(player))
);

export const getEligibleTeamPlayers = (teamId: string, players: Record<string, Player>) => (
  getTeamSquad(players, teamId).filter(player => !isPlayerUnavailable(player))
);

export const getLikelyBestXI = (teamId: string, players: Record<string, Player>) => (
  getEligibleTeamPlayers(teamId, players)
    .sort((a, b) => {
      const energyDelta = b.energy - a.energy;
      if (energyDelta !== 0) return energyDelta;
      return b.overallRating - a.overallRating;
    })
    .slice(0, 11)
);

export const getOpponentForFixture = (
  fixture: Fixture,
  userTeamId: string,
  teams: Record<string, Team>
) => {
  const opponentId = fixture.homeTeamId === userTeamId ? fixture.awayTeamId : fixture.homeTeamId;
  return teams[opponentId] || null;
};

export const getSystemMessageCategory = (news: string): InboxMessageCategory => {
  if (/promoted|relegated|new season|season has concluded/i.test(news)) {
    return 'season_update';
  }
  if (/carabao|fa cup|europe|quarter-final|semi-final|round of 16|round [1-4]|draw complete/i.test(news)) {
    return 'competition_update';
  }
  if (/board|objective|approval/i.test(news)) {
    return 'board_update';
  }
  return 'system_news';
};

export const getMessageTitleForNews = (news: string) => {
  if (/promoted/i.test(news)) return 'Promotion confirmed';
  if (/relegated/i.test(news)) return 'Relegation confirmed';
  if (/new season/i.test(news)) return 'Season reset';
  if (/season has concluded/i.test(news)) return 'Season review';
  if (/carabao|fa cup|europe/i.test(news)) return 'Competition update';
  return 'League update';
};

export const formatCompetitionFinish = (finish: SeasonSummary['competitionResults'][number]['finish']) => {
  if (finish === 'winner') return 'won it';
  if (finish === 'runner_up') return 'finished runner-up';
  if (finish === 'not_qualified') return 'did not qualify';
  return `reached the ${getCompetitionRoundLabel(finish)}`;
};

export const formatNames = (names: string[]) => {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

export const hasSameMembers = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((value, index) => value === bSorted[index]);
};

export const describeApprovalBand = (approval: number) => {
  if (approval < 15) return 'sacking risk';
  if (approval < 30) return 'under pressure';
  if (approval >= 80) return 'untouchable';
  if (approval >= 65) return 'secure';
  return 'stable';
};

export const buildLineupSuggestionPayload = (
  team: Team,
  players: Record<string, Player>
): Extract<InboxAction, { type: 'apply_lineup' }> | null => {
  const slots = getSlotsForFormation(team.activeFormation);
  const eligiblePlayers = getEligibleTeamPlayers(team.id, players);
  if (eligiblePlayers.length === 0) return null;

  const currentStarters = getCurrentStarters(team.id, players);
  const currentMap = rebuildFormationMap(slots, currentStarters, team.formationMap || {});
  const slotPlayers = rebuildFormationSlotPlayers(slots, currentStarters, currentMap);
  const selectedIds = new Set<string>();
  const nextMap: Record<string, string> = {};

  slots.forEach((row, rowIndex) => {
    row.forEach((slot, colIndex) => {
      const currentPlayer = slotPlayers[rowIndex]?.[colIndex];
      const availableCandidates = eligiblePlayers.filter(player => !selectedIds.has(player.id));
      const bestFitCandidate = [...availableCandidates]
        .filter(player => getSlotFitScore(player, slot) > -Infinity)
        .sort((a, b) => {
          const fitDelta = getSlotFitScore(b, slot) - getSlotFitScore(a, slot);
          if (fitDelta !== 0) return fitDelta;
          const scoreA = a.overallRating + a.energy * 0.2;
          const scoreB = b.overallRating + b.energy * 0.2;
          return scoreB - scoreA;
        })[0];
      const fallbackCandidate = [...availableCandidates]
        .sort((a, b) => (b.overallRating + b.energy * 0.2) - (a.overallRating + a.energy * 0.2))[0];
      const replacementCandidate = bestFitCandidate || fallbackCandidate;

      const shouldReplaceCurrent = !currentPlayer ||
        currentPlayer.energy < LINEUP_ROTATION_THRESHOLD &&
          Boolean(
            replacementCandidate &&
            replacementCandidate.id !== currentPlayer.id &&
            replacementCandidate.energy >= currentPlayer.energy + 15 &&
            replacementCandidate.overallRating >= currentPlayer.overallRating - 4
          );
      const chosenPlayer = shouldReplaceCurrent ? replacementCandidate : currentPlayer;
      if (!chosenPlayer || selectedIds.has(chosenPlayer.id)) return;

      selectedIds.add(chosenPlayer.id);
      nextMap[`${rowIndex}-${colIndex}`] = chosenPlayer.id;
    });
  });

  if (Object.keys(nextMap).length === 0) return null;

  const startingIds = Array.from(new Set(Object.values(nextMap))).slice(0, 11);
  const subIds = getTeamSquad(players, team.id)
    .filter(player => !isPlayerUnavailable(player) && !startingIds.includes(player.id))
    .sort((a, b) => {
      if (Number(b.isSub) !== Number(a.isSub)) return Number(b.isSub) - Number(a.isSub);
      return b.overallRating - a.overallRating;
    })
    .slice(0, 7)
    .map(player => player.id);

  const currentStarterIds = currentStarters.map(player => player.id);
  const sameMap = JSON.stringify(currentMap) === JSON.stringify(nextMap);
  if (sameMap && hasSameMembers(currentStarterIds, startingIds)) return null;

  return {
    type: 'apply_lineup',
    payload: {
      teamId: team.id,
      formationMap: nextMap,
      startingIds,
      subIds,
    },
  };
};

export const buildTacticSuggestion = (
  fixture: Fixture,
  team: Team,
  opponent: Team,
  players: Record<string, Player>
) => {
  const currentStarters = getCurrentStarters(team.id, players);
  const userXI = currentStarters.length > 0 ? currentStarters : getLikelyBestXI(team.id, players);
  const opponentXI = getCurrentStarters(opponent.id, players).length > 0
    ? getCurrentStarters(opponent.id, players)
    : getLikelyBestXI(opponent.id, players);
  const avgUserEnergy = average(userXI.map(player => player.energy));
  const strengthDelta = average(userXI.map(player => player.overallRating)) - average(opponentXI.map(player => player.overallRating));

  let tactics: Partial<TeamTactics> | null = null;
  let title = '';
  let body = '';

  if (avgUserEnergy < 62 && (team.tactics.tempo !== 'Slow' || team.tactics.pressing === 'High')) {
    tactics = {
      ...(team.tactics.tempo !== 'Slow' ? { tempo: 'Slow' } : {}),
      ...(team.tactics.pressing === 'High' ? { pressing: 'Medium' } : {}),
    };
    title = 'Dial the tempo back';
    body = 'The group looks heavy-legged. Lowering the tempo should protect energy and keep the shape intact.';
  } else if (strengthDelta <= -3 && (
    team.tactics.mentality !== 'Defensive' ||
    team.tactics.defensiveLine !== 'Deep'
  )) {
    tactics = {
      ...(team.tactics.mentality !== 'Defensive' ? { mentality: 'Defensive' } : {}),
      ...(team.tactics.defensiveLine !== 'Deep' ? { defensiveLine: 'Deep' } : {}),
    };
    title = `Respect ${opponent.name}'s threat`;
    body = 'They look stronger on paper. A tighter block gives us a cleaner path into the match.';
  } else if (strengthDelta >= 3 && (
    team.tactics.mentality !== 'Attacking' ||
    team.tactics.pressing === 'None'
  )) {
    tactics = {
      ...(team.tactics.mentality !== 'Attacking' ? { mentality: 'Attacking' } : {}),
      ...(team.tactics.pressing === 'None' ? { pressing: 'Medium' } : {}),
    };
    title = 'Push the edge we have';
    body = `We should lean into the quality gap against ${opponent.name} and force the issue.`;
  }

  if (!tactics || Object.keys(tactics).length === 0) return null;

  return buildMessage({
    week: fixture.week,
    source: 'assistant',
    category: 'tactic_suggestion',
    title,
    body,
    isRead: false,
    action: {
      type: 'apply_tactics',
      payload: {
        teamId: team.id,
        tactics,
      },
    },
    fixtureId: fixture.id,
    teamId: team.id,
  });
};

export const mergeInboxMessages = (existing: InboxMessage[], additions: InboxMessage[]) => {
  const seen = new Set(existing.map(message => message.id));
  const uniqueAdditions = additions.filter(message => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
  return [...uniqueAdditions, ...existing].slice(0, MAX_INBOX_MESSAGES);
};

const PERSISTENT_CAREER_CATEGORIES = new Set<InboxMessageCategory>([
  'career_milestone',
  'career_sack_warning',
]);

export const pruneInboxMessagesForManagedTeam = (
  messages: InboxMessage[],
  nextTeamId: string | null
) => (
  messages.filter(message => {
    if (!message.teamId) return true;
    if (nextTeamId && message.teamId === nextTeamId) return true;
    return PERSISTENT_CAREER_CATEGORIES.has(message.category);
  })
);

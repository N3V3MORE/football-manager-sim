import { getSlotsForFormation } from '../constants/formations';
import { getRenewalOffer, getContractAdviceLabel, shouldRenewContract } from '../core/contractUtils';
import { getSlotFitScore, rebuildFormationMap, rebuildFormationSlotPlayers } from '../core/formationMapUtils';
import { formatContractLength, isContractExpiringSoon, isPlayerUnavailable } from '../core/playerStatusUtils';
import {
  CareerRecord,
  Fixture,
  InboxAction,
  InboxMessage,
  InboxMessageCategory,
  Player,
  SeasonSummary,
  Team,
  TeamTactics,
} from '../models/types';
import { getCompetitionRoundLabel, getCompetitionShortName } from '../core/competitionEngine';

export const MAX_INBOX_MESSAGES = 60;

type MessageDraft = Omit<InboxMessage, 'id'>;

type WeeklyAssistantInput = {
  currentWeek: number;
  userTeamId: string | null;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  fixtures: Record<string, Fixture>;
  previousPlayers?: Record<string, Player>;
};

type PostMatchReportInput = {
  currentWeek: number;
  userTeamId: string | null;
  fixture: Fixture;
  teams: Record<string, Team>;
  players: Record<string, Player>;
  previousPlayers: Record<string, Player>;
};

type BoardInboxInput = {
  week: number;
  teamBefore: Team;
  teamAfter: Team;
  objectivesBefore: { id: string; description: string; met: boolean }[];
  objectivesAfter: { id: string; description: string; met: boolean }[];
};

const LOW_ENERGY_WARNING_THRESHOLD = 52;
const LINEUP_ROTATION_THRESHOLD = 45;
const LOW_SQUAD_ENERGY_THRESHOLD = 65;

const slugify = (value: string) => (
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item'
);

const buildMessageId = (draft: MessageDraft) => {
  const entity = draft.fixtureId || draft.playerId || draft.teamId || `${draft.title}-${draft.body}`;
  return `${draft.source}-${draft.category}-w${draft.week}-${slugify(entity)}`;
};

const buildMessage = (draft: MessageDraft): InboxMessage => ({
  ...draft,
  id: buildMessageId(draft),
});

const hashSeed = (value: string) => (
  Array.from(value).reduce((hash, char, index) => (
    (hash * 31 + char.charCodeAt(0) + index) % 2147483647
  ), 7)
);

const pickTemplate = <T,>(seed: string, options: T[]): T => (
  options[hashSeed(seed) % options.length]!
);

const average = (values: number[]) => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

const getLatestRating = (player: Player) => player.matchRatingHistory[player.matchRatingHistory.length - 1] || 0;

const getTeamSquad = (players: Record<string, Player>, teamId: string) => (
  Object.values(players).filter(player => player.teamId === teamId)
);

const getCurrentStarters = (teamId: string, players: Record<string, Player>) => (
  getTeamSquad(players, teamId).filter(player => player.isStarting && !isPlayerUnavailable(player))
);

const getEligibleTeamPlayers = (teamId: string, players: Record<string, Player>) => (
  getTeamSquad(players, teamId).filter(player => !isPlayerUnavailable(player))
);

const getLikelyBestXI = (teamId: string, players: Record<string, Player>) => (
  getEligibleTeamPlayers(teamId, players)
    .sort((a, b) => {
      const energyDelta = b.energy - a.energy;
      if (energyDelta !== 0) return energyDelta;
      return b.overallRating - a.overallRating;
    })
    .slice(0, 11)
);

const getOpponentForFixture = (
  fixture: Fixture,
  userTeamId: string,
  teams: Record<string, Team>
) => {
  const opponentId = fixture.homeTeamId === userTeamId ? fixture.awayTeamId : fixture.homeTeamId;
  return teams[opponentId] || null;
};

const getUserFixtureForWeek = (
  fixtures: Record<string, Fixture>,
  currentWeek: number,
  userTeamId: string | null
) => {
  if (!userTeamId) return null;
  return Object.values(fixtures).find(
    fixture => !fixture.isPlayed &&
      fixture.week === currentWeek &&
      (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
  ) || null;
};

const getSystemMessageCategory = (news: string): InboxMessageCategory => {
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

const getMessageTitleForNews = (news: string) => {
  if (/promoted/i.test(news)) return 'Promotion confirmed';
  if (/relegated/i.test(news)) return 'Relegation confirmed';
  if (/new season/i.test(news)) return 'Season reset';
  if (/season has concluded/i.test(news)) return 'Season review';
  if (/carabao|fa cup|europe/i.test(news)) return 'Competition update';
  return 'League update';
};

const formatCompetitionFinish = (finish: SeasonSummary['competitionResults'][number]['finish']) => {
  if (finish === 'winner') return 'won it';
  if (finish === 'runner_up') return 'finished runner-up';
  if (finish === 'not_qualified') return 'did not qualify';
  return `reached the ${getCompetitionRoundLabel(finish)}`;
};

const formatNames = (names: string[]) => {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

const hasSameMembers = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((value, index) => value === bSorted[index]);
};

const describeApprovalBand = (approval: number) => {
  if (approval < 15) return 'sacking risk';
  if (approval < 30) return 'under pressure';
  if (approval >= 80) return 'untouchable';
  if (approval >= 65) return 'secure';
  return 'stable';
};

const buildLineupSuggestionPayload = (
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

const buildTacticSuggestion = (
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

export const buildLegacyInboxMessages = (news: string[], week = 1) => (
  news
    .filter(item => getSystemMessageCategory(item) !== 'system_news')
    .map(item => buildMessage({
      week,
      source: 'system',
      category: getSystemMessageCategory(item),
      title: getMessageTitleForNews(item),
      body: item,
      isRead: true,
    }))
);

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

export const generateSystemInboxMessages = (week: number, news: string[]) => (
  news
    .filter(item => getSystemMessageCategory(item) !== 'system_news')
    .map(item => buildMessage({
      week,
      source: 'system',
      category: getSystemMessageCategory(item),
      title: getMessageTitleForNews(item),
      body: item,
      isRead: false,
    }))
);

const generateRecoveryMessages = (
  currentWeek: number,
  userTeamId: string,
  players: Record<string, Player>,
  previousPlayers?: Record<string, Player>
) => {
  if (!previousPlayers) return [] as InboxMessage[];

  return getTeamSquad(players, userTeamId)
    .filter(player => (previousPlayers[player.id]?.injuryWeeks || 0) > 0 && (player.injuryWeeks || 0) === 0)
    .map(player => buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'injury_update',
      title: `${player.name} is back available`,
      body: `${player.name} has completed recovery and is available for selection again.`,
      isRead: false,
      playerId: player.id,
      teamId: userTeamId,
    }));
};

const contractWarningsIssued = new Map<string, number>();

const generateContractMessages = (
  currentWeek: number,
  team: Team,
  players: Record<string, Player>,
  previousPlayers?: Record<string, Player>
) => {
  return getTeamSquad(players, team.id)
    .filter(player => isContractExpiringSoon(player))
    .filter(player => {
      const warningKey = `${team.id}-${player.id}`;
      const lastWarningWeek = contractWarningsIssued.get(warningKey);
      if (lastWarningWeek !== undefined && currentWeek - lastWarningWeek < 6) return false;
      
      if (currentWeek < 30 && currentWeek % 6 !== 0) return false;
      const previous = previousPlayers?.[player.id];
      const hasStateChange = !previous || previous.contractLeft > player.contractLeft || previous.injuryWeeks !== player.injuryWeeks;
      if (currentWeek >= 34 && !hasStateChange && currentWeek % 2 !== 0) return false;
      return hasStateChange || currentWeek % 6 === 0 || (currentWeek >= 34 && currentWeek % 2 === 0);
    })
    .slice(0, 3)
    .map(player => {
      contractWarningsIssued.set(`${team.id}-${player.id}`, currentWeek);
      const renewal = getRenewalOffer(player);
      const advice = getContractAdviceLabel(player, team);
      return buildMessage({
        week: currentWeek,
        source: 'assistant',
        category: 'contract_warning',
        title: `Contract running down: ${player.name}`,
        body: advice === 'renew'
          ? `${player.name} has ${formatContractLength(player)}. I would renew now at GBP ${renewal.wage}k/w for ${renewal.years} year${renewal.years === 1 ? '' : 's'}.`
          : `${player.name} has ${formatContractLength(player)}. I would ${advice} rather than let the situation drift.`,
        isRead: false,
        action: shouldRenewContract(player, team)
          ? {
            type: 'renew_contract',
            payload: {
              playerId: player.id,
              years: renewal.years,
              wage: renewal.wage,
            },
          }
          : undefined,
        playerId: player.id,
        teamId: team.id,
      });
    });
};

export const generateAssistantWeekMessages = ({
  currentWeek,
  userTeamId,
  teams,
  players,
  fixtures,
  previousPlayers,
}: WeeklyAssistantInput) => {
  if (!userTeamId) return [];

  const team = teams[userTeamId];
  if (!team) return [];

  const messages: InboxMessage[] = [
    ...generateRecoveryMessages(currentWeek, userTeamId, players, previousPlayers),
    ...generateContractMessages(currentWeek, team, players, previousPlayers),
  ];

  const fixture = getUserFixtureForWeek(fixtures, currentWeek, userTeamId);
  if (!fixture) return messages;

  const opponent = getOpponentForFixture(fixture, userTeamId, teams);
  if (!opponent) return messages;
  const starters = getCurrentStarters(team.id, players);
  const suspendedStarters = getTeamSquad(players, team.id)
    .filter(player => player.isStarting && player.matchesSuspended > 0);
  const injuredStarters = getTeamSquad(players, team.id)
    .filter(player => player.isStarting && (player.injuryWeeks || 0) > 0);
  const lowEnergyStarters = starters.filter(player => player.energy <= LOW_ENERGY_WARNING_THRESHOLD);
  const eligibleBench = getTeamSquad(players, team.id).filter(player => player.isSub && !isPlayerUnavailable(player));
  const reserveGoalkeepers = getTeamSquad(players, team.id)
    .filter(player => player.position === 'GK' && !player.isStarting && !isPlayerUnavailable(player));

  if (lowEnergyStarters.length > 0) {
    const lowEnergyNames = formatNames(lowEnergyStarters.slice(0, 3).map(player => player.name));
    const energySeed = `${currentWeek}-${team.id}-${fixture.id}-energy-${lowEnergyStarters.map(player => player.id).join('-')}`;
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'pre_match_energy',
      title: pickTemplate(energySeed, [
        `Watch the legs for ${opponent.name}`,
        `Energy warning before ${opponent.name}`,
        `Freshen the side for ${opponent.name}`,
      ]),
      body: pickTemplate(`${energySeed}-body`, [
        `${lowEnergyNames} are already low on energy. I would rotate before kick-off if we can.`,
        `${lowEnergyNames} are fading. I would change that before ${opponent.name} if possible.`,
        `The legs are heavy on ${lowEnergyNames}. We should freshen the XI ahead of ${opponent.name}.`,
      ]),
      isRead: false,
      fixtureId: fixture.id,
      teamId: team.id,
    }));
  }

  if (suspendedStarters.length > 0 || injuredStarters.length > 0 || eligibleBench.length < 5 || reserveGoalkeepers.length === 0) {
    const warnings: string[] = [];
    if (suspendedStarters.length > 0) {
      warnings.push(`${formatNames(suspendedStarters.map(player => player.name))} cannot start because of suspension`);
    }
    if (injuredStarters.length > 0) {
      warnings.push(`${formatNames(injuredStarters.map(player => player.name))} are unavailable through injury`);
    }
    if (eligibleBench.length < 5) warnings.push('the bench is looking thin');
    if (reserveGoalkeepers.length === 0) warnings.push('there is no spare goalkeeper available');
    const availabilitySeed = `${currentWeek}-${team.id}-${fixture.id}-availability-${warnings.join('|')}`;
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'pre_match_availability',
      title: pickTemplate(availabilitySeed, [
        'Availability check',
        'Team news update',
        'Selection warning',
      ]),
      body: `${warnings.join('. ')}. ${pickTemplate(`${availabilitySeed}-body`, [
        `Clean that up before we play ${opponent.name}.`,
        `That needs sorting before ${opponent.name}.`,
        `We should fix that before kick-off against ${opponent.name}.`,
      ])}`,
      isRead: false,
      fixtureId: fixture.id,
      teamId: team.id,
    }));
  }

  const lineupAction = buildLineupSuggestionPayload(team, players);
  if (lineupAction) {
    const suggestedXI = lineupAction.payload.startingIds
      .map(playerId => players[playerId])
      .filter((player): player is Player => Boolean(player));
    const changedIn = suggestedXI
      .filter(player => !player.isStarting)
      .slice(0, 2)
      .map(player => player.name);
    const changedNames = formatNames(changedIn);
    const lineupSeed = `${currentWeek}-${team.id}-${fixture.id}-lineup-${lineupAction.payload.startingIds.join('-')}`;
    const body = starters.length === 0
      ? pickTemplate(`${lineupSeed}-unset`, [
        `You still have not set an XI. I have prepared a balanced starting side for ${opponent.name}.`,
        `There is no settled XI yet. I have set out a cleaner group for ${opponent.name}.`,
        `We still need a starting side. I have prepared an XI for ${opponent.name} that gives us balance.`,
      ])
      : changedIn.length > 0
        ? pickTemplate(`${lineupSeed}-changes`, [
          `I would bring ${changedNames} in before ${opponent.name}. The current group needs fresher legs or better fit.`,
          `${changedNames} should come into the side for ${opponent.name}. We need more legs and a cleaner setup.`,
          `I would turn to ${changedNames} here. That gives us a stronger balance against ${opponent.name}.`,
        ])
        : pickTemplate(`${lineupSeed}-clean`, [
          `I have prepared a cleaner XI for ${opponent.name}.`,
          `The selection is tidier now for ${opponent.name}.`,
          `I have lined up a more stable group for ${opponent.name}.`,
        ]);
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'lineup_suggestion',
      title: pickTemplate(lineupSeed, [
        `Lineup suggestion for ${opponent.name}`,
        `Selection note for ${opponent.name}`,
        `Proposed XI for ${opponent.name}`,
      ]),
      body,
      isRead: false,
      action: lineupAction,
      fixtureId: fixture.id,
      teamId: team.id,
    }));
  }

  const tacticSuggestion = buildTacticSuggestion(fixture, team, opponent, players);
  if (tacticSuggestion) messages.push(tacticSuggestion);

  const tiredStarters = starters.filter(player => player.energy < LOW_SQUAD_ENERGY_THRESHOLD);
  if (tiredStarters.length >= 4) {
    const squadSeed = `${currentWeek}-${team.id}-${fixture.id}-squad-load-${tiredStarters.length}`;
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'squad_warning',
      title: pickTemplate(squadSeed, [
        'Squad load is climbing',
        'Recovery window needed',
        'Manage the workload',
      ]),
      body: pickTemplate(`${squadSeed}-body`, [
        `${tiredStarters.length} likely starters are below ${LOW_SQUAD_ENERGY_THRESHOLD} energy. Rotation matters over the next stretch.`,
        `We have ${tiredStarters.length} likely starters under ${LOW_SQUAD_ENERGY_THRESHOLD} energy. The schedule is starting to bite.`,
        `Fatigue is stacking up: ${tiredStarters.length} likely starters are under ${LOW_SQUAD_ENERGY_THRESHOLD} energy and need help.`,
      ]),
      isRead: false,
      teamId: team.id,
      fixtureId: fixture.id,
    }));
  }

  const userXI = starters.length > 0 ? starters : getLikelyBestXI(team.id, players);
  const groupedStarters = userXI.reduce<Record<Player['position'], Player[]>>(
    (acc, player) => {
      acc[player.position].push(player);
      return acc;
    },
    { GK: [], DEF: [], MID: [], FWD: [] }
  );
  const weakestPosition = (Object.keys(groupedStarters) as Player['position'][])
    .map(position => ({
      position,
      starter: [...groupedStarters[position]].sort((a, b) => a.overallRating - b.overallRating)[0],
      depth: groupedStarters[position].length,
    }))
    .filter(item => Boolean(item.starter))
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return (a.starter?.overallRating || 0) - (b.starter?.overallRating || 0);
    })[0];

  if (weakestPosition?.starter) {
    const listedTargets = Object.values(players)
      .filter(player => player.teamId !== team.id && player.isTransferListed && player.position === weakestPosition.position)
      .filter(player => player.askingPrice <= Math.max(2, team.budget * 0.6))
      .sort((a, b) => {
        const gainA = a.overallRating - weakestPosition.starter!.overallRating;
        const gainB = b.overallRating - weakestPosition.starter!.overallRating;
        if (gainB !== gainA) return gainB - gainA;
        return a.askingPrice - b.askingPrice;
      });
    const target = listedTargets[0];
    const marketSeed = `${currentWeek}-${team.id}-${weakestPosition.position}-${target?.id || 'none'}`;
    const body = target
      ? pickTemplate(`${marketSeed}-target`, [
        `${weakestPosition.position} still looks like the soft spot. ${target.name} at ${teams[target.teamId]?.name} would improve the squad and is listed at GBP ${target.askingPrice}m.`,
        `I would keep pushing for a ${weakestPosition.position}. ${target.name} from ${teams[target.teamId]?.name} is listed at GBP ${target.askingPrice}m and would raise the floor.`,
        `The squad still needs help at ${weakestPosition.position}. ${target.name} at ${teams[target.teamId]?.name} is available for GBP ${target.askingPrice}m and fits the gap.`,
      ])
      : pickTemplate(`${marketSeed}-generic`, [
        `${weakestPosition.position} looks like our thinnest position right now. Keep an eye on the market before the run gets harder.`,
        `We are lightest at ${weakestPosition.position}. I would stay alert for value there before the next stretch.`,
        `${weakestPosition.position} remains the weak point in the squad. We should keep scanning the market for help.`,
      ]);
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'transfer_advice',
      title: pickTemplate(marketSeed, [
        'Market note',
        'Recruitment note',
        'Scouting note',
      ]),
      body,
      isRead: false,
      teamId: team.id,
    }));
  }

  return messages;
};

export const generatePostMatchReportMessage = ({
  currentWeek,
  userTeamId,
  fixture,
  teams,
  players,
  previousPlayers,
}: PostMatchReportInput) => {
  if (!userTeamId) return null;
  if (fixture.homeTeamId !== userTeamId && fixture.awayTeamId !== userTeamId) return null;

  const team = teams[userTeamId];
  const opponent = getOpponentForFixture(fixture, userTeamId, teams);
  if (!team || !opponent || fixture.homeScore === null || fixture.awayScore === null) return null;

  const participants = getTeamSquad(players, userTeamId)
    .filter(player => (player.minutesPlayed || 0) > (previousPlayers[player.id]?.minutesPlayed || 0));
  const participantsWithDelta = participants.map(player => {
    const previous = previousPlayers[player.id];
    return {
      player,
      goalsDelta: player.goals - (previous?.goals || 0),
      assistsDelta: player.assists - (previous?.assists || 0),
      yellowDelta: player.yellowCards - (previous?.yellowCards || 0),
      redDelta: player.redCards - (previous?.redCards || 0),
      rating: getLatestRating(player),
    };
  });

  const keyPerformer = [...participantsWithDelta].sort((a, b) => {
    const contributionA = a.goalsDelta * 3 + a.assistsDelta * 2 + a.rating;
    const contributionB = b.goalsDelta * 3 + b.assistsDelta * 2 + b.rating;
    return contributionB - contributionA;
  })[0];
  const poorPerformer = [...participantsWithDelta]
    .filter(item => item.rating > 0)
    .sort((a, b) => a.rating - b.rating)[0];
  const disciplineCases = participantsWithDelta.filter(item => item.yellowDelta > 0 || item.redDelta > 0);
  const injuryCases = getTeamSquad(players, userTeamId)
    .filter(player => (player.injuryWeeks || 0) > (previousPlayers[player.id]?.injuryWeeks || 0));

  const isHome = fixture.homeTeamId === userTeamId;
  const myGoals = isHome ? fixture.homeScore! : fixture.awayScore!;
  const theirGoals = isHome ? fixture.awayScore! : fixture.homeScore!;
  const reportSeed = `${fixture.id}-${myGoals}-${theirGoals}-${team.id}`;
  const resultPrefix = myGoals > theirGoals
    ? pickTemplate(`${reportSeed}-win`, [
      'Strong result.',
      'That was a solid win.',
      'We handled that match well.',
    ])
    : myGoals === theirGoals
      ? pickTemplate(`${reportSeed}-draw`, [
        'Job done, but not quite finished.',
        'A point taken, but there was more there.',
        'We stayed in it, but never quite turned the game.',
      ])
      : pickTemplate(`${reportSeed}-loss`, [
        'That one slipped on us.',
        'We left that match behind us.',
        'That result got away from us.',
      ]);

  let tacticalNote = pickTemplate(`${reportSeed}-tactical-generic`, [
    'The shape was serviceable, but there is still room to tighten the details.',
    'Structurally we were fine in spells, but the details still need work.',
    'There was enough structure there, though we still left loose moments in the match.',
  ]);
  if (team.tactics.mentality === 'Defensive' && theirGoals === 0) {
    tacticalNote = pickTemplate(`${reportSeed}-tactical-defensive`, [
      'The defensive plan held up and protected the back line well.',
      'The compact setup worked and kept the back line protected.',
      'We defended the box properly and the shape held together well.',
    ]);
  } else if (team.tactics.mentality === 'Attacking' && myGoals >= 3) {
    tacticalNote = pickTemplate(`${reportSeed}-tactical-attack-good`, [
      'The aggressive setup paid off and created enough volume in the final third.',
      'The front-foot approach worked and gave us enough threat in the box.',
      'We pushed the game our way and the attacking setup gave us real momentum.',
    ]);
  } else if (team.tactics.mentality === 'Attacking' && theirGoals >= 3) {
    tacticalNote = pickTemplate(`${reportSeed}-tactical-attack-bad`, [
      'We opened the game up too much and left space behind us.',
      'The attacking shape left too much room for counters against us.',
      'We committed too much and the spaces behind us were punished.',
    ]);
  } else if (team.tactics.tempo === 'Slow' && myGoals === 0) {
    tacticalNote = pickTemplate(`${reportSeed}-tactical-slow`, [
      'We controlled parts of it, but the tempo did not give us enough threat.',
      'We had spells of control, but the slow tempo blunted the attack.',
      'The calmer rhythm helped us settle, but it left us short of cutting edge.',
    ]);
  }

  const performerNote = keyPerformer
    ? keyPerformer.goalsDelta > 0 || keyPerformer.assistsDelta > 0
      ? `${keyPerformer.player.name} carried the key moments with ${keyPerformer.goalsDelta} goal(s) and ${keyPerformer.assistsDelta} assist(s).`
      : `${keyPerformer.player.name} was our cleanest performer and finished on a ${keyPerformer.rating.toFixed(1)} rating.`
    : 'No one really took control of the match for us.';
  const poorNote = poorPerformer && poorPerformer.rating > 0
    ? `${poorPerformer.player.name} struggled and came out at ${poorPerformer.rating.toFixed(1)}.`
    : '';
  const disciplineNote = disciplineCases.length > 0
    ? `Discipline hurt us as well: ${disciplineCases.map(item => `${item.player.name}${item.redDelta > 0 ? ' saw red' : ' picked up a booking'}`).join(', ')}.`
    : '';
  const injuryNote = injuryCases.length > 0
    ? `We also lost ${injuryCases.map(player => `${player.name} (${player.injuryType || 'injury'}${player.injuryWeeks ? `, ${player.injuryWeeks}w` : ''})`).join(', ')}.`
    : '';

  return buildMessage({
    week: currentWeek,
    source: 'assistant',
    category: 'post_match_report',
    title: `${pickTemplate(`${reportSeed}-title`, ['Post-match', 'Match review', 'Analyst report'])}: ${team.name} ${myGoals}-${theirGoals} ${opponent.name}${fixture.competitionType !== 'league' ? ` (${getCompetitionShortName(fixture.competitionId)})` : ''}`,
    body: `${resultPrefix} ${performerNote} ${poorNote} ${disciplineNote} ${injuryNote} ${tacticalNote}`.replace(/\s+/g, ' ').trim(),
    isRead: false,
    fixtureId: fixture.id,
    teamId: team.id,
  });
};

type CareerInboxInput = {
  week: number;
  summary: SeasonSummary;
  reputationDelta: number;
  careerRecord: CareerRecord;
  jobOfferTeams: Team[];
  isSacked: boolean;
  sackingContext?: {
    consecutiveLowApprovalWeeks: number;
    approval: number;
    threshold: number;
    pressureScore: number;
    replacementRisk: number;
  };
};

export const generateCareerInboxMessages = ({
  week,
  summary,
  reputationDelta,
  careerRecord,
  jobOfferTeams,
  isSacked,
  sackingContext,
}: CareerInboxInput): InboxMessage[] => {
  const messages: InboxMessage[] = [];

  // Season-end career milestone message
  const outcomeLabel =
    summary.outcome === 'champion' ? 'Won the division' :
    summary.outcome === 'promoted' ? 'Earned promotion' :
    summary.outcome === 'relegated' ? 'Were relegated' :
    summary.outcome === 'sacked' ? 'Were sacked' :
    'Finished the season';
  const repLine = reputationDelta === 0
    ? `Reputation holds at ${careerRecord.reputation}.`
    : `Reputation ${reputationDelta > 0 ? 'rises' : 'drops'} by ${Math.abs(reputationDelta)} to ${careerRecord.reputation}.`;
  const trophyLine = careerRecord.trophies.length > 0
    ? ` Career trophies: ${careerRecord.trophies.length}.`
    : '';
  const competitionLine = summary.competitionResults
    .filter(result => result.finish !== 'not_qualified')
    .map(result => `${result.name}: ${formatCompetitionFinish(result.finish)}`)
    .join(' ');
  const boardLine = isSacked && sackingContext
    ? `Board review: dismissal triggered after ${sackingContext.consecutiveLowApprovalWeeks} consecutive weeks below the danger threshold (${Math.round(sackingContext.approval)}% vs ${Math.round(sackingContext.threshold)}%). Pressure ${Math.round(sackingContext.pressureScore)} and replacement risk ${Math.round(sackingContext.replacementRisk)} left no route to renewal.`
    : summary.boardVerdict === 'thriving'
      ? `Board review: exceeded expectations with a #${summary.finalPosition} finish.`
      : summary.boardVerdict === 'warning'
        ? `Board review: results put you under pressure at #${summary.finalPosition}.`
        : summary.boardVerdict === 'critical'
          ? `Board review: the board judged the season a failure at #${summary.finalPosition}.`
          : `Board review: expectations were broadly met with a #${summary.finalPosition} finish.`;

  messages.push(buildMessage({
    week,
    source: 'system',
    category: 'career_milestone',
    title: isSacked ? 'Contract terminated' : `Season ${careerRecord.seasonsManaged} complete`,
    body: `${outcomeLabel} with ${summary.teamName} in ${summary.division}. ${repLine}${trophyLine}${competitionLine ? ` Competition record: ${competitionLine}.` : ''} ${boardLine} Record this season: ${summary.wins}W ${summary.draws}D ${summary.losses}L.`,
    isRead: false,
    teamId: summary.teamId,
  }));

  // Job offer messages
  jobOfferTeams.forEach(team => {
    const action: InboxAction = {
      type: 'accept_job_offer',
      payload: { teamId: team.id },
    };
    const offerReasons: string[] = [];
    if (isSacked) {
      offerReasons.push(`After your departure from ${summary.teamName}, ${team.name} moved quickly to fill the vacancy.`);
    } else if (summary.outcome === 'champion' || summary.outcome === 'promoted') {
      offerReasons.push(`Your league outcome with ${summary.teamName} pushed your profile up the shortlist.`);
    } else if (summary.competitionResults.some(result => (
      result.finish === 'winner' || result.finish === 'runner_up' || result.finish === 'semi_final'
    ))) {
      offerReasons.push(`Your cup and continental work with ${summary.teamName} strengthened your case.`);
    } else {
      offerReasons.push(`${team.name} believe your profile fits their current rebuild.`);
    }

    if (team.manager.replacementRisk >= 70) {
      offerReasons.push(`${team.name} enter this cycle under heavy pressure (${Math.round(team.manager.replacementRisk)}% replacement risk).`);
    } else if (team.manager.jobSecurity <= 40) {
      offerReasons.push(`${team.name} are acting early with low manager security (${Math.round(team.manager.jobSecurity)}%).`);
    }

    offerReasons.push(
      `Board posture: ambition ${team.boardProfile.ambition}, patience ${team.boardProfile.patience}, transfer discipline ${team.boardProfile.transferDiscipline}.`
    );
    messages.push(buildMessage({
      week,
      source: 'system',
      category: 'career_job_offer',
      title: `Job offer: ${team.name}`,
      body: `${offerReasons.join(' ')} Budget: GBP ${team.budget.toFixed(1)}m. Division: ${team.division}. Board brief: ${team.boardProfile.identity} Accept to take charge immediately next season.`,
      isRead: false,
      action,
      teamId: team.id,
    }));
  });

  return messages;
};

export const generateSackWarningMessage = (
  week: number,
  consecutiveWeeks: number,
  teamId: string,
  isTerminal = false,
  context?: {
    approval: number;
    threshold: number;
    pressureScore: number;
    replacementRisk: number;
  }
): InboxMessage =>
  buildMessage({
    week,
    source: 'system',
    category: 'career_sack_warning',
    title: isTerminal ? 'Board has lost confidence' : 'Board warning issued',
    body: isTerminal
      ? `The board has formally lost confidence in your management after ${consecutiveWeeks} consecutive weeks in the critical pressure band.${context ? ` Approval is ${Math.round(context.approval)}% against a ${Math.round(context.threshold)}% threshold, with pressure ${Math.round(context.pressureScore)} and replacement risk ${Math.round(context.replacementRisk)}.` : ''} Your position will not be renewed at season end.`
      : `Board pressure has remained in the danger zone for ${consecutiveWeeks} consecutive weeks.${context ? ` Approval is ${Math.round(context.approval)}% against a ${Math.round(context.threshold)}% threshold, with pressure ${Math.round(context.pressureScore)} and replacement risk ${Math.round(context.replacementRisk)}.` : ''} Results and confidence must improve immediately.`,
    isRead: false,
    teamId,
  });

export const generateBoardInboxMessages = ({
  week,
  teamBefore,
  teamAfter,
  objectivesBefore,
  objectivesAfter,
}: BoardInboxInput) => {
  const messages: InboxMessage[] = [];
  const newlyMetObjectives = objectivesAfter.filter(objective => (
    objective.met && !objectivesBefore.find(previous => previous.id === objective.id)?.met
  ));
  const approvalDelta = Math.round(teamAfter.boardApproval - teamBefore.boardApproval);
  const bandBefore = describeApprovalBand(teamBefore.boardApproval);
  const bandAfter = describeApprovalBand(teamAfter.boardApproval);

  if (newlyMetObjectives.length > 0 || Math.abs(approvalDelta) >= 8 || bandBefore !== bandAfter) {
    const boardSeed = `${week}-${teamAfter.id}-${approvalDelta}-${bandAfter}-${newlyMetObjectives.map(objective => objective.id).join('-')}`;
    const objectiveLine = newlyMetObjectives.length > 0
      ? `Objectives met: ${newlyMetObjectives.map(objective => objective.description).join('; ')}. `
      : '';
    const pressureLine = `Pressure ${Math.round(teamAfter.manager.pressureScore)} | replacement risk ${Math.round(teamAfter.manager.replacementRisk)}.`;
    const approvalLine = approvalDelta === 0
      ? pickTemplate(`${boardSeed}-steady`, [
        `Board approval holds at ${Math.round(teamAfter.boardApproval)}% and the mood is ${bandAfter}.`,
        `The board stays steady at ${Math.round(teamAfter.boardApproval)}% and the current mood is ${bandAfter}.`,
        `No shift this week: board approval remains ${Math.round(teamAfter.boardApproval)}% with the mood set at ${bandAfter}.`,
      ])
      : pickTemplate(`${boardSeed}-move`, [
        `Board approval ${approvalDelta > 0 ? 'rises' : 'drops'} to ${Math.round(teamAfter.boardApproval)}% and the mood is now ${bandAfter}.`,
        `The latest review leaves board approval at ${Math.round(teamAfter.boardApproval)}% and the mood at ${bandAfter}.`,
        `Board sentiment ${approvalDelta > 0 ? 'improves' : 'slides'} to ${Math.round(teamAfter.boardApproval)}%, putting the mood at ${bandAfter}.`,
      ]);
    messages.push(buildMessage({
      week,
      source: 'system',
      category: 'board_update',
      title: pickTemplate(boardSeed, [
        'Board update',
        'Board room note',
        'Executive review',
      ]),
      body: `${objectiveLine}${approvalLine} ${pressureLine}`.trim(),
      isRead: false,
      teamId: teamAfter.id,
    }));
  }

  return messages;
};

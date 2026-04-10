import { getSlotsForFormation } from '../constants/formations';
import { getRenewalOffer, getContractAdviceLabel, shouldRenewContract } from '../core/contractUtils';
import { getSlotFitScore, rebuildFormationMap, rebuildFormationSlotPlayers } from '../core/formationMapUtils';
import { formatContractLength, isContractExpiringSoon, isPlayerUnavailable } from '../core/playerStatusUtils';
import {
  Fixture,
  InboxAction,
  InboxMessage,
  InboxMessageCategory,
  Player,
  Team,
  TeamTactics,
} from '../models/types';

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
  return 'League update';
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
  news.map(item => buildMessage({
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

export const generateSystemInboxMessages = (week: number, news: string[]) => (
  news.map(item => buildMessage({
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

const generateContractMessages = (
  currentWeek: number,
  team: Team,
  players: Record<string, Player>,
  previousPlayers?: Record<string, Player>
) => {
  return getTeamSquad(players, team.id)
    .filter(player => isContractExpiringSoon(player))
    .filter(player => {
      if (currentWeek < 30 && currentWeek % 6 !== 0) return false;
      const previous = previousPlayers?.[player.id];
      return !previous || previous.contractLeft > player.contractLeft || previous.injuryWeeks !== player.injuryWeeks || currentWeek >= 34 || currentWeek % 6 === 0;
    })
    .slice(0, 3)
    .map(player => {
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
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'pre_match_energy',
      title: `Watch the legs for ${opponent.name}`,
      body: `${formatNames(lowEnergyStarters.slice(0, 3).map(player => player.name))} are already low on energy. I would rotate before kick-off if we can.`,
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
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'pre_match_availability',
      title: 'Availability check',
      body: `${warnings.join('. ')}. Clean that up before we play ${opponent.name}.`,
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
    const body = starters.length === 0
      ? `You still have not set an XI. I have prepared a balanced starting side for ${opponent.name}.`
      : changedIn.length > 0
        ? `I would bring ${formatNames(changedIn)} in before ${opponent.name}. The current group needs fresher legs or better fit.`
        : `I have prepared a cleaner XI for ${opponent.name}.`;
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'lineup_suggestion',
      title: `Lineup suggestion for ${opponent.name}`,
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
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'squad_warning',
      title: 'Squad load is climbing',
      body: `${tiredStarters.length} likely starters are below ${LOW_SQUAD_ENERGY_THRESHOLD} energy. Rotation matters over the next stretch.`,
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
    const body = target
      ? `${weakestPosition.position} still looks like the soft spot. ${target.name} at ${teams[target.teamId]?.name} would improve the squad and is listed at GBP ${target.askingPrice}m.`
      : `${weakestPosition.position} looks like our thinnest position right now. Keep an eye on the market before the run gets harder.`;
    messages.push(buildMessage({
      week: currentWeek,
      source: 'assistant',
      category: 'transfer_advice',
      title: 'Market note',
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
  const myGoals = isHome ? fixture.homeScore : fixture.awayScore;
  const theirGoals = isHome ? fixture.awayScore : fixture.homeScore;
  const resultPrefix = myGoals > theirGoals
    ? 'Strong result.'
    : myGoals === theirGoals
      ? 'Job done, but not quite finished.'
      : 'That one slipped on us.';

  let tacticalNote = 'The shape was serviceable, but there is still room to tighten the details.';
  if (team.tactics.mentality === 'Defensive' && theirGoals === 0) {
    tacticalNote = 'The defensive plan held up and protected the back line well.';
  } else if (team.tactics.mentality === 'Attacking' && myGoals >= 3) {
    tacticalNote = 'The aggressive setup paid off and created enough volume in the final third.';
  } else if (team.tactics.mentality === 'Attacking' && theirGoals >= 3) {
    tacticalNote = 'We opened the game up too much and left space behind us.';
  } else if (team.tactics.tempo === 'Slow' && myGoals === 0) {
    tacticalNote = 'We controlled parts of it, but the tempo did not give us enough threat.';
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
    ? `We also lost ${injuryCases.map(player => `${player.name} (${player.injuryType || 'injury'}, ${player.injuryWeeks}w)`).join(', ')}.`
    : '';

  return buildMessage({
    week: currentWeek,
    source: 'assistant',
    category: 'post_match_report',
    title: `Post-match: ${team.name} ${myGoals}-${theirGoals} ${opponent.name}`,
    body: `${resultPrefix} ${performerNote} ${poorNote} ${disciplineNote} ${injuryNote} ${tacticalNote}`.replace(/\s+/g, ' ').trim(),
    isRead: false,
    fixtureId: fixture.id,
    teamId: team.id,
  });
};

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
    const objectiveLine = newlyMetObjectives.length > 0
      ? `Objectives met: ${newlyMetObjectives.map(objective => objective.description).join('; ')}. `
      : '';
    const approvalLine = approvalDelta === 0
      ? `Board approval holds at ${Math.round(teamAfter.boardApproval)}% and the mood is ${bandAfter}.`
      : `Board approval ${approvalDelta > 0 ? 'rises' : 'drops'} to ${Math.round(teamAfter.boardApproval)}% and the mood is now ${bandAfter}.`;
    messages.push(buildMessage({
      week,
      source: 'system',
      category: 'board_update',
      title: 'Board update',
      body: `${objectiveLine}${approvalLine}`.trim(),
      isRead: false,
      teamId: teamAfter.id,
    }));
  }

  return messages;
};

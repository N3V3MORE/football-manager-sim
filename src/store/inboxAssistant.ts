import { getRenewalOffer } from '../core/contractUtils';
import { formatContractLength, isContractExpiringSoon, isPlayerUnavailable } from '../core/playerStatusUtils';
import { buildSquadPlan } from '../core/squadPlanningEngine';
import {
  ContractDecision,
  InboxMessage,
  Player,
  Team,
} from '../models/types';
import { getCompetitionShortName } from '../core/competitionEngine';
import { getNextDueFixture } from '../core/fixtureLifecycle';
import {
  buildLineupSuggestionPayload,
  buildMessage,
  buildTacticSuggestion,
  getCurrentStarters,
  getLatestRating,
  getOpponentForFixture,
  getTeamSquad,
  LOW_ENERGY_WARNING_THRESHOLD,
  LOW_SQUAD_ENERGY_THRESHOLD,
  pickTemplate,
  formatNames,
  type PostMatchReportInput,
  type WeeklyAssistantInput,
} from './inboxCore';

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
  contractDecisions: ContractDecision[],
  previousPlayers?: Record<string, Player>
) => {
  const decisionByPlayerId = contractDecisions.reduce<Record<string, ContractDecision>>((acc, decision) => {
    acc[decision.playerId] = decision;
    return acc;
  }, {});

  return getTeamSquad(players, team.id)
    .filter(player => isContractExpiringSoon(player))
    .filter(player => {
      if (currentWeek < 30 && currentWeek % 6 !== 0) return false;
      const previous = previousPlayers?.[player.id];
      return !previous || previous.contractLeft > player.contractLeft || previous.injuryWeeks !== player.injuryWeeks || currentWeek >= 34 || currentWeek % 6 === 0;
    })
    .sort((a, b) => {
      const priorityDelta = (decisionByPlayerId[b.id]?.priority || 0) - (decisionByPlayerId[a.id]?.priority || 0);
      if (priorityDelta !== 0) return priorityDelta;
      return a.contractLeft - b.contractLeft;
    })
    .slice(0, 3)
    .map(player => {
      const renewal = getRenewalOffer(player);
      const decision = decisionByPlayerId[player.id];
      const decisionType = decision?.decision || 'hold';
      const decisionReason = decision?.reason || `${player.name} needs a contract decision before the deal runs down.`;
      return buildMessage({
        week: currentWeek,
        source: 'assistant',
        category: 'contract_warning',
        title: `Contract running down: ${player.name}`,
        body: decisionType === 'renew'
          ? `${player.name} has ${formatContractLength(player)}. ${decisionReason} I would renew now at GBP ${renewal.wage}k/w for ${renewal.years} year${renewal.years === 1 ? '' : 's'}.`
          : `${player.name} has ${formatContractLength(player)}. ${decisionReason}`,
        isRead: false,
        action: decisionType === 'renew'
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
  season,
  userTeamId,
  teams,
  players,
  fixtures,
  previousPlayers,
}: WeeklyAssistantInput) => {
  if (!userTeamId) return [];

  const team = teams[userTeamId];
  if (!team) return [];
  const squadPlan = buildSquadPlan(team, players);

  const messages: InboxMessage[] = [
    ...generateRecoveryMessages(currentWeek, userTeamId, players, previousPlayers),
    ...generateContractMessages(currentWeek, team, players, squadPlan.contractDecisions, previousPlayers),
  ];

  const fixture = getNextDueFixture(fixtures, userTeamId, currentWeek);
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
      season,
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
      season,
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
      season,
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
      season,
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

  const needSeverityValue = { none: 0, watch: 1, need: 2, urgent: 3 } as const;
  const priorityNeed = [...squadPlan.needs]
    .filter(need => need.severity !== 'none')
    .sort((a, b) => {
      const severityDelta = needSeverityValue[b.severity] - needSeverityValue[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return (b.targetDepth - b.currentDepth) - (a.targetDepth - a.currentDepth);
    })[0];

  if (priorityNeed) {
    const listedTargets = Object.values(players)
      .filter(player => player.teamId !== team.id && player.isTransferListed && player.position === priorityNeed.position)
      .filter(player => player.askingPrice <= Math.max(2, team.budget * 0.6))
      .sort((a, b) => {
        if (b.overallRating !== a.overallRating) return b.overallRating - a.overallRating;
        return a.askingPrice - b.askingPrice;
      });
    const target = listedTargets[0];
    const marketSeed = `${currentWeek}-${team.id}-${priorityNeed.position}-${priorityNeed.severity}-${target?.id || 'none'}`;
    const body = target
      ? pickTemplate(`${marketSeed}-target`, [
        `${priorityNeed.reason} ${target.name} at ${teams[target.teamId]?.name || 'their club'} is listed at GBP ${target.askingPrice}m and fits the ${priorityNeed.position} gap.`,
        `The planning model flags ${priorityNeed.position} as ${priorityNeed.severity}. ${target.name} from ${teams[target.teamId]?.name || 'their club'} is available for GBP ${target.askingPrice}m.`,
        `${priorityNeed.position} needs attention: ${priorityNeed.reason} ${target.name} is listed at GBP ${target.askingPrice}m and would raise the floor.`,
      ])
      : pickTemplate(`${marketSeed}-generic`, [
        `${priorityNeed.reason} Keep an eye on the ${priorityNeed.position} market before the run gets harder.`,
        `The squad plan has ${priorityNeed.position} at ${priorityNeed.severity}. We should stay alert for value before the next stretch.`,
        `${priorityNeed.position} remains the clearest planning gap. We should keep scanning the market for help.`,
      ]);
    messages.push(buildMessage({
      week: currentWeek,
      season,
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
  season,
  userTeamId,
  fixture,
  teams,
  players,
  previousPlayers,
}: PostMatchReportInput) => {
  if (!userTeamId) return null;
  if (fixture.resolution === 'void') return null;
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
    ? `We also lost ${injuryCases.map(player => `${player.name} (${player.injuryType || 'injury'}, ${player.injuryWeeks}w)`).join(', ')}.`
    : '';

  return buildMessage({
    week: currentWeek,
    season,
    source: 'assistant',
    category: 'post_match_report',
    title: `${pickTemplate(`${reportSeed}-title`, ['Post-match', 'Match review', 'Analyst report'])}: ${team.name} ${myGoals}-${theirGoals} ${opponent.name}${fixture.competitionType !== 'league' ? ` (${getCompetitionShortName(fixture.competitionId)})` : ''}`,
    body: `${resultPrefix} ${performerNote} ${poorNote} ${disciplineNote} ${injuryNote} ${tacticalNote}`.replace(/\s+/g, ' ').trim(),
    isRead: false,
    fixtureId: fixture.id,
    teamId: team.id,
  });
};

import {
  CareerRecord,
  InboxAction,
  InboxMessage,
  SeasonSummary,
  Team,
} from '../models/types';
import {
  buildMessage,
  describeApprovalBand,
  formatCompetitionFinish,
  pickTemplate,
  type BoardInboxInput,
} from './inboxCore';

type CareerInboxInput = {
  week: number;
  summary: SeasonSummary;
  reputationDelta: number;
  careerRecord: CareerRecord;
  jobOfferTeams: Team[];
  isSacked: boolean;
  offersAvailableImmediately?: boolean;
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
  offersAvailableImmediately = false,
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
      body: `${offerReasons.join(' ')} Budget: GBP ${team.budget.toFixed(1)}m. Division: ${team.division}. Board brief: ${team.boardProfile.identity} Accept to take charge ${offersAvailableImmediately ? 'immediately' : 'immediately next season'}.`,
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
    title: isTerminal ? 'Dismissed by the board' : 'Board warning issued',
    body: isTerminal
      ? `The board has dismissed you after ${consecutiveWeeks} consecutive weeks in the critical pressure band.${context ? ` Approval is ${Math.round(context.approval)}% against a ${Math.round(context.threshold)}% threshold, with pressure ${Math.round(context.pressureScore)} and replacement risk ${Math.round(context.replacementRisk)}.` : ''} You are now between jobs.`
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

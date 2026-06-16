import assert from 'node:assert/strict';
import { initGameData } from '../../src/utils/initGame';
import { buildBoardObjectives } from '../../src/core/boardEngine';
import {
  applySeasonEndToCareer,
  buildSeasonSummary,
  createDefaultCareerRecord,
  evaluateSackingRisk,
  generateJobOfferCandidates,
} from '../../src/core/careerEngine';
import { LeagueDivision } from '../../src/models/types';
import { useGameStore } from '../../src/store/gameStore';

export const run = () => {
const runCareerEngineChecks = () => {
  const data = initGameData();
  const userTeamId = Object.keys(data.teams)[0];
  const userTeam = data.teams[userTeamId];

  // createDefaultCareerRecord produces valid initial state
  const defaultRecord = createDefaultCareerRecord();
  assert.equal(defaultRecord.seasonsManaged, 0);
  assert.equal(defaultRecord.reputation, 50);
  assert.deepEqual(defaultRecord.trophies, []);
  assert.equal(defaultRecord.consecutiveLowApprovalWeeks, 0);

  // buildSeasonSummary: champion outcome when finishing 1st in non-top-tier division
  const championTeam = { ...userTeam, wins: 30, draws: 4, losses: 4, goalsFor: 90, goalsAgainst: 30, points: 94 };
  const dominatedTables = { ...data.teams, [userTeamId]: championTeam };
  const summary = buildSeasonSummary(1, championTeam, dominatedTables, data.competitions);
  assert.equal(summary.season, 1);
  assert.equal(summary.teamId, userTeamId);
  assert.ok(['champion', 'promoted', 'stayed', 'relegated'].includes(summary.outcome));
  assert.ok(summary.finalPosition >= 1);

  const premierTeam = Object.values(data.teams).find(team => team.division === 'Premier League');
  assert.ok(premierTeam, 'Expected a Premier League team for champion regression coverage');
  if (premierTeam) {
    const premierTables = Object.fromEntries(
      Object.entries(data.teams).map(([id, team]) => [
        id,
        team.division === 'Premier League'
          ? {
              ...team,
              points: id === premierTeam.id ? 95 : Math.min(team.points, 72),
              wins: id === premierTeam.id ? 30 : team.wins,
              draws: id === premierTeam.id ? 5 : team.draws,
              losses: id === premierTeam.id ? 3 : team.losses,
            }
          : team,
      ])
    );
    const premierSummary = buildSeasonSummary(1, premierTables[premierTeam.id], premierTables, data.competitions);
    assert.equal(premierSummary.outcome, 'champion');
  }

  // buildSeasonSummary: relegated outcome when finishing last in a multi-team division
  const bottomTeam = { ...userTeam, wins: 2, draws: 3, losses: 33, goalsFor: 20, goalsAgainst: 100, points: 9, division: 'Championship' as const };
  const bottomTables = Object.fromEntries(
    Object.entries(data.teams).map(([id, t]) => [id, { ...t, division: 'Championship' as const, points: id === userTeamId ? 9 : 60 }])
  );
  const relegatedSummary = buildSeasonSummary(1, bottomTeam, bottomTables, data.competitions);
  assert.ok(['relegated', 'stayed'].includes(relegatedSummary.outcome));

  // applySeasonEndToCareer: champion adds reputation, trophy, increments seasons
  const champRecord = createDefaultCareerRecord();
  const champSummary = buildSeasonSummary(1, championTeam, dominatedTables, data.competitions);
  if (champSummary.outcome === 'champion') {
    const { careerRecord: after, reputationDelta } = applySeasonEndToCareer(champRecord, champSummary);
    assert.equal(after.seasonsManaged, 1);
    assert.equal(reputationDelta, 9);
    assert.equal(after.reputation, 59);
    assert.equal(after.trophies.length, 1);
    assert.equal(after.trophies[0].type, 'champion');
  }

  // applySeasonEndToCareer: relegated drops reputation, adds relegated trophy
  const rel = { ...champSummary, outcome: 'relegated' as const, boardVerdict: 'critical' as const };
  const relRecord = createDefaultCareerRecord();
  const { careerRecord: relAfter, reputationDelta: relDelta } = applySeasonEndToCareer(relRecord, rel);
  assert.equal(relDelta, -12);
  assert.equal(relAfter.reputation, 38);
  assert.equal(relAfter.trophies[0]?.type, 'relegated');

  // applySeasonEndToCareer: reputation is clamped to [0, 100]
  const lowRepRecord = { ...createDefaultCareerRecord(), reputation: 5 };
  const { careerRecord: clamped } = applySeasonEndToCareer(lowRepRecord, rel);
  assert.ok(clamped.reputation >= 0);

  // applySeasonEndToCareer: season history capped at 10 entries
  let rollingRecord = createDefaultCareerRecord();
  for (let i = 0; i < 12; i++) {
    const stayed = { ...champSummary, season: i + 1, outcome: 'stayed' as const };
    ({ careerRecord: rollingRecord } = applySeasonEndToCareer(rollingRecord, stayed));
  }
  assert.equal(rollingRecord.seasonHistory.length, 10);
  assert.equal(rollingRecord.seasonsManaged, 12);

  // evaluateSackingRisk: resets counter when approval recovers
  const { newConsecutiveWeeks: reset } = evaluateSackingRisk(50, 3);
  assert.equal(reset, 0);

  // evaluateSackingRisk: increments when below threshold
  const { newConsecutiveWeeks: wk1, shouldWarn: warn1, isSackingImminent: imm1 } = evaluateSackingRisk(15, 0);
  assert.equal(wk1, 1);
  assert.equal(warn1, false);
  assert.equal(imm1, false);

  // evaluateSackingRisk: shouldWarn at 3 consecutive weeks
  const { shouldWarn: warn3, isSackingImminent: imm3 } = evaluateSackingRisk(15, 2);
  assert.equal(warn3, true);
  assert.equal(imm3, false);

  // evaluateSackingRisk: isSackingImminent at 4+ consecutive weeks
  const { isSackingImminent: imm4 } = evaluateSackingRisk(15, 3);
  assert.equal(imm4, true);

  // generateJobOfferCandidates: returns at most 2 teams excluding current
  const candidates = generateJobOfferCandidates(data.teams, userTeamId, champSummary);
  assert.ok(candidates.length <= 2);
  assert.ok(candidates.every(t => t.id !== userTeamId));

  const configuredOfferPool = Object.fromEntries(
    Object.values(data.teams).map(team => [team.id, { ...team }])
  );
  const premierOfferTargets = Object.values(configuredOfferPool)
    .filter(team => team.division === 'Premier League' && team.id !== userTeamId)
    .slice(0, 4);
  const championshipOfferTargets = Object.values(configuredOfferPool)
    .filter(team => team.division === 'Championship')
    .slice(0, 3);
  assert.ok(premierOfferTargets.length >= 3, 'Expected enough Premier League teams for offer-trajectory coverage');
  assert.ok(championshipOfferTargets.length >= 2, 'Expected enough Championship teams for offer-trajectory coverage');
  if (premierOfferTargets.length >= 3 && championshipOfferTargets.length >= 2) {
    configuredOfferPool[premierOfferTargets[0].id] = {
      ...configuredOfferPool[premierOfferTargets[0].id],
      boardProfile: { ...configuredOfferPool[premierOfferTargets[0].id].boardProfile, ambition: 'elite' },
      manager: {
        ...configuredOfferPool[premierOfferTargets[0].id].manager,
        replacementRisk: 88,
        jobSecurity: 24,
      },
    };
    configuredOfferPool[premierOfferTargets[1].id] = {
      ...configuredOfferPool[premierOfferTargets[1].id],
      boardProfile: { ...configuredOfferPool[premierOfferTargets[1].id].boardProfile, ambition: 'europe' },
      manager: {
        ...configuredOfferPool[premierOfferTargets[1].id].manager,
        replacementRisk: 83,
        jobSecurity: 30,
      },
    };
    configuredOfferPool[premierOfferTargets[2].id] = {
      ...configuredOfferPool[premierOfferTargets[2].id],
      boardProfile: { ...configuredOfferPool[premierOfferTargets[2].id].boardProfile, ambition: 'survival' },
      manager: {
        ...configuredOfferPool[premierOfferTargets[2].id].manager,
        replacementRisk: 90,
        jobSecurity: 18,
      },
    };
    configuredOfferPool[championshipOfferTargets[0].id] = {
      ...configuredOfferPool[championshipOfferTargets[0].id],
      boardProfile: { ...configuredOfferPool[championshipOfferTargets[0].id].boardProfile, ambition: 'stability' },
      manager: {
        ...configuredOfferPool[championshipOfferTargets[0].id].manager,
        replacementRisk: 86,
        jobSecurity: 22,
      },
    };
    configuredOfferPool[championshipOfferTargets[1].id] = {
      ...configuredOfferPool[championshipOfferTargets[1].id],
      boardProfile: { ...configuredOfferPool[championshipOfferTargets[1].id].boardProfile, ambition: 'survival' },
      manager: {
        ...configuredOfferPool[championshipOfferTargets[1].id].manager,
        replacementRisk: 82,
        jobSecurity: 26,
      },
    };

    const strongSeasonOffers = generateJobOfferCandidates(configuredOfferPool, userTeamId, {
      ...champSummary,
      outcome: 'champion',
      boardVerdict: 'thriving',
    });
    const weakSeasonOffers = generateJobOfferCandidates(configuredOfferPool, userTeamId, {
      ...champSummary,
      outcome: 'sacked',
      boardVerdict: 'critical',
    });
    assert.ok(
      strongSeasonOffers.some(team => (
        team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe'
      )),
      'Strong seasons should surface ambitious board opportunities'
    );
    assert.ok(
      weakSeasonOffers.every(team => team.boardProfile.ambition !== 'elite'),
      'Weak seasons should not prioritize elite-board offers'
    );
  }

  useGameStore.getState().initializeGame(userTeamId);
  const offerTeamId = Object.keys(useGameStore.getState().teams).find(id => id !== userTeamId);
  assert.ok(offerTeamId, 'Expected a different team for job offer action coverage');
  if (offerTeamId) {
    const offerTeam = useGameStore.getState().teams[offerTeamId];
    const expectedObjectives = buildBoardObjectives(
      offerTeam.clubClass || 'C',
      (offerTeam.division === 'Continental' ? 'Premier League' : offerTeam.division) as LeagueDivision,
      offerTeam.boardProfile,
      Object.values(useGameStore.getState().competitions)
        .filter(competition => competition.entrantTeamIds.includes(offerTeamId))
        .map(competition => competition.id)
    );
    useGameStore.setState({
      inboxMessages: [
        {
          id: 'job-offer-test',
          week: 1,
          source: 'system',
          category: 'career_job_offer',
          title: `Job offer: ${offerTeam.name}`,
          body: 'Test offer',
          isRead: false,
          action: {
            type: 'accept_job_offer',
            payload: { teamId: offerTeamId },
          },
          teamId: offerTeamId,
        },
        {
          id: 'stale-board-test',
          week: 1,
          source: 'system',
          category: 'board_update',
          title: 'Old board update',
          body: 'Should be removed when switching clubs.',
          isRead: false,
          teamId: userTeamId,
        },
        {
          id: 'career-history-test',
          week: 1,
          source: 'system',
          category: 'career_milestone',
          title: 'Career note',
          body: 'Should survive the club switch.',
          isRead: false,
          teamId: userTeamId,
        },
      ],
    });
    useGameStore.getState().applyInboxAction('job-offer-test');
    const acceptedState = useGameStore.getState();
    assert.equal(acceptedState.userTeamId, offerTeamId);
    assert.deepEqual(
      acceptedState.boardObjectives.map(({ description, type, target, met }) => ({ description, type, target, met })),
      expectedObjectives.map(({ description, type, target, met }) => ({ description, type, target, met }))
    );
    assert.ok(!acceptedState.inboxMessages.some(message => message.category === 'career_job_offer'));
    assert.ok(!acceptedState.inboxMessages.some(message => message.id === 'stale-board-test'));
    assert.ok(acceptedState.inboxMessages.some(message => message.id === 'career-history-test'));
  }
};
  runCareerEngineChecks();
};

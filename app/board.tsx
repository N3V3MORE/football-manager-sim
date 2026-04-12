import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { PageHeader } from '@/components/ui/page-header';
import { useGameStore } from '@/src/store/gameStore';
import { SeasonSummary, TrophyEntry } from '@/src/models/types';
import { getCompetitionName } from '@/src/core/competitionEngine';

const OUTCOME_LABEL: Record<SeasonSummary['outcome'], string> = {
  champion: 'Champion',
  promoted: 'Promoted',
  stayed: 'Mid-table',
  relegated: 'Relegated',
  sacked: 'Sacked',
};

const OUTCOME_COLOR: Record<SeasonSummary['outcome'], string> = {
  champion: '#f59e0b',
  promoted: '#10B981',
  stayed: '#94a3b8',
  relegated: '#ef4444',
  sacked: '#7f1d1d',
};

const TROPHY_LABEL: Record<TrophyEntry['type'], string> = {
  champion: 'Division Champion',
  promoted: 'Promotion',
  relegated: 'Relegated',
  cup_winner: 'Cup Winner',
  continental_winner: 'Europe Winner',
};

const TROPHY_COLOR: Record<TrophyEntry['type'], string> = {
  champion: '#f59e0b',
  promoted: '#10B981',
  relegated: '#ef4444',
  cup_winner: '#38bdf8',
  continental_winner: '#f59e0b',
};

export default function BoardScreen() {
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const objectives = useGameStore(state => state.boardObjectives);
  const careerRecord = useGameStore(state => state.careerRecord);

  const team = userTeamId ? teams[userTeamId] : null;
  const approval = team?.boardApproval ?? 50;
  const pressure = team?.manager.pressureScore ?? 0;
  const replacementRisk = team?.manager.replacementRisk ?? 0;
  const ambitionLabel = team ? team.boardProfile.ambition.replace('_', ' ') : '';
  const patienceLabel = team ? team.boardProfile.patience : '';
  const spendingLabel = team ? team.boardProfile.transferDiscipline.replace('_', ' ') : '';
  const targetCompetitions = team
    ? team.boardProfile.targetCompetitions
        .map(competitionId => getCompetitionName(competitionId))
        .join(' | ')
    : '';

  let statusText = 'Stable';
  let statusColor = '#f59e0b';
  if (approval < 15 || replacementRisk >= 75) {
    statusText = 'Critical Review';
    statusColor = '#7f1d1d';
  } else if (approval < 30 || pressure >= 60) {
    statusText = 'Under Pressure';
    statusColor = '#ef4444';
  } else if (approval >= 80) {
    statusText = 'Untouchable';
    statusColor = '#10B981';
  } else if (approval >= 65) {
    statusText = 'Secure';
    statusColor = '#34d399';
  }

  const totalPlayed = careerRecord.totalWins + careerRecord.totalDraws + careerRecord.totalLosses;
  const positiveResults = careerRecord.trophies.filter(trophy => trophy.type !== 'relegated');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHeader title="Board Room" backLabel="< Hub" onBack={() => router.replace('/')} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {team ? (
          <>
            <View style={styles.gaugeCard}>
              <Text style={styles.gaugeLabel}>Manager Approval Rating</Text>
              <Text style={[styles.gaugeValue, { color: statusColor }]}>{Math.round(approval)}%</Text>
              <Text style={styles.gaugeStatus}>{statusText}</Text>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${approval}%`, backgroundColor: statusColor }]} />
              </View>
            </View>

            <View style={styles.contextCard}>
              <Text style={styles.sectionTitle}>Board Context</Text>
              <Text style={styles.contextBody}>{team.boardProfile.identity}</Text>
              <View style={styles.tagRow}>
                <View style={styles.contextTag}>
                  <Text style={styles.contextTagLabel}>Ambition</Text>
                  <Text style={styles.contextTagValue}>{ambitionLabel}</Text>
                </View>
                <View style={styles.contextTag}>
                  <Text style={styles.contextTagLabel}>Patience</Text>
                  <Text style={styles.contextTagValue}>{patienceLabel}</Text>
                </View>
                <View style={styles.contextTag}>
                  <Text style={styles.contextTagLabel}>Spending</Text>
                  <Text style={styles.contextTagValue}>{spendingLabel}</Text>
                </View>
              </View>
              <Text style={styles.contextLabel}>Target Competitions</Text>
              <Text style={styles.contextBody}>{targetCompetitions || 'Domestic league focus'}</Text>
            </View>

            <View style={styles.contextCard}>
              <Text style={styles.sectionTitle}>Manager Standing</Text>
              <View style={styles.careerRow}>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{Math.round(team.manager.boardTrust)}</Text>
                  <Text style={styles.careerStatLabel}>Trust</Text>
                </View>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{Math.round(team.manager.jobSecurity)}</Text>
                  <Text style={styles.careerStatLabel}>Security</Text>
                </View>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{Math.round(pressure)}</Text>
                  <Text style={styles.careerStatLabel}>Pressure</Text>
                </View>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{Math.round(replacementRisk)}</Text>
                  <Text style={styles.careerStatLabel}>Risk</Text>
                </View>
              </View>
              <Text style={styles.contextLabel}>Expectation</Text>
              <Text style={styles.contextBody}>{team.manager.seasonExpectations}</Text>
            </View>

            <Text style={styles.sectionTitle}>Season Objectives</Text>
            {objectives.length > 0 ? objectives.map(objective => (
              <View key={objective.id} style={styles.objCard}>
                <Text style={styles.objDesc}>{objective.description}</Text>
                <View style={[styles.statusBadge, objective.met ? styles.metBadge : styles.pendingBadge]}>
                  <Text style={[styles.statusText, objective.met ? styles.metText : styles.pendingText]}>
                    {objective.met ? 'Met' : 'In Progress'}
                  </Text>
                </View>
              </View>
            )) : (
              <Text style={styles.empty}>No objectives set.</Text>
            )}
          </>
        ) : (
          <Text style={styles.empty}>No club is currently assigned. Review your career record and inbox offers.</Text>
        )}

        {careerRecord.seasonsManaged > 0 && (
          <>
            <Text style={styles.sectionTitle}>Career Summary</Text>
            <View style={styles.careerCard}>
              <View style={styles.careerRow}>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{careerRecord.seasonsManaged}</Text>
                  <Text style={styles.careerStatLabel}>Seasons</Text>
                </View>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{careerRecord.reputation}</Text>
                  <Text style={styles.careerStatLabel}>Reputation</Text>
                </View>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{positiveResults.length}</Text>
                  <Text style={styles.careerStatLabel}>Honours</Text>
                </View>
              </View>
              <View style={styles.careerRow}>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{careerRecord.totalWins}</Text>
                  <Text style={styles.careerStatLabel}>Wins</Text>
                </View>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{careerRecord.totalDraws}</Text>
                  <Text style={styles.careerStatLabel}>Draws</Text>
                </View>
                <View style={styles.careerStat}>
                  <Text style={styles.careerStatValue}>{careerRecord.totalLosses}</Text>
                  <Text style={styles.careerStatLabel}>Losses</Text>
                </View>
              </View>
              {totalPlayed > 0 ? (
                <View style={styles.recordBar}>
                  <View style={[styles.recordSegment, { flex: careerRecord.totalWins, backgroundColor: '#10B981' }]} />
                  <View style={[styles.recordSegment, { flex: careerRecord.totalDraws, backgroundColor: '#f59e0b' }]} />
                  <View style={[styles.recordSegment, { flex: careerRecord.totalLosses, backgroundColor: '#ef4444' }]} />
                </View>
              ) : null}
            </View>
          </>
        )}

        {careerRecord.trophies.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Trophy Cabinet</Text>
            {careerRecord.trophies.map(trophy => (
              <View
                key={`${trophy.season}-${trophy.type}-${trophy.division}`}
                style={styles.trophyCard}
              >
                <View style={[styles.trophyBadge, { backgroundColor: TROPHY_COLOR[trophy.type] + '22' }]}>
                  <Text style={[styles.trophyBadgeText, { color: TROPHY_COLOR[trophy.type] }]}>
                    {trophy.label || TROPHY_LABEL[trophy.type]}
                  </Text>
                </View>
                <View style={styles.trophyInfo}>
                  <Text style={styles.trophyDivision}>{trophy.label || trophy.division}</Text>
                  <Text style={styles.trophySeason}>Season {trophy.season}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {careerRecord.seasonHistory.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Season History</Text>
            {[...careerRecord.seasonHistory].reverse().map(summary => (
              <View key={`${summary.season}-${summary.teamId}`} style={styles.historyCard}>
                <View style={styles.historyLeft}>
                  <Text style={styles.historyTeam}>{summary.teamName}</Text>
                  <Text style={styles.historyDivision}>{summary.division} - #{summary.finalPosition}</Text>
                </View>
                <View style={styles.historyMid}>
                  <Text style={styles.historyRecord}>{summary.wins}W {summary.draws}D {summary.losses}L</Text>
                  <Text style={styles.historyGoals}>{summary.goalsFor}-{summary.goalsAgainst}</Text>
                </View>
                <View style={[styles.outcomePill, { backgroundColor: OUTCOME_COLOR[summary.outcome] + '22' }]}>
                  <Text style={[styles.outcomePillText, { color: OUTCOME_COLOR[summary.outcome] }]}>
                    {OUTCOME_LABEL[summary.outcome]}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {careerRecord.seasonsManaged === 0 ? (
          <Text style={styles.empty}>Complete a season to see your career record.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 16, gap: 16 },
  gaugeCard: {
    backgroundColor: '#1e293b',
    padding: 20,
    borderRadius: 0,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  gaugeLabel: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '900',
    letterSpacing: 1,
  },
  gaugeValue: { fontSize: 48, fontWeight: '900', marginTop: 10 },
  gaugeStatus: { color: '#cbd5e1', fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 20 },
  barBg: { height: 8, width: '100%', backgroundColor: '#0f172a', borderRadius: 0, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 0 },
  sectionTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800', marginTop: 10 },
  contextCard: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  contextBody: { color: '#cbd5e1', fontSize: 13, lineHeight: 20 },
  contextLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tagRow: { flexDirection: 'row', gap: 10 },
  contextTag: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
    gap: 4,
  },
  contextTagLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  contextTagValue: { color: '#f8fafc', fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  objCard: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  objDesc: { color: '#e2e8f0', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 0 },
  metBadge: { backgroundColor: '#064e3b' },
  pendingBadge: { backgroundColor: '#1e3a8a' },
  statusText: { fontSize: 11, fontWeight: '900' },
  metText: { color: '#34d399' },
  pendingText: { color: '#60a5fa' },
  empty: { color: '#64748b', fontStyle: 'italic' },
  careerCard: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  careerRow: { flexDirection: 'row', justifyContent: 'space-around' },
  careerStat: { alignItems: 'center' },
  careerStatValue: { color: '#f8fafc', fontSize: 22, fontWeight: '900' },
  careerStatLabel: { color: '#64748b', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  recordBar: { height: 6, flexDirection: 'row', overflow: 'hidden', gap: 1 },
  recordSegment: { height: '100%' },
  trophyCard: {
    backgroundColor: '#1e293b',
    padding: 14,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  trophyBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 0 },
  trophyBadgeText: { fontSize: 11, fontWeight: '900' },
  trophyInfo: { flex: 1 },
  trophyDivision: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  trophySeason: { color: '#64748b', fontSize: 11, fontWeight: '600', marginTop: 2 },
  historyCard: {
    backgroundColor: '#1e293b',
    padding: 14,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyLeft: { flex: 1 },
  historyTeam: { color: '#f8fafc', fontSize: 13, fontWeight: '800' },
  historyDivision: { color: '#64748b', fontSize: 11, fontWeight: '600', marginTop: 2 },
  historyMid: { alignItems: 'flex-end', marginRight: 8 },
  historyRecord: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  historyGoals: { color: '#64748b', fontSize: 11, fontWeight: '600', marginTop: 2 },
  outcomePill: { paddingHorizontal: 8, paddingVertical: 4 },
  outcomePillText: { fontSize: 11, fontWeight: '900' },
});


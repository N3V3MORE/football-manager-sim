import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CareerRecord } from '@/src/models/types';

type CareerStatsCardProps = {
  careerRecord: CareerRecord;
  onPress: () => void;
};

const REP_LABEL = (rep: number) => {
  if (rep >= 80) return 'Elite';
  if (rep >= 65) return 'Respected';
  if (rep >= 45) return 'Established';
  if (rep >= 25) return 'Emerging';
  return 'Unknown';
};

export const CareerStatsCard = React.memo(function CareerStatsCard({ careerRecord, onPress }: CareerStatsCardProps) {
  const { seasonsManaged, reputation, trophies, totalWins, totalDraws, totalLosses } = careerRecord;
  const honours = trophies.filter(t => t.type !== 'relegated').length;
  const totalPlayed = totalWins + totalDraws + totalLosses;
  const winPct = totalPlayed > 0 ? Math.round((totalWins / totalPlayed) * 100) : 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.header}>
        <Text style={styles.cardTitle}>Career</Text>
        <View style={styles.repBadge}>
          <Text style={styles.repLabel}>{REP_LABEL(reputation)}</Text>
          <Text style={styles.repValue}>{reputation} rep</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{seasonsManaged}</Text>
          <Text style={styles.statLabel}>Seasons</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{honours}</Text>
          <Text style={styles.statLabel}>Honours</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{winPct}%</Text>
          <Text style={styles.statLabel}>Win rate</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{trophies.filter(t => t.type === 'champion').length}</Text>
          <Text style={styles.statLabel}>Titles</Text>
        </View>
      </View>

      {totalPlayed > 0 && (
        <View style={styles.recordBar}>
          <View style={[styles.seg, { flex: totalWins, backgroundColor: '#10B981' }]} />
          <View style={[styles.seg, { flex: totalDraws, backgroundColor: '#f59e0b' }]} />
          <View style={[styles.seg, { flex: totalLosses, backgroundColor: '#ef4444' }]} />
        </View>
      )}

      <Text style={styles.tapHint}>Tap to view board room</Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    gap: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#e2e8f0', letterSpacing: 0.5 },
  repBadge: { alignItems: 'flex-end' },
  repLabel: { fontSize: 11, fontWeight: '900', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5 },
  repValue: { fontSize: 11, color: '#64748b', fontWeight: '600', marginTop: 1 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '900', color: '#f8fafc' },
  statLabel: { fontSize: 10, color: '#64748b', fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  recordBar: { height: 4, flexDirection: 'row', overflow: 'hidden', gap: 1 },
  seg: { height: '100%' },
  tapHint: { fontSize: 11, color: '#38bdf8', fontWeight: '700', textAlign: 'right' },
});

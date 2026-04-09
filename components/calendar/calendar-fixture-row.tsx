import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type CalendarFixtureRowProps = {
  week: number;
  dateLabel: string;
  isHome: boolean;
  opponentName: string;
  opponentColor: string;
  isPast: boolean;
  isCurrent: boolean;
  score: string | null;
};

export function CalendarFixtureRow({
  week,
  dateLabel,
  isHome,
  opponentName,
  opponentColor,
  isPast,
  isCurrent,
  score,
}: CalendarFixtureRowProps) {
  return (
    <View style={[styles.row, isCurrent && styles.rowCurrent, isPast && styles.rowPast]}>
      <View style={styles.dateCol}>
        <Text style={styles.weekLabel}>WK {week}</Text>
        <Text style={styles.dateLabel}>{dateLabel}</Text>
      </View>

      <View style={styles.badgeCol}>
        <View style={[styles.haBadge, { backgroundColor: isHome ? '#38bdf8' : '#64748b' }]}>
          <Text style={styles.haText}>{isHome ? 'H' : 'A'}</Text>
        </View>
      </View>

      <View style={styles.oppCol}>
        <View style={[styles.kitDot, { backgroundColor: opponentColor }]} />
        <Text style={[styles.oppName, isPast && styles.oppNamePast]} numberOfLines={1}>
          {opponentName}
        </Text>
      </View>

      <View style={styles.scoreCol}>
        {score ? (
          <Text style={styles.scoreText}>{score}</Text>
        ) : (
          <Text style={styles.vsText}>VS</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  rowCurrent: { backgroundColor: '#0ea5e920' },
  rowPast: { opacity: 0.7 },
  dateCol: { width: 60 },
  weekLabel: { color: '#64748b', fontSize: 10, fontWeight: '900' },
  dateLabel: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginTop: 2 },
  badgeCol: { width: 30, alignItems: 'center' },
  haBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  haText: { color: '#0f172a', fontWeight: '900', fontSize: 10 },
  oppCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10 },
  kitDot: { width: 10, height: 10, borderRadius: 5 },
  oppName: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  oppNamePast: { color: '#94a3b8' },
  scoreCol: { width: 60, alignItems: 'flex-end' },
  vsText: { color: '#475569', fontWeight: '900', fontSize: 12 },
  scoreText: { color: '#38bdf8', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
});

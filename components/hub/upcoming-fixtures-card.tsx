import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSecondaryKitColor } from '@/src/constants/teamColors';

export type UpcomingFixtureCardRow = {
  week: number;
  dateLabel: string;
  isCurrentWeek: boolean;
  isHome: boolean;
  opponentName: string | null;
  opponentPrimary?: string;
  opponentSecondary?: string;
  score?: string | null;
};

type UpcomingFixturesCardProps = {
  rows: UpcomingFixtureCardRow[];
  onPress: () => void;
};

export function UpcomingFixturesCard({ rows, onPress }: UpcomingFixturesCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.cardTitle}>Upcoming Fixtures</Text>
      {rows.map((row) => (
        <View key={row.week} style={[styles.calRow, row.isCurrentWeek && styles.calRowCurrent]}>
          <View style={styles.calDateBlock}>
            <Text style={[styles.calWeek, row.isCurrentWeek && styles.calWeekCurrent]}>Wk {row.week}</Text>
            <Text style={styles.calDate}>{row.dateLabel}</Text>
          </View>
          {row.opponentName ? (
            <View style={styles.calMatchBlock}>
              <View style={[styles.calHABadge, row.isHome ? styles.calHAHome : styles.calHAAway]}>
                <Text style={styles.calHAText}>{row.isHome ? 'H' : 'A'}</Text>
              </View>
              <View style={[styles.calKitChip, { backgroundColor: row.opponentPrimary }]} />
              <View
                style={[
                  styles.calKitChip,
                  { backgroundColor: getSecondaryKitColor(row.opponentSecondary || '#FFFFFF') },
                ]}
              />
              <Text style={styles.calOpp} numberOfLines={1}>{row.opponentName}</Text>
              {row.score ? <Text style={styles.calScore}>{row.score}</Text> : null}
            </View>
          ) : (
            <Text style={styles.calBye}>Rest week</Text>
          )}
        </View>
      ))}
      <Text style={styles.smallTapText}>Tap to view full calendar</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardTitle: { fontSize: 16, fontWeight: '900', marginBottom: 12, color: '#e2e8f0', letterSpacing: 0.5 },
  smallTapText: { fontSize: 11, color: '#38bdf8', fontWeight: '700', marginTop: 10, textAlign: 'right' },
  calRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  calRowCurrent: { backgroundColor: '#0ea5e910' },
  calDateBlock: { width: 60 },
  calWeek: { fontSize: 10, fontWeight: '900', color: '#64748b', textTransform: 'uppercase' },
  calWeekCurrent: { color: '#38bdf8' },
  calDate: { fontSize: 12, color: '#475569', fontWeight: '600', marginTop: 2 },
  calMatchBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  calHABadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  calHAHome: { backgroundColor: '#1a3a4a' },
  calHAAway: { backgroundColor: '#2a1a1a' },
  calHAText: { color: '#94a3b8', fontSize: 9, fontWeight: '900' },
  calKitChip: { width: 8, height: 8, borderRadius: 2 },
  calOpp: { flex: 1, fontSize: 13, fontWeight: '700', color: '#e2e8f0' },
  calScore: { fontSize: 13, fontWeight: '900', color: '#38bdf8' },
  calBye: { flex: 1, fontSize: 12, color: '#334155', fontStyle: 'italic' },
});

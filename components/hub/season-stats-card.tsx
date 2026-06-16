import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Player } from '@/src/models/types';

type StatLeader = {
  label: string;
  player?: Player;
  stat: string;
};

type SeasonStatsCardProps = {
  leaders: StatLeader[];
  onPress: () => void;
};

export default React.memo(function SeasonStatsCard({ leaders, onPress }: SeasonStatsCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <Text style={styles.cardTitle}>Season Stats</Text>
      {leaders.map(({ label, player, stat }) => (
        <View key={label} style={styles.statLeaderRow}>
          <Text style={styles.statLeaderLabel}>{label}</Text>
          <View style={styles.statLeaderInfo}>
            <Text style={styles.statLeaderName}>{player ? player.name : '-'}</Text>
            <Text style={styles.statLeaderNum}>{stat}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.smallTapText}>Tap for full stats</Text>
    </TouchableOpacity>
  );
}
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardTitle: { fontSize: 16, fontWeight: '900', marginBottom: 12, color: '#e2e8f0', letterSpacing: 0.5 },
  smallTapText: { fontSize: 11, color: '#38bdf8', fontWeight: '700', marginTop: 10, textAlign: 'right' },
  statLeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  statLeaderLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', width: 100 },
  statLeaderInfo: { flex: 1 },
  statLeaderName: { fontSize: 13, fontWeight: '800', color: '#f8fafc' },
  statLeaderNum: { fontSize: 11, color: '#64748b', fontWeight: '600' },
});

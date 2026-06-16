import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSecondaryKitColor, getTeamTheme } from '@/src/constants/teamColors';
import { Team } from '@/src/models/types';

type MiniTableRow = Team & {
  position: number;
};

type MiniTableCardProps = {
  title: string;
  rows: MiniTableRow[];
  userTeamId: string | null;
  onPress: () => void;
};

export default React.memo(function MiniTableCard({ title, rows, userTeamId, onPress }: MiniTableCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <Text style={styles.cardTitle}>{title}</Text>
      {rows.map((team) => {
        const theme = getTeamTheme(team.name);
        const isUser = team.id === userTeamId;

        return (
          <View key={team.id} style={[styles.miniRow, isUser && styles.miniRowUser]}>
            <Text style={[styles.miniPos, isUser && styles.miniTextUser]}>{team.position}.</Text>
            <View style={styles.miniKitStrip}>
              <View style={[styles.miniKitBlock, { backgroundColor: theme.primary }]} />
              <View style={[styles.miniKitBlock, { backgroundColor: getSecondaryKitColor(theme.secondary) }]} />
            </View>
            <Text style={[styles.miniName, isUser && styles.miniTextUser]} numberOfLines={1}>{team.name}</Text>
            <Text style={[styles.miniStat, isUser && styles.miniTextUser]}>
              {team.goalsFor - team.goalsAgainst > 0 ? '+' : ''}
              {team.goalsFor - team.goalsAgainst}
            </Text>
            <Text style={[styles.miniStat, styles.miniPts, isUser && styles.miniTextUser]}>{team.points}</Text>
          </View>
        );
      })}
      <Text style={styles.smallTapText}>Tap to view full table</Text>
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
  miniRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  miniRowUser: { backgroundColor: '#0ea5e915' },
  miniPos: { width: 24, fontWeight: '700', color: '#64748b', fontSize: 13 },
  miniKitStrip: { flexDirection: 'row', width: 16, height: 16, borderRadius: 0, overflow: 'hidden', marginRight: 8 },
  miniKitBlock: { flex: 1 },
  miniName: { flex: 1, color: '#cbd5e1', fontWeight: '600', fontSize: 13 },
  miniTextUser: { color: '#38bdf8', fontWeight: '900' },
  miniStat: { width: 32, textAlign: 'center', color: '#64748b', fontWeight: '600', fontSize: 12 },
  miniPts: { fontWeight: '900', color: '#f8fafc', fontSize: 13 },
});

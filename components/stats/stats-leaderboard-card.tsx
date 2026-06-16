import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type StatsLeaderboardRow = {
  id: string;
  name: string;
  teamName: string;
  value: number;
};

type StatsLeaderboardCardProps = {
  title: string;
  rows: StatsLeaderboardRow[];
  isExpanded: boolean;
  valueColor?: string;
  onToggle: () => void;
};

export default React.memo(function StatsLeaderboardCard({
  title,
  rows,
  isExpanded,
  valueColor = '#38bdf8',
  onToggle,
}: StatsLeaderboardCardProps) {
  const displayRows = isExpanded ? rows : rows.slice(0, 3);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={onToggle}>
      <View style={styles.paneHeaderRow}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.expandText}>{isExpanded ? 'Collapse' : 'Expand'}</Text>
      </View>
      {rows.length > 0 ? (
        displayRows.map((row, index) => (
          <View key={row.id} style={styles.row}>
            <Text style={styles.rank}>{index + 1}.</Text>
            <View style={styles.playerInfo}>
              <Text style={styles.name}>{row.name}</Text>
              <Text style={styles.teamName}>{row.teamName}</Text>
            </View>
            <Text style={[styles.statValue, { color: valueColor }]}>{row.value}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>No stats recorded yet.</Text>
      )}
    </TouchableOpacity>
  );
}
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e293b',
    marginTop: 10,
    marginBottom: 16,
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#e2e8f0',
  },
  paneHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 8,
    marginBottom: 12,
  },
  expandText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyText: {
    color: '#64748b',
    fontStyle: 'italic',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  rank: {
    width: 30,
    fontSize: 18,
    fontWeight: '900',
    color: '#94a3b8',
  },
  playerInfo: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  teamName: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '600',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    width: 40,
    textAlign: 'center',
  },
});

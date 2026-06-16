import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type CompetitionPanel = {
  title: string;
  status: string;
  note: string;
  accent: string;
};

type CompetitionPanelsCardProps = {
  items: CompetitionPanel[];
};

export default React.memo(function CompetitionPanelsCard({ items }: CompetitionPanelsCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Competition Watch</Text>
      <View style={styles.panelRow}>
        {items.map((item) => (
          <View key={item.title} style={styles.panel}>
            <View style={[styles.accentBar, { backgroundColor: item.accent }]} />
            <Text style={styles.panelTitle}>{item.title}</Text>
            <Text style={[styles.panelStatus, { color: item.accent }]}>{item.status}</Text>
            <Text style={styles.panelNote}>{item.note}</Text>
          </View>
        ))}
      </View>
    </View>
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 12,
    color: '#e2e8f0',
    letterSpacing: 0.5,
  },
  panelRow: {
    flexDirection: 'row',
    gap: 8,
  },
  panel: {
    flex: 1,
    minHeight: 106,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  accentBar: {
    width: 18,
    height: 3,
    marginBottom: 10,
  },
  panelTitle: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  panelStatus: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 16,
  },
  panelNote: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
});

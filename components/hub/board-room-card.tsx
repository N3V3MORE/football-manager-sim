import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type BoardRoomCardProps = {
  boardApproval: number;
  managerName: string;
  onPress: () => void;
};

const getApprovalColor = (boardApproval: number) => {
  if (boardApproval >= 65) return '#10B981';
  if (boardApproval < 30) return '#ef4444';
  return '#f59e0b';
};

export function BoardRoomCard({ boardApproval, managerName, onPress }: BoardRoomCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.cardTitle}>Board Room</Text>
      <View style={styles.row}>
        <View>
          <Text style={styles.label}>Manager Approval</Text>
          <Text style={[styles.approval, { color: getApprovalColor(boardApproval) }]}>
            {Math.round(boardApproval)}%
          </Text>
          <Text style={styles.managerName}>{managerName}</Text>
        </View>
        <View style={styles.rightCol}>
          <Text style={styles.tapText}>Tap to view objectives</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  approval: { fontSize: 24, fontWeight: '900', marginTop: 4 },
  managerName: { color: '#cbd5e1', fontSize: 12, fontWeight: '800', marginTop: 6 },
  rightCol: { alignItems: 'flex-end' },
  tapText: { fontSize: 11, color: '#38bdf8', fontWeight: '700', marginTop: 10, textAlign: 'right' },
});

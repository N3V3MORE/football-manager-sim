import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSecondaryKitColor, getTeamTheme } from '@/src/constants/teamColors';
import { Team } from '@/src/models/types';

type TeamSelectionSheetProps = {
  visible: boolean;
  teams: Team[];
  currentTeamId: string | null;
  onSelect: (teamId: string) => void;
  onClose: () => void;
};

export function TeamSelectionSheet({
  visible,
  teams,
  currentTeamId,
  onSelect,
  onClose,
}: TeamSelectionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Change Team</Text>
          <ScrollView>
            {teams.map((team) => {
              const theme = getTeamTheme(team.name);
              const isCurrent = team.id === currentTeamId;

              return (
                <TouchableOpacity
                  key={team.id}
                  style={[styles.teamRow, isCurrent && styles.teamRowActive]}
                  onPress={() => onSelect(team.id)}
                >
                  <View style={[styles.kitChip, { backgroundColor: theme.primary }]} />
                  <View style={[styles.kitChip, { backgroundColor: getSecondaryKitColor(theme.secondary) }]} />
                  <Text style={[styles.teamRowName, isCurrent && styles.currentText]}>{team.name}</Text>
                  <Text style={styles.teamRowDivision}>{team.division}</Text>
                  {isCurrent && <Text style={styles.currentBadge}>CURRENT</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', paddingBottom: 30 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#f8fafc', textAlign: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  teamRow: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b', flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamRowActive: { backgroundColor: '#0ea5e915' },
  kitChip: { width: 10, height: 10, borderRadius: 3 },
  teamRowName: { flex: 1, color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  teamRowDivision: { color: '#64748b', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginRight: 8 },
  currentText: { color: '#38bdf8' },
  currentBadge: { fontSize: 10, color: '#38bdf8', fontWeight: '900', backgroundColor: '#0ea5e930', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  closeBtn: { margin: 16, backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  closeText: { color: '#64748b', fontWeight: '900', fontSize: 15 },
});

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSecondaryKitColor, getTeamTheme } from '@/src/constants/teamColors';
import { Team } from '@/src/models/types';
import { ModalSheet, Button } from '@/components/ui';
import { color } from '@/src/design/tokens';

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
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Change Team"
      variant="sheet"
      footer={<Button title="Cancel" variant="secondary" onPress={onClose} fullWidth />}
    >
      {teams.map((team) => {
        const theme = getTeamTheme(team.name);
        const isCurrent = team.id === currentTeamId;

        return (
          <TouchableOpacity
            key={team.id}
            style={[styles.teamRow, isCurrent && styles.teamRowActive]}
            onPress={() => onSelect(team.id)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${team.name}`}
          >
            <View style={[styles.kitChip, { backgroundColor: theme.primary }]} />
            <View style={[styles.kitChip, { backgroundColor: getSecondaryKitColor(theme.secondary) }]} />
            <Text style={[styles.teamRowName, isCurrent && styles.currentText]}>{team.name}</Text>
            <Text style={styles.teamRowDivision}>{team.division}</Text>
            {isCurrent && <Text style={styles.currentBadge}>CURRENT</Text>}
          </TouchableOpacity>
        );
      })}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  teamRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  teamRowActive: { backgroundColor: color.accent.dim },
  kitChip: { width: 10, height: 10, borderRadius: 0 },
  teamRowName: { flex: 1, color: color.text.secondary, fontSize: 16, fontWeight: '700' },
  teamRowDivision: { color: color.text.faint, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginRight: 8 },
  currentText: { color: color.accent.primary },
  currentBadge: {
    fontSize: 10,
    color: color.accent.primary,
    fontWeight: '900',
    backgroundColor: color.accent.dim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 0,
  },
});

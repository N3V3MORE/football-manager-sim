import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Player, PlayerRole } from '@/src/models/types';
import { Slot } from '@/src/constants/formations';
import { getPositionColor } from '@/src/constants/positionColors';
import { PlayerPickerRow } from '@/components/squad/player-picker-row';
import { ModalSheet } from '@/components/ui';
import { color, space } from '@/src/design/tokens';

type PickerSections = {
  recommended: Player[];
  alternatives: Player[];
};

type PlayerPickerModalProps = {
  visible: boolean;
  slot: Slot | null;
  sections: PickerSections | null;
  roleOptions?: { label: string; value: PlayerRole; description: string }[];
  selectedRole?: PlayerRole;
  onRoleSelect?: (role: PlayerRole) => void;
  onClose: () => void;
  onPick: (playerId: string) => void;
};

export function PlayerPickerModal({
  visible,
  slot,
  sections,
  roleOptions = [],
  selectedRole = 'default',
  onRoleSelect,
  onClose,
  onPick,
}: PlayerPickerModalProps) {
  const selectedRoleDescription = roleOptions.find(option => option.value === selectedRole)?.description;

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={slot ? `${slot.label} - Select Player` : 'Select Player'}
      variant="sheet"
    >
      <View style={[styles.modalPosPill, { backgroundColor: getPositionColor(slot?.pos || 'MID') }]}>
        <Text style={styles.modalPosText}>{slot?.label || '?'}</Text>
      </View>

      {roleOptions.length > 0 && onRoleSelect && (
        <View style={styles.roleSection}>
          <Text style={styles.pickerSection}>Role</Text>
          <View style={styles.roleOptions}>
            {roleOptions.map(option => {
              const active = option.value === selectedRole;
              return (
                <TouchableOpacity
                  key={option.value}
                  accessibilityHint={option.description}
                  style={[styles.roleButton, active && styles.roleButtonActive]}
                  onPress={() => onRoleSelect(option.value)}
                >
                  <Text style={[styles.roleButtonText, active && styles.roleButtonTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {selectedRoleDescription && (
            <Text style={styles.roleDescription}>{selectedRoleDescription}</Text>
          )}
        </View>
      )}

      {sections && (
        <>
          <Text style={styles.pickerSection}>Recommended for {slot?.label}</Text>
          {sections.recommended.length === 0
            ? <Text style={styles.emptyNote}>No exact match - see alternatives below</Text>
            : sections.recommended.map((player) => (
              <PlayerPickerRow key={player.id} item={player} onPress={() => onPick(player.id)} />
            ))}

          {sections.alternatives.length > 0 && (
            <>
              <Text style={styles.pickerSection}>Other {slot?.pos}s</Text>
              {sections.alternatives.map((player) => (
                <PlayerPickerRow key={player.id} item={player} onPress={() => onPick(player.id)} />
              ))}
            </>
          )}
        </>
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  modalPosPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 0, minWidth: 36, alignItems: 'center', alignSelf: 'flex-start', marginBottom: space.sm },
  modalPosText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  pickerSection: {
    fontSize: 11,
    fontWeight: '900',
    color: color.text.faint,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingTop: space.md,
    paddingBottom: 6,
  },
  roleSection: { marginBottom: space.sm },
  roleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roleButton: {
    minHeight: 32,
    borderWidth: 1,
    borderColor: color.border.default,
    paddingHorizontal: 9,
    justifyContent: 'center',
    backgroundColor: color.bg.card,
  },
  roleButtonActive: {
    backgroundColor: color.accent.primary,
    borderColor: color.accent.primary,
  },
  roleButtonText: { color: color.text.muted, fontSize: 11, fontWeight: '900' },
  roleButtonTextActive: { color: color.accent.onPrimary },
  roleDescription: { color: color.text.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  emptyNote: { fontSize: 11, color: color.text.faint, fontStyle: 'italic', paddingLeft: 4, marginBottom: 4 },
});

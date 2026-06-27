import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Player } from '@/src/models/types';
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
  onClose: () => void;
  onPick: (playerId: string) => void;
};

export function PlayerPickerModal({
  visible,
  slot,
  sections,
  onClose,
  onPick,
}: PlayerPickerModalProps) {
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
  emptyNote: { fontSize: 11, color: color.text.faint, fontStyle: 'italic', paddingLeft: 4, marginBottom: 4 },
});

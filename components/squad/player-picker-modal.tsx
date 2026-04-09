import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Player } from '@/src/models/types';
import { Slot } from '@/src/constants/formations';
import { getPositionColor } from '@/src/constants/positionColors';
import { PlayerPickerRow } from '@/components/squad/player-picker-row';

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <View style={[styles.modalPosPill, { backgroundColor: getPositionColor(slot?.pos || 'MID') }]}>
              <Text style={styles.modalPosText}>{slot?.label || '?'}</Text>
            </View>
            <Text style={styles.pickerTitle}>{slot?.label} - Select Player</Text>
            <TouchableOpacity onPress={onClose} style={styles.pickerClose}>
              <Text style={styles.modalCloseText}>X</Text>
            </TouchableOpacity>
          </View>

          <ScrollView>
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
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: 40 },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#334155', gap: 10 },
  pickerTitle: { flex: 1, fontSize: 15, fontWeight: '900', color: '#f8fafc' },
  pickerClose: { padding: 6 },
  pickerSection: { fontSize: 11, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  emptyNote: { fontSize: 11, color: '#475569', fontStyle: 'italic', paddingLeft: 4, marginBottom: 4 },
  modalPosPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, minWidth: 36, alignItems: 'center' },
  modalPosText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  modalCloseText: { color: '#94a3b8', fontSize: 18, fontWeight: '900' },
});

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Formation } from '@/src/models/types';

type FormationSelectionModalProps = {
  visible: boolean;
  formations: Formation[];
  selectedFormation: string;
  onClose: () => void;
  onSelect: (formation: Formation) => void;
};

export function FormationSelectionModal({
  visible,
  formations,
  selectedFormation,
  onClose,
  onSelect,
}: FormationSelectionModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.dropdownModal}>
          <Text style={styles.dropdownModalTitle}>Choose Formation</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {formations.map((formation) => {
              const isSelected = selectedFormation === formation;

              return (
                <View key={formation}>
                  <TouchableOpacity
                    style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                    onPress={() => onSelect(formation)}
                  >
                    <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]}>
                      {formation}
                    </Text>
                    {isSelected && <Text style={styles.activeCheck}>Selected</Text>}
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 40 },
  dropdownModal: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' },
  dropdownModalTitle: { fontSize: 14, fontWeight: '900', color: '#64748b', textAlign: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#334155', textTransform: 'uppercase', letterSpacing: 1 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  dropdownItemActive: { backgroundColor: '#0f172a' },
  dropdownItemText: { flex: 1, color: '#cbd5e1', fontSize: 16, fontWeight: '700' },
  dropdownItemTextActive: { color: '#38bdf8' },
  activeCheck: { color: '#10B981', fontWeight: '900', fontSize: 16 },
});

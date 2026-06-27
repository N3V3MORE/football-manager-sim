import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Formation } from '@/src/models/types';
import { ModalSheet } from '@/components/ui';
import { color, space } from '@/src/design/tokens';

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
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Choose Formation"
      variant="dialog"
    >
      {formations.map((formation) => {
        const isSelected = selectedFormation === formation;
        return (
          <TouchableOpacity
            key={formation}
            style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
            onPress={() => onSelect(formation)}
            accessibilityRole="button"
            accessibilityLabel={`Formation ${formation}`}
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]}>
              {formation}
            </Text>
            {isSelected && <Text style={styles.activeCheck}>Selected</Text>}
          </TouchableOpacity>
        );
      })}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle,
  },
  dropdownItemActive: { backgroundColor: color.bg.screen },
  dropdownItemText: { flex: 1, color: color.text.secondary, fontSize: 16, fontWeight: '700' },
  dropdownItemTextActive: { color: color.accent.primary },
  activeCheck: { color: color.success.base, fontWeight: '900', fontSize: 16 },
});

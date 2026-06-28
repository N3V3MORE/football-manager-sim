import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { color } from '@/src/design/tokens';

type TacticSectionProps = {
  title: string;
  selectedOption: string;
  options: string[];
  descriptions: Record<string, string>;
  onSelect: (option: string) => void;
};

export function TacticSection({
  title,
  selectedOption,
  options,
  descriptions,
  onSelect,
}: TacticSectionProps) {
  return (
    <View style={styles.tacticsSection}>
      <Text style={styles.tacticsSectionTitle}>{title}</Text>
      <View style={styles.tacticsOptionsRow}>
        {options.map((option) => {
          const isActive = selectedOption === option;

          return (
            <TouchableOpacity
              key={option}
              style={[styles.tacticsOptBtn, isActive && styles.tacticsOptBtnActive]}
              onPress={() => onSelect(option)}
            >
              <Text style={[styles.tacticsOptText, isActive && styles.tacticsOptTextActive]}>{option}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.tacticsHintText}>{descriptions[selectedOption]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tacticsSection: { gap: 10 },
  tacticsSectionTitle: { color: color.text.muted, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  tacticsOptionsRow: { flexDirection: 'row', backgroundColor: color.bg.card, borderRadius: 0, padding: 4, borderWidth: 1, borderColor: color.border.default },
  tacticsOptBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 0 },
  tacticsOptBtnActive: { backgroundColor: color.accent.primary },
  tacticsOptText: { color: color.text.muted, fontSize: 13, fontWeight: '800' },
  tacticsOptTextActive: { color: color.accent.onPrimary },
  tacticsHintText: { color: color.text.disabled, fontSize: 11, fontStyle: 'italic', paddingHorizontal: 4, lineHeight: 16 },
});

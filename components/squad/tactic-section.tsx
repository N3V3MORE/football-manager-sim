import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type TacticSectionProps = {
  title: string;
  selectedOption: string;
  options: string[];
  descriptions: Record<string, string>;
  onSelect: (option: string) => void;
};

export default React.memo(function TacticSection({
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
);

const styles = StyleSheet.create({
  tacticsSection: { gap: 10 },
  tacticsSectionTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  tacticsOptionsRow: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 0, padding: 4, borderWidth: 1, borderColor: '#334155' },
  tacticsOptBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 0 },
  tacticsOptBtnActive: { backgroundColor: '#38bdf8' },
  tacticsOptText: { color: '#94a3b8', fontSize: 13, fontWeight: '800' },
  tacticsOptTextActive: { color: '#0f172a' },
  tacticsHintText: { color: '#475569', fontSize: 11, fontStyle: 'italic', paddingHorizontal: 4, lineHeight: 16 },
});

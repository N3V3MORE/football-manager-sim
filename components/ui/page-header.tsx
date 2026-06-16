import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '@/constants/colors';

type PageHeaderProps = {
  title: string;
  backLabel: string;
  onBack: () => void;
  subtitle?: string;
};

const PageHeader = React.memo(function PageHeader({ title, backLabel, onBack, subtitle }: PageHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={styles.backText}>{backLabel}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={styles.spacer} />
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
});

export { PageHeader };

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: {
    width: 52,
    paddingVertical: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: Colors.bgSurface,
    backgroundColor: Colors.bgCard,
  },
  backText: { color: Colors.textLight, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 24, fontWeight: '900', color: Colors.text },
  spacer: { width: 52 },
  subtitle: { color: Colors.textDim, fontSize: 11, marginTop: 2 },
});

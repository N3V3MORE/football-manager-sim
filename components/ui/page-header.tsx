import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type PageHeaderProps = {
  title: string;
  backLabel: string;
  onBack: () => void;
  subtitle?: string;
};

export function PageHeader({ title, backLabel, onBack, subtitle }: PageHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backText}>{backLabel}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={styles.spacer} />
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: {
    width: 52,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  backText: { color: '#cbd5e1', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 24, fontWeight: '900', color: '#f8fafc' },
  spacer: { width: 52 },
  subtitle: { color: '#64748b', fontSize: 11, marginTop: 2 },
});

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
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.85}>
          <Text style={styles.backText}>{backLabel}</Text>
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.spacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: {
    minWidth: 68,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
  },
  backText: { color: '#cbd5e1', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  titleBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center', fontSize: 24, fontWeight: '900', color: '#f8fafc' },
  spacer: { minWidth: 68 },
  subtitle: { color: '#64748b', fontSize: 11, marginTop: 4, fontWeight: '700', textAlign: 'center' },
});

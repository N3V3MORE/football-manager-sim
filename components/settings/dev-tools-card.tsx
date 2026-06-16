import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';


type DevToolsCardProps = {
  onAdvanceFiveWeeks: () => void;
  onSkipSeason: () => void;
  onResetSeason: () => void;
};

export default React.memo(function DevToolsCard({
  onAdvanceFiveWeeks,
  onSkipSeason,
  onResetSeason,
}: DevToolsCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Dev Tools</Text>
      <Text style={styles.note}>Temporary controls live here until proper settings are added.</Text>
      <Text style={styles.note}>LLM bridge: call {"globalThis.__FM_AGENT__.run('summary')"} from the dev JS runtime.</Text>
      <TouchableOpacity style={[styles.devBtn, styles.warningBtn]} onPress={onAdvanceFiveWeeks}>
        <Text style={[styles.devBtnText, styles.warningText]}>+5 Weeks</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.devBtn, styles.warningBtn]} onPress={onSkipSeason}>
        <Text style={[styles.devBtnText, styles.warningText]}>Skip Season</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.devBtn, styles.dangerBtn]} onPress={onResetSeason}>
        <Text style={[styles.devBtnText, styles.dangerText]}>Reset Season</Text>
      </TouchableOpacity>
    </View>
  );
}
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#e2e8f0', marginBottom: 10 },
  note: { color: '#64748b', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8 },
  devBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 0,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  devBtnText: { color: '#94a3b8', fontSize: 12, fontWeight: '900' },
  warningBtn: { borderColor: '#F59E0B' },
  warningText: { color: '#F59E0B' },
  dangerBtn: { borderColor: '#ef4444' },
  dangerText: { color: '#ef4444' },
});

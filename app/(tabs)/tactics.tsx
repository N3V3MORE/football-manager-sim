import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { TeamTactics } from '@/src/models/types';
import { TACTIC_SECTIONS } from '@/constants/tactics';

export default function TacticsScreen() {
  const userTeamId = useGameStore(s => s.userTeamId);
  const teams = useGameStore(s => s.teams);
  const setTactics = useGameStore(s => s.setTactics);

  if (!userTeamId) return <View style={styles.container} />;
  const team = teams[userTeamId];
  const tactics = team?.tactics;

  if (!tactics) {
    return (
        <SafeAreaView style={styles.container}>
            <Text style={{color: '#fff', padding: 20}}>Loading tactics...</Text>
        </SafeAreaView>
    );
  }

  const renderSection = (
    title: string,
    key: keyof TeamTactics,
    options: string[],
    descriptions: Record<string, string>
  ) => {
    const selectedOption = tactics[key] as string;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.optionsRow}>
          {options.map(opt => {
            const isActive = selectedOption === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.optBtn, isActive && styles.optBtnActive]}
                onPress={() => setTactics(userTeamId, { [key]: opt } as Partial<TeamTactics>)}
              >
                <Text style={[styles.optText, isActive && styles.optTextActive]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.hintText}>{descriptions[selectedOption]}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Tactics Board</Text>
        <Text style={styles.subtitle}>Set your team&apos;s match instructions</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {TACTIC_SECTIONS.map((section) => (
          renderSection(section.title, section.key, section.options, section.descriptions)
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderColor: '#334155' },
  title: { fontSize: 24, fontWeight: '900', color: '#f8fafc' },
  subtitle: { color: '#64748b', fontSize: 13, marginTop: 2, fontWeight: '600' },
  scroll: { padding: 16, gap: 24, paddingBottom: 40 },
  section: { gap: 10 },
  sectionTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  optionsRow: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 0, padding: 4, borderWidth: 1, borderColor: '#334155' },
  optBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 0 },
  optBtnActive: { backgroundColor: '#38bdf8' },
  optText: { color: '#94a3b8', fontSize: 13, fontWeight: '800' },
  optTextActive: { color: '#0f172a' },
  hintText: { color: '#475569', fontSize: 11, fontStyle: 'italic', paddingHorizontal: 4, lineHeight: 16 },
});

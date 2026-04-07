import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getTeamTheme } from '@/src/constants/teamColors';
import { useGameStore } from '@/src/store/gameStore';
import { sortTeamsByDivisionAndName } from '@/src/core/leagueUtils';

export default function SettingsScreen() {
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const advanceWeek = useGameStore(state => state.advanceWeek);
  const skipToEndOfSeason = useGameStore(state => state.skipToEndOfSeason);
  const changeTeam = useGameStore(state => state.changeTeam);
  const initializeGame = useGameStore(state => state.initializeGame);
  const [showChangeTeam, setShowChangeTeam] = useState(false);

  const userTeam = userTeamId ? teams[userTeamId] : null;
  const manager = userTeam?.manager;

  const handleResetSeason = () => {
    if (!userTeamId) return;
    initializeGame(userTeamId);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Game settings and developer tools</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current Team</Text>
          <Text style={styles.teamName}>{userTeam?.name || 'No team selected'}</Text>
          {userTeam && <Text style={styles.teamDivision}>{userTeam.division}</Text>}
          {manager && (
            <View style={styles.managerBlock}>
              <Text style={styles.managerLabel}>Manager</Text>
              <Text style={styles.managerName}>{manager.name}</Text>
              <Text style={styles.managerMeta}>
                {manager.nationality} | Rep {manager.reputation}% | Fit {manager.clubFit}%
              </Text>
              <Text style={styles.managerMeta}>{manager.tacticalIdentity}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowChangeTeam(true)}>
            <Text style={styles.primaryBtnText}>Change Team</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dev Tools</Text>
          <Text style={styles.note}>Temporary controls live here until proper settings are added.</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.devBtn} onPress={advanceWeek}>
              <Text style={styles.devBtnText}>Next Week</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.devBtn, styles.warningBtn]}
              onPress={() => {
                advanceWeek(); advanceWeek(); advanceWeek(); advanceWeek(); advanceWeek();
              }}
            >
              <Text style={[styles.devBtnText, styles.warningText]}>+5 Weeks</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.devBtn, styles.warningBtn]} onPress={skipToEndOfSeason}>
            <Text style={[styles.devBtnText, styles.warningText]}>Skip Season</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.devBtn, styles.dangerBtn]} onPress={handleResetSeason}>
            <Text style={[styles.devBtnText, styles.dangerText]}>Reset Season</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={showChangeTeam} transparent animationType="slide" onRequestClose={() => setShowChangeTeam(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Change Team</Text>
            <ScrollView>
              {sortTeamsByDivisionAndName(Object.values(teams)).map(team => {
                const theme = getTeamTheme(team.name);
                const isCurrent = team.id === userTeamId;
                return (
                  <TouchableOpacity
                    key={team.id}
                    style={[styles.teamRow, isCurrent && styles.teamRowActive]}
                    onPress={() => {
                      changeTeam(team.id);
                      setShowChangeTeam(false);
                    }}
                    >
                      <View style={[styles.kitChip, { backgroundColor: theme.primary }]} />
                      <View style={[styles.kitChip, { backgroundColor: theme.secondary === '#FFFFFF' ? '#e2e8f0' : theme.secondary }]} />
                      <Text style={[styles.teamRowName, isCurrent && styles.currentText]}>{team.name}</Text>
                      <Text style={styles.teamRowDivision}>{team.division}</Text>
                      {isCurrent && <Text style={styles.currentBadge}>CURRENT</Text>}
                    </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowChangeTeam(false)}>
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '900', color: '#f8fafc' },
  subtitle: { color: '#64748b', fontSize: 13, marginTop: 2, fontWeight: '600' },
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#e2e8f0', marginBottom: 10 },
  teamName: { fontSize: 18, fontWeight: '900', color: '#38bdf8', marginBottom: 12 },
  teamDivision: { color: '#94a3b8', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 12 },
  managerBlock: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginBottom: 12,
  },
  managerLabel: { color: '#64748b', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  managerName: { color: '#f8fafc', fontSize: 16, fontWeight: '900', marginTop: 4 },
  managerMeta: { color: '#94a3b8', fontSize: 12, marginTop: 4, lineHeight: 17 },
  note: { color: '#64748b', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8 },
  primaryBtn: { backgroundColor: '#38bdf8', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#0f172a', fontWeight: '900' },
  devBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  devBtnText: { color: '#94a3b8', fontSize: 12, fontWeight: '900' },
  warningBtn: { borderColor: '#F59E0B' },
  warningText: { color: '#F59E0B' },
  dangerBtn: { borderColor: '#ef4444' },
  dangerText: { color: '#ef4444' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', paddingBottom: 30 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#f8fafc', textAlign: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  teamRow: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b', flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamRowActive: { backgroundColor: '#0ea5e915' },
  kitChip: { width: 10, height: 10, borderRadius: 3 },
  teamRowName: { flex: 1, color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  teamRowDivision: { color: '#64748b', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginRight: 8 },
  currentText: { color: '#38bdf8' },
  currentBadge: { fontSize: 10, color: '#38bdf8', fontWeight: '900', backgroundColor: '#0ea5e930', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  closeBtn: { margin: 16, backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  closeText: { color: '#64748b', fontWeight: '900', fontSize: 15 },
});

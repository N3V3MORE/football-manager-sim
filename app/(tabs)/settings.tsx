import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDisplayKitColor, getDisplaySecondaryColor, getTeamTheme } from '@/src/constants/teamColors';
import { useGameStore } from '@/src/store/gameStore';
import { getLeagueDisplayName } from '@/src/core/domainRegistry';
import { sortTeamsForSettings } from '@/src/features/world/worldSelectors';

export default function SettingsScreen() {
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const advanceWeek = useGameStore(state => state.advanceWeek);
  const advanceMultipleWeeks = useGameStore(state => state.advanceMultipleWeeks);
  const skipToEndOfSeason = useGameStore(state => state.skipToEndOfSeason);
  const isSeasonSkipInProgress = useGameStore(state => state.isSeasonSkipInProgress);
  const changeTeam = useGameStore(state => state.changeTeam);
  const initializeGame = useGameStore(state => state.initializeGame);
  const currentWeek = useGameStore(state => state.currentWeek);
  const season = useGameStore(state => state.season);
  const [showChangeTeam, setShowChangeTeam] = useState(false);

  const userTeam = userTeamId ? teams[userTeamId] : null;
  const manager = userTeam?.manager;
  const theme = userTeam ? getTeamTheme(userTeam.name) : null;
  const primaryColor = theme ? getDisplayKitColor(theme.primary) : '#38bdf8';
  const secondaryColor = theme ? getDisplaySecondaryColor(theme.secondary) : '#64748b';
  const approvalTone =
    (userTeam?.boardApproval || 0) >= 65 ? '#34d399' :
    (userTeam?.boardApproval || 0) < 30 ? '#f87171' :
    '#f59e0b';

  const handleResetSeason = () => {
    if (!userTeamId) return;
    initializeGame(userTeamId);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Club Desk</Text>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Club overview, team switching, and simulation controls.</Text>
        </View>

        <View style={[styles.card, styles.teamCard, { borderColor: `${primaryColor}55` }]}>
          <View style={styles.teamCardTop}>
            <View style={styles.teamIdentity}>
              <View style={styles.teamStrip}>
                <View style={[styles.teamStripBlock, { backgroundColor: primaryColor }]} />
                <View style={[styles.teamStripBlock, { backgroundColor: secondaryColor }]} />
              </View>
              <View style={styles.teamIdentityText}>
                <Text style={styles.cardTitle}>Current Team</Text>
                <Text style={styles.teamName}>{userTeam?.name || 'No team selected'}</Text>
                {userTeam && <Text style={styles.teamDivision}>{getLeagueDisplayName(userTeam.leagueId)}</Text>}
              </View>
            </View>
            {userTeam && (
              <View style={[styles.approvalBadge, { borderColor: `${approvalTone}55`, backgroundColor: `${approvalTone}15` }]}>
                <Text style={[styles.approvalValue, { color: approvalTone }]}>{Math.round(userTeam.boardApproval)}%</Text>
                <Text style={styles.approvalLabel}>Approval</Text>
              </View>
            )}
          </View>

          {userTeam && (
            <View style={styles.teamStatRow}>
              <View style={styles.teamStatCard}>
                <Text style={styles.teamStatLabel}>Budget</Text>
                <Text style={styles.teamStatValue}>GBP {userTeam.budget.toFixed(1)}m</Text>
              </View>
              <View style={styles.teamStatCard}>
                <Text style={styles.teamStatLabel}>Formation</Text>
                <Text style={styles.teamStatValue}>{userTeam.activeFormation}</Text>
              </View>
              <View style={styles.teamStatCard}>
                <Text style={styles.teamStatLabel}>Season</Text>
                <Text style={styles.teamStatValue}>S{season} / W{currentWeek}</Text>
              </View>
            </View>
          )}

          {manager && (
            <View style={styles.managerBlock}>
              <View style={styles.managerHeader}>
                <View>
                  <Text style={styles.managerLabel}>Manager Profile</Text>
                  <Text style={styles.managerName}>{manager.name}</Text>
                </View>
                <View style={styles.managerStatusPill}>
                  <Text style={styles.managerStatusText}>{manager.status}</Text>
                </View>
              </View>
              <Text style={styles.managerMeta}>
                {manager.nationality} | Contract {manager.contractUntil || 'TBD'}
              </Text>
              <View style={styles.managerMetricRow}>
                <View style={styles.managerMetricCard}>
                  <Text style={styles.managerMetricLabel}>Reputation</Text>
                  <Text style={styles.managerMetricValue}>{manager.reputation}%</Text>
                </View>
                <View style={styles.managerMetricCard}>
                  <Text style={styles.managerMetricLabel}>Board Trust</Text>
                  <Text style={styles.managerMetricValue}>{manager.boardTrust}%</Text>
                </View>
                <View style={styles.managerMetricCard}>
                  <Text style={styles.managerMetricLabel}>Club Fit</Text>
                  <Text style={styles.managerMetricValue}>{manager.clubFit}%</Text>
                </View>
              </View>
            </View>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowChangeTeam(true)}>
            <Text style={styles.primaryBtnText}>Change Team</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.eyebrow}>Simulation</Text>
          <Text style={styles.cardTitle}>Dev Tools</Text>
          <Text style={styles.note}>Fast controls for testing progression, season turnover, and club switching.</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.devBtn} onPress={advanceWeek}>
              <Text style={styles.devBtnText}>Next Week</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.devBtn, styles.warningBtn]}
              onPress={() => advanceMultipleWeeks(5)}
            >
              <Text style={[styles.devBtnText, styles.warningText]}>+5 Weeks</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.devBtn, styles.warningBtn, isSeasonSkipInProgress && styles.disabledBtn]}
            onPress={skipToEndOfSeason}
            disabled={isSeasonSkipInProgress}
          >
            <Text style={[styles.devBtnText, styles.warningText, isSeasonSkipInProgress && styles.disabledText]}>
              {isSeasonSkipInProgress ? 'Skipping...' : 'Skip Season'}
            </Text>
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
            <Text style={styles.sheetSubtitle}>Switch control to any club in the current world.</Text>
            <ScrollView contentContainerStyle={styles.sheetScroll}>
              {sortTeamsForSettings(teams).map(team => {
                const teamTheme = getTeamTheme(team.name);
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
                    <View style={styles.teamRowIdentity}>
                      <View style={styles.teamRowStrip}>
                        <View style={[styles.kitChip, { backgroundColor: getDisplayKitColor(teamTheme.primary) }]} />
                        <View style={[styles.kitChip, { backgroundColor: getDisplaySecondaryColor(teamTheme.secondary) }]} />
                      </View>
                      <View style={styles.teamRowTextBlock}>
                        <Text style={[styles.teamRowName, isCurrent && styles.currentText]}>{team.name}</Text>
                        <Text style={styles.teamRowDivision}>{getLeagueDisplayName(team.leagueId)}</Text>
                      </View>
                    </View>
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
  eyebrow: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    marginBottom: 6,
  },
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
  teamCard: { backgroundColor: '#101826' },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#e2e8f0', marginBottom: 10 },
  teamCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  teamIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  teamIdentityText: { flex: 1 },
  teamStrip: { width: 14, height: 56, borderRadius: 7, overflow: 'hidden', backgroundColor: '#0f172a' },
  teamStripBlock: { flex: 1 },
  teamName: { fontSize: 22, fontWeight: '900', color: '#f8fafc', marginBottom: 6 },
  teamDivision: { color: '#94a3b8', fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  approvalBadge: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 88,
    alignItems: 'center',
  },
  approvalValue: { fontSize: 20, fontWeight: '900' },
  approvalLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 2 },
  teamStatRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  teamStatCard: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  teamStatLabel: { color: '#64748b', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 4 },
  teamStatValue: { color: '#f8fafc', fontSize: 13, fontWeight: '800' },
  managerBlock: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginTop: 14,
    marginBottom: 12,
  },
  managerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  managerLabel: { color: '#64748b', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  managerName: { color: '#f8fafc', fontSize: 16, fontWeight: '900', marginTop: 4 },
  managerStatusPill: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  managerStatusText: { color: '#cbd5e1', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  managerMeta: { color: '#94a3b8', fontSize: 12, marginTop: 8, lineHeight: 17 },
  managerMetricRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  managerMetricCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  managerMetricLabel: { color: '#64748b', fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  managerMetricValue: { color: '#f8fafc', fontSize: 14, fontWeight: '900', marginTop: 4 },
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
  disabledBtn: { borderColor: '#475569' },
  disabledText: { color: '#94a3b8' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '78%', paddingBottom: 24 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#f8fafc', textAlign: 'center', paddingTop: 20 },
  sheetSubtitle: { color: '#64748b', fontSize: 12, textAlign: 'center', marginTop: 6, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  sheetScroll: { paddingBottom: 8 },
  teamRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  teamRowActive: { backgroundColor: '#0ea5e915' },
  teamRowIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  teamRowStrip: { width: 12, gap: 4, alignItems: 'center' },
  kitChip: { width: 10, height: 10, borderRadius: 3 },
  teamRowTextBlock: { flex: 1 },
  teamRowName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  teamRowDivision: { color: '#64748b', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 4 },
  currentText: { color: '#38bdf8' },
  currentBadge: { fontSize: 10, color: '#38bdf8', fontWeight: '900', backgroundColor: '#0ea5e930', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  closeBtn: { margin: 16, backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  closeText: { color: '#64748b', fontWeight: '900', fontSize: 15 },
});

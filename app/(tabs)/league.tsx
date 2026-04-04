import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { useGameStore } from '@/src/store/gameStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getTeamTheme } from '@/src/constants/teamColors';
import { useState } from 'react';
import { Team } from '@/src/models/types';

export default function LeagueTableScreen() {
  const teams = useGameStore(state => state.teams);
  const players = useGameStore(state => state.players);
  const userTeamId = useGameStore(state => state.userTeamId);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  const sortedTeams = Object.values(teams).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const diffA = a.goalsFor - a.goalsAgainst;
    const diffB = b.goalsFor - b.goalsAgainst;
    return diffB - diffA;
  });

  const getLastLineup = (team: Team) => {
    if (!team.lastStartingXI || team.lastStartingXI.length === 0) return null;
    return team.lastStartingXI.map(id => players[id]).filter(Boolean);
  };

  const getPosColor = (pos: string) => {
    switch (pos) {
      case 'GK': return '#F59E0B';
      case 'DEF': return '#3B82F6';
      case 'MID': return '#10B981';
      case 'FWD': return '#EF4444';
      default: return '#6B7280';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.title}>League Table</Text>
          <Text style={styles.subtitle}>Tap a team to view their last lineup</Text>
        </View>

        <View style={styles.table}>
          {/* Header Row */}
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.pos]}>#</Text>
            <Text style={[styles.cell, styles.name]}>Club</Text>
            <Text style={[styles.cell, styles.stat]}>P</Text>
            <Text style={[styles.cell, styles.stat]}>W</Text>
            <Text style={[styles.cell, styles.stat]}>D</Text>
            <Text style={[styles.cell, styles.stat]}>L</Text>
            <Text style={[styles.cell, styles.stat]}>GF</Text>
            <Text style={[styles.cell, styles.stat]}>GA</Text>
            <Text style={[styles.cell, styles.stat]}>GD</Text>
            <Text style={[styles.cell, styles.stat, styles.pts]}>Pts</Text>
          </View>

          {sortedTeams.map((team, index) => {
            const isUser = team.id === userTeamId;
            const gd = team.goalsFor - team.goalsAgainst;
            const theme = getTeamTheme(team.name);

            return (
              <TouchableOpacity key={team.id} style={[styles.row, isUser && styles.userRow]} onPress={() => setSelectedTeam(team)}>
                <Text style={[styles.cell, styles.pos, isUser && styles.userText]}>{index + 1}</Text>
                <View style={styles.nameCell}>
                  {/* Dual kit strip */}
                  <View style={styles.kitStrip}>
                    <View style={[styles.kitBlock, { backgroundColor: theme.primary }]} />
                    <View style={[styles.kitBlock, { backgroundColor: theme.secondary === '#FFFFFF' ? '#e2e8f0' : theme.secondary }]} />
                  </View>
                  <Text style={[styles.cell, styles.name, isUser && styles.userText]} numberOfLines={1}>{team.name}</Text>
                </View>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.played}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.wins}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.draws}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.losses}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.goalsFor}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.goalsAgainst}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{gd > 0 ? `+${gd}` : gd}</Text>
                <Text style={[styles.cell, styles.stat, styles.pts, isUser && styles.userText]}>{team.points}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Last Lineup Modal */}
      <Modal
        visible={selectedTeam !== null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedTeam(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selectedTeam && (() => {
              const theme = getTeamTheme(selectedTeam.name);
              const lineup = getLastLineup(selectedTeam);
              const subPlayers = Object.values(players).filter(p => p.teamId === selectedTeam.id && !p.isStarting && p.isSub);
              return (
                <>
                  <View style={styles.modalHeader}>
                    <View style={styles.modalKitStrip}>
                      <View style={[styles.modalKitBlock, { backgroundColor: theme.primary }]} />
                      <View style={[styles.modalKitBlock, { backgroundColor: theme.secondary === '#FFFFFF' ? '#e2e8f0' : theme.secondary }]} />
                    </View>
                    <Text style={styles.modalTitle}>{selectedTeam.name}</Text>
                    <Text style={styles.modalSubtitle}>{theme.stadium}</Text>
                    <TouchableOpacity style={styles.modalClose} onPress={() => setSelectedTeam(null)}>
                      <Text style={styles.modalCloseText}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView>
                    {lineup ? (
                      <>
                        <Text style={styles.modalSectionTitle}>Last Starting XI</Text>
                        {lineup.map(p => (
                          <View key={p.id} style={styles.modalPlayerRow}>
                            <View style={[styles.modalPosPill, { backgroundColor: getPosColor(p.position) }]}>
                              <Text style={styles.modalPosText}>{p.subPosition || p.position}</Text>
                            </View>
                            <Text style={styles.modalPlayerName}>{p.name}</Text>
                            <Text style={styles.modalPlayerRating}>{p.overallRating}</Text>
                          </View>
                        ))}
                        {subPlayers.length > 0 && (
                          <>
                            <Text style={styles.modalSectionTitle}>Substitutes</Text>
                            {subPlayers.map(p => (
                              <View key={p.id} style={styles.modalPlayerRow}>
                                <View style={[styles.modalPosPill, { backgroundColor: getPosColor(p.position) }]}>
                                  <Text style={styles.modalPosText}>{p.subPosition || p.position}</Text>
                                </View>
                                <Text style={[styles.modalPlayerName, { color: '#94a3b8' }]}>{p.name}</Text>
                                <Text style={styles.modalPlayerRating}>{p.overallRating}</Text>
                              </View>
                            ))}
                          </>
                        )}
                      </>
                    ) : (
                      <View style={styles.noLineupBox}>
                        <Text style={styles.noLineupText}>No match played yet this season</Text>
                      </View>
                    )}
                  </ScrollView>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  title: { fontSize: 26, fontWeight: '900', color: '#f8fafc' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  table: {
    backgroundColor: '#1e293b',
    margin: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  headerRow: { backgroundColor: '#0f172a' },
  userRow: { backgroundColor: '#0ea5e920' },
  cell: { fontSize: 12, color: '#cbd5e1' },
  nameCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pos: { width: 22, textAlign: 'center', fontWeight: '900', color: '#94a3b8' },
  name: { flex: 1, fontWeight: '700', fontSize: 11 },
  stat: { width: 26, textAlign: 'center', fontWeight: '600' },
  pts: { width: 30, fontWeight: '900', color: '#f8fafc' },
  userText: { color: '#38bdf8', fontWeight: '900' },
  kitStrip: {
    flexDirection: 'row',
    width: 14,
    height: 14,
    borderRadius: 2,
    overflow: 'hidden',
    marginRight: 5,
  },
  kitBlock: { flex: 1 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    alignItems: 'center',
  },
  modalKitStrip: {
    flexDirection: 'row',
    width: 40,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  modalKitBlock: { flex: 1 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#f8fafc' },
  modalSubtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  modalClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
  },
  modalCloseText: { color: '#94a3b8', fontSize: 18, fontWeight: '900' },
  modalSectionTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  modalPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalPosPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    marginRight: 12,
    minWidth: 36,
    alignItems: 'center',
  },
  modalPosText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  modalPlayerName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#f1f5f9' },
  modalPlayerRating: {
    fontSize: 14,
    fontWeight: '900',
    color: '#38bdf8',
    width: 32,
    textAlign: 'right',
  },
  noLineupBox: { padding: 40, alignItems: 'center' },
  noLineupText: { color: '#64748b', fontStyle: 'italic', textAlign: 'center' },
});

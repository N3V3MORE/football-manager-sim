import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { useRouter } from 'expo-router';
import { getTeamColor, getTeamTheme } from '@/src/constants/teamColors';

export default function HubScreen() {
  const router = useRouter();
  const currentWeek = useGameStore(state => state.currentWeek);
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const fixtures = useGameStore(state => state.fixtures);
  const advanceWeek = useGameStore(state => state.advanceWeek);
  const news = useGameStore(state => state.news);
  const skipToEndOfSeason = useGameStore(state => state.skipToEndOfSeason);
  const changeTeam = useGameStore(state => state.changeTeam);

  const [showDevOptions, setShowDevOptions] = useState(false);
  const [showChangeTeam, setShowChangeTeam] = useState(false);

  const myTeam = userTeamId ? teams[userTeamId] : null;

  // Find next match
  const weekFixtures = Object.values(fixtures).filter(f => f.week === currentWeek);
  const myNextMatch = weekFixtures.find(f => f.homeTeamId === userTeamId || f.awayTeamId === userTeamId);

  const getOpponent = () => {
    if (!myNextMatch || !userTeamId) return null;
    const oppId = myNextMatch.homeTeamId === userTeamId ? myNextMatch.awayTeamId : myNextMatch.homeTeamId;
    return teams[oppId];
  };

  const opponent = getOpponent();

  const handlePlayMatch = () => {
    // If there is no match for the user this week, just advance
    if (!myNextMatch) {
      advanceWeek();
    } else {
      router.push({ pathname: '/match', params: { fixtureId: myNextMatch.id } });
    }
  };

  if (!myTeam) return <View style={styles.container}><Text>Loading...</Text></View>;

  // Mini-Table logic
  const sortedTeams = Object.values(teams).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const diffA = a.goalsFor - a.goalsAgainst;
    const diffB = b.goalsFor - b.goalsAgainst;
    return diffB - diffA;
  });

  const myIndex = sortedTeams.findIndex(t => t.id === userTeamId);
  
  // Try to get 3 above and 3 below. If near bounds, adjust.
  let startIdx = Math.max(0, myIndex - 3);
  let endIdx = Math.min(sortedTeams.length - 1, myIndex + 3);
  
  if (myIndex < 3) {
      endIdx = Math.min(sortedTeams.length - 1, 6);
  } else if (myIndex > sortedTeams.length - 4) {
      startIdx = Math.max(0, sortedTeams.length - 7);
  }
  
  const miniTable = sortedTeams.slice(startIdx, endIdx + 1).map(t => ({
      ...t,
      position: sortedTeams.findIndex(st => st.id === t.id) + 1
  }));

  const renderFormToken = (result: string, idx: number) => {
    let bgColor = '#64748b'; // Default Grey for Draw or unknown
    if (result === 'W') bgColor = '#10B981'; // Green
    if (result === 'L') bgColor = '#EF4444'; // Red
    
    return (
      <View key={idx} style={[styles.formToken, { backgroundColor: bgColor }]}>
        <Text style={styles.formTokenText}>{result}</Text>
      </View>
    );
  };

  const allPlayers = Object.values(useGameStore(state => state.players));
  const topScorer = [...allPlayers].filter(p => p.goals > 0).sort((a,b) => b.goals - a.goals)[0];
  const topAssister = [...allPlayers].filter(p => p.assists > 0).sort((a,b) => b.assists - a.assists)[0];
  const topCS = [...allPlayers].filter(p => (p.cleanSheets || 0) > 0).sort((a,b) => (b.cleanSheets || 0) - (a.cleanSheets || 0))[0];

  const myTheme = getTeamTheme(myTeam.name);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView>
      <View style={styles.header}>
        <View style={styles.kitStrip}>
            <View style={[styles.kitBlock, { backgroundColor: myTheme.primary }]} />
            <View style={[styles.kitBlock, { backgroundColor: myTheme.secondary === '#FFFFFF' ? '#e2e8f0' : myTheme.secondary }]} />
        </View>
        <Text style={styles.teamName}>{myTeam.name}</Text>
        <Text style={styles.subtitle}>{myTheme.stadium} · Est. {myTheme.founded}</Text>
        <Text style={styles.weekText}>Manager Hub  •  Week {currentWeek}</Text>
        {/* Dev toggle */}
        <TouchableOpacity style={styles.devResetButton} onPress={() => setShowDevOptions(!showDevOptions)}>
          <Text style={styles.devResetText}>⚙ Dev</Text>
        </TouchableOpacity>
      </View>

      {/* Dev Options Panel */}
      {showDevOptions && (
        <View style={styles.devPanel}>
          <Text style={styles.devPanelTitle}>DEV OPTIONS</Text>
          <View style={styles.devRow}>
            <TouchableOpacity style={styles.devBtn} onPress={() => { useGameStore.setState({ userTeamId: null, teams: {}, players: {}, fixtures: {} }); setShowDevOptions(false); }}>
              <Text style={styles.devBtnText}>🗑 Reset Season</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.devBtn} onPress={() => setShowChangeTeam(true)}>
              <Text style={styles.devBtnText}>🔄 Change Team</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.devBtn, { borderColor: '#F59E0B' }]} onPress={() => { skipToEndOfSeason(); setShowDevOptions(false); }}>
              <Text style={[styles.devBtnText, { color: '#F59E0B' }]}>⏭ Skip Season</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: '#ef4444' }]}>BREAKING NEWS</Text>
          {news && news.length > 0 ? (
              news.slice(0, 3).map((n, idx) => (
                  <View key={idx} style={styles.newsItem}>
                      <Text style={styles.newsTextFeatured}>• {n}</Text>
                  </View>
              ))
          ) : (
              <Text style={styles.newsTextFeatured}>No news yet. Advance the week to see updates!</Text>
          )}
      </View>

      <View style={styles.heroMatchLayout}>
          <TouchableOpacity style={styles.heroMatchCard} onPress={handlePlayMatch}>
              <Text style={styles.heroMatchTitle}>NEXT FIXTURE</Text>
              {opponent ? (
                <View style={styles.heroMatchupInfo}>
                    <Text style={styles.heroMatchVs}>VS</Text>
                    <Text style={[styles.heroMatchOpponent, { color: getTeamColor(opponent.name) }]}>{opponent.name}</Text>
                    <Text style={styles.heroMatchVenue}>{myNextMatch?.homeTeamId === userTeamId ? 'Playing At Home' : 'Playing Away'}</Text>
                </View>
              ) : (
                <Text style={styles.matchupSubtext}>Season is over or Bye Week.</Text>
              )}
          </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.card} onPress={() => router.push('/league')}>
          <Text style={styles.cardTitle}>Mini Table</Text>
          {miniTable.map((team) => {
             const t = getTeamTheme(team.name);
             return (
               <View key={team.id} style={[styles.miniRow, team.id === userTeamId && styles.miniRowUser]}>
                   <Text style={[styles.miniPos, team.id === userTeamId && styles.miniTextUser]}>{team.position}.</Text>
                   <View style={styles.miniKitStrip}>
                       <View style={[styles.miniKitBlock, { backgroundColor: t.primary }]} />
                       <View style={[styles.miniKitBlock, { backgroundColor: t.secondary === '#FFFFFF' ? '#e2e8f0' : t.secondary }]} />
                   </View>
                   <Text style={[styles.miniName, team.id === userTeamId && styles.miniTextUser]} numberOfLines={1}>{team.name}</Text>
                   <Text style={[styles.miniStat, team.id === userTeamId && styles.miniTextUser]}>{team.goalsFor - team.goalsAgainst}</Text>
                   <Text style={[styles.miniStat, styles.miniPts, team.id === userTeamId && styles.miniTextUser]}>{team.points}</Text>
               </View>
             );
          })}
          <Text style={styles.smallTapText}>Tap to view full table</Text>
      </TouchableOpacity>

      <View style={styles.rowLayout}>
        <TouchableOpacity style={styles.halfCard} onPress={() => router.push('/stats')}>
            <Text style={styles.cardTitle}>Season Stats</Text>
            <View style={styles.statLeaderRow}>
                <Text style={styles.statLeaderEmoji}>⚽</Text>
                <View style={styles.statLeaderInfo}>
                    <Text style={styles.statLeaderName}>{topScorer ? topScorer.name : '—'}</Text>
                    <Text style={styles.statLeaderNum}>{topScorer ? `${topScorer.goals} goals` : 'No goals yet'}</Text>
                </View>
            </View>
            <View style={styles.statLeaderRow}>
                <Text style={styles.statLeaderEmoji}>🅰️</Text>
                <View style={styles.statLeaderInfo}>
                    <Text style={styles.statLeaderName}>{topAssister ? topAssister.name : '—'}</Text>
                    <Text style={styles.statLeaderNum}>{topAssister ? `${topAssister.assists} assists` : 'No assists yet'}</Text>
                </View>
            </View>
            <View style={styles.statLeaderRow}>
                <Text style={styles.statLeaderEmoji}>🧤</Text>
                <View style={styles.statLeaderInfo}>
                    <Text style={styles.statLeaderName}>{topCS ? topCS.name : '—'}</Text>
                    <Text style={styles.statLeaderNum}>{topCS ? `${topCS.cleanSheets} clean sheets` : 'None yet'}</Text>
                </View>
            </View>
            <Text style={styles.smallTapText}>Tap for full stats</Text>
        </TouchableOpacity>

        <View style={styles.halfCard}>
            <Text style={styles.cardTitle}>Recent Form</Text>
            <View style={styles.formRow}>
                {myTeam.form && myTeam.form.length > 0 ? (
                    myTeam.form.map((res, i) => renderFormToken(res, i))
                ) : (
                    <Text style={styles.formEmpty}>No matches.</Text>
                )}
            </View>
        </View>
      </View>

      <View style={styles.rowLayout}>
        <View style={styles.tournamentSquare}><Text style={styles.tournText}>Carabao Cup</Text><Text style={styles.tournSub}>TBD</Text></View>
        <View style={styles.tournamentSquare}><Text style={styles.tournText}>FA Cup</Text><Text style={styles.tournSub}>TBD</Text></View>
        <View style={styles.tournamentSquare}><Text style={styles.tournText}>Champions Lge</Text><Text style={styles.tournSub}>TBD</Text></View>
      </View>


        <View style={{height: 40}} />
      </ScrollView>

      {/* Change Team Modal */}
      <Modal visible={showChangeTeam} transparent animationType="slide" onRequestClose={() => setShowChangeTeam(false)}>
        <View style={styles.ctOverlay}>
          <View style={styles.ctSheet}>
            <Text style={styles.ctTitle}>Change Team</Text>
            <ScrollView>
              {Object.values(teams).sort((a,b) => a.name.localeCompare(b.name)).map(t => (
                <TouchableOpacity key={t.id} style={[styles.ctRow, t.id === userTeamId && styles.ctRowActive]}
                  onPress={() => { changeTeam(t.id); setShowChangeTeam(false); setShowDevOptions(false); }}>
                  <Text style={[styles.ctTeamName, t.id === userTeamId && { color: '#38bdf8' }]}>{t.name}</Text>
                  {t.id === userTeamId && <Text style={styles.ctCurrent}>CURRENT</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.ctClose} onPress={() => setShowChangeTeam(false)}>
              <Text style={styles.ctCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    padding: 20,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    alignItems: 'center',
  },
  teamName: {
    fontSize: 28,
    fontWeight: '900',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginTop: 4,
    fontWeight: '600',
  },
  devResetButton: {
    position: 'absolute',
    top: 20,
    right: 20,
  },
  devResetText: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 'bold',
  },
  newsItem: {
      marginBottom: 8,
  },
  newsTextFeatured: {
      fontSize: 16,
      color: '#f8fafc',
      lineHeight: 24,
      fontWeight: '800',
  },
  smallTapText: {
      fontSize: 11,
      color: '#38bdf8',
      fontWeight: '700',
      marginTop: 8,
      textAlign: 'center',
  },
  tournamentSquare: {
      flex: 1,
      aspectRatio: 1,
      backgroundColor: '#1e293b',
      marginHorizontal: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#334155',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 8,
  },
  tournText: {
      color: '#cbd5e1',
      fontSize: 12,
      fontWeight: '800',
      textAlign: 'center',
  },
  tournSub: {
      color: '#64748b',
      fontSize: 10,
      fontWeight: '800',
      marginTop: 4,
  },
  rowLayout: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginTop: 16,
  },
  halfCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    marginHorizontal: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: '#1e293b',
    margin: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
    color: '#e2e8f0',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#f8fafc',
  },
  heroMatchLayout: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  heroMatchCard: {
    backgroundColor: '#0ea5e920', // tinted bright
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#38bdf850',
    alignItems: 'center',
  },
  heroMatchTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#38bdf8',
    letterSpacing: 2,
    marginBottom: 16,
  },
  heroMatchupInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  heroMatchVs: {
    fontSize: 16,
    fontWeight: '900',
    color: '#94a3b8',
    marginBottom: 4,
  },
  heroMatchOpponent: {
    fontSize: 28,
    fontWeight: '900',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroMatchVenue: {
    fontSize: 14,
    color: '#cbd5e1',
    fontWeight: '600',
  },
  matchupSubtext: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '600',
    marginBottom: 16,
  },
  formRow: {
    flexDirection: 'row',
    gap: 4,
  },
  formToken: {
    width: 24,
    height: 24,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  formTokenText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 12,
  },
  formEmpty: {
    color: '#64748b',
    fontStyle: 'italic',
    fontSize: 12,
  },
  playButton: {
    backgroundColor: '#38bdf8',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  playButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
  },
  miniRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  miniRowUser: {
      backgroundColor: '#0ea5e920',
  },
  miniPos: {
      width: 24,
      fontWeight: 'bold',
      color: '#94a3b8',
  },
  miniName: {
      flex: 1,
      color: '#cbd5e1',
      fontWeight: '600',
  },
  miniTextUser: {
      color: '#38bdf8',
      fontWeight: '900',
  },
  miniStat: {
      width: 30,
      textAlign: 'center',
      color: '#94a3b8',
      fontWeight: '600',
  },
  miniPts: {
      fontWeight: '900',
      color: '#f8fafc',
  },
  kitStrip: {
      flexDirection: 'row',
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
      width: 60,
      marginBottom: 8,
  },
  kitBlock: {
      flex: 1,
  },
  weekText: {
      fontSize: 13,
      color: '#64748b',
      marginTop: 6,
      fontWeight: '600',
  },
  miniKitStrip: {
      flexDirection: 'row',
      width: 18,
      height: 14,
      borderRadius: 2,
      overflow: 'hidden',
      marginRight: 6,
      alignSelf: 'center',
  },
  miniKitBlock: {
      flex: 1,
  },
  statLeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
  },
  statLeaderEmoji: {
      fontSize: 16,
      marginRight: 8,
      width: 24,
  },
  statLeaderInfo: {
      flex: 1,
  },
  statLeaderName: {
      fontSize: 13,
      fontWeight: '800',
      color: '#f8fafc',
  },
  statLeaderNum: {
      fontSize: 11,
      color: '#94a3b8',
      fontWeight: '600',
  },
  devPanel: {
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  devPanelTitle: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  devRow: { flexDirection: 'row', gap: 8 },
  devBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#ef4444',
    alignItems: 'center',
  },
  devBtnText: { color: '#ef4444', fontSize: 11, fontWeight: '900' },
  ctOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  ctSheet: { backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', paddingBottom: 30 },
  ctTitle: { fontSize: 18, fontWeight: '900', color: '#f8fafc', textAlign: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155' },
  ctRow: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#334155', flexDirection: 'row', alignItems: 'center' },
  ctRowActive: { backgroundColor: '#0ea5e920' },
  ctTeamName: { flex: 1, color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  ctCurrent: { fontSize: 10, color: '#38bdf8', fontWeight: '900', backgroundColor: '#0ea5e930', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  ctClose: { margin: 16, backgroundColor: '#334155', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  ctCloseText: { color: '#94a3b8', fontWeight: '900', fontSize: 15 },
});


import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { useRouter } from 'expo-router';
import { getTeamTheme } from '@/src/constants/teamColors';

// Week 1 = Aug 10 2024. Each week adds 7 days.
const SEASON_START = new Date(2024, 7, 10);
const weekToDate = (week: number): string => {
  const d = new Date(SEASON_START);
  d.setDate(d.getDate() + (week - 1) * 7);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

// Dual-color team name badge component
const TeamColorBadge = ({ name, isUser }: { name: string; isUser: boolean }) => {
  const theme = getTeamTheme(name);
  return (
    <View style={badge.row}>
      <View style={[badge.chip, { backgroundColor: theme.primary }]} />
      <View style={[badge.chip, { backgroundColor: theme.secondary === '#FFFFFF' ? '#e2e8f0' : theme.secondary }]} />
      <Text style={[badge.name, isUser && { color: '#38bdf8', fontWeight: '900' }]} numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
};

const badge = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  chip: { width: 10, height: 10, borderRadius: 3 },
  name: { fontSize: 14, fontWeight: '800', color: '#f8fafc' },
});

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
  const players = useGameStore(state => state.players);

  const [showDevOptions, setShowDevOptions] = useState(false);
  const [showChangeTeam, setShowChangeTeam] = useState(false);

  const myTeam = userTeamId ? teams[userTeamId] : null;

  // Find next match
  const weekFixtures = Object.values(fixtures).filter(f => f.week === currentWeek);
  const myNextMatch = weekFixtures.find(f => f.homeTeamId === userTeamId || f.awayTeamId === userTeamId);

  const homeTeamId = myNextMatch?.homeTeamId;
  const awayTeamId = myNextMatch?.awayTeamId;
  const homeTeam = homeTeamId ? teams[homeTeamId] : null;
  const awayTeam = awayTeamId ? teams[awayTeamId] : null;
  const homeTheme = homeTeam ? getTeamTheme(homeTeam.name) : null;

  const handlePlayMatch = () => {
    if (!myNextMatch) {
      advanceWeek();
    } else {
      router.push({ pathname: '/match', params: { fixtureId: myNextMatch.id } });
    }
  };

  const handleDevReset = () => {
    if (!userTeamId) return;
    const teamName = myTeam?.name;
    // Re-init fresh game with same team
    const allTeamNames = Object.values(teams).map(t => t.name);
    const matchedTeam = allTeamNames.find(n => n === teamName);
    if (matchedTeam) {
      // Reinitialize using store action
      useGameStore.getState().initializeGame(userTeamId);
    }
    setShowDevOptions(false);
  };

  if (!myTeam) return <View style={styles.container}><Text style={{ color: '#fff', margin: 20 }}>Loading...</Text></View>;

  const myTheme = getTeamTheme(myTeam.name);

  // Mini-Table logic
  const sortedTeams = Object.values(teams).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const diffA = a.goalsFor - a.goalsAgainst;
    const diffB = b.goalsFor - b.goalsAgainst;
    return diffB - diffA;
  });

  const myIndex = sortedTeams.findIndex(t => t.id === userTeamId);
  let startIdx = Math.max(0, myIndex - 3);
  let endIdx = Math.min(sortedTeams.length - 1, myIndex + 3);
  if (myIndex < 3) endIdx = Math.min(sortedTeams.length - 1, 6);
  else if (myIndex > sortedTeams.length - 4) startIdx = Math.max(0, sortedTeams.length - 7);

  const miniTable = sortedTeams.slice(startIdx, endIdx + 1).map(t => ({
    ...t,
    position: sortedTeams.findIndex(st => st.id === t.id) + 1,
  }));

  // Upcoming fixtures for calendar pane (next 5 weeks)
  const upcomingFixtures = [];
  for (let w = currentWeek; w <= Math.min(currentWeek + 4, 38); w++) {
    const match = Object.values(fixtures).find(
      f => f.week === w && (f.homeTeamId === userTeamId || f.awayTeamId === userTeamId)
    );
    upcomingFixtures.push({ week: w, match });
  }

  const allPlayers = Object.values(players);
  const topScorer = [...allPlayers].filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals)[0];
  const topAssister = [...allPlayers].filter(p => p.assists > 0).sort((a, b) => b.assists - a.assists)[0];
  const topCS = [...allPlayers].filter(p => (p.cleanSheets || 0) > 0).sort((a, b) => (b.cleanSheets || 0) - (a.cleanSheets || 0))[0];

  const myPosition = myIndex + 1;
  const myRecord = `${myTeam.wins}W ${myTeam.draws}D ${myTeam.losses}L`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* ── Header ── */}
        <View style={[styles.header, { borderBottomColor: myTheme.primary + '60' }]}>
          {/* Team identity top row */}
          <View style={styles.headerTop}>
            <View style={styles.kitStrip}>
              <View style={[styles.kitBlock, { backgroundColor: myTheme.primary }]} />
              <View style={[styles.kitBlock, { backgroundColor: myTheme.secondary === '#FFFFFF' ? '#e2e8f0' : myTheme.secondary }]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.teamName, { color: myTheme.primary !== '#FFFFFF' ? myTheme.primary : '#f8fafc' }]}>
                {myTeam.name}
              </Text>
              <Text style={styles.subtitle}>{myTheme.stadium} · Est. {myTheme.founded}</Text>
            </View>
            <TouchableOpacity style={styles.devResetButton} onPress={() => setShowDevOptions(!showDevOptions)}>
              <Text style={styles.devResetText}>⚙ DEV</Text>
            </TouchableOpacity>
          </View>

          {/* Stat chips */}
          <View style={styles.statChipRow}>
            <View style={styles.statChip}>
              <Text style={styles.statChipVal}>#{myPosition}</Text>
              <Text style={styles.statChipLabel}>Position</Text>
            </View>
            <View style={styles.statChipDivider} />
            <View style={styles.statChip}>
              <Text style={styles.statChipVal}>{myTeam.points}</Text>
              <Text style={styles.statChipLabel}>Points</Text>
            </View>
            <View style={styles.statChipDivider} />
            <View style={styles.statChip}>
              <Text style={styles.statChipVal}>{myRecord}</Text>
              <Text style={styles.statChipLabel}>Record</Text>
            </View>
            <View style={styles.statChipDivider} />
            <View style={styles.statChip}>
              <Text style={styles.statChipVal}>Wk {currentWeek}</Text>
              <Text style={styles.statChipLabel}>{weekToDate(currentWeek)}</Text>
            </View>
          </View>
        </View>

        {/* ── Dev Options Panel ── */}
        {showDevOptions && (
          <View style={styles.devPanel}>
            <Text style={styles.devPanelTitle}>🛠 DEV TOOLS</Text>
            <View style={styles.devRow}>
              <TouchableOpacity style={styles.devBtn} onPress={() => { advanceWeek(); setShowDevOptions(false); }}>
                <Text style={styles.devBtnText}>▶ Next Week</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.devBtn, { borderColor: '#F59E0B' }]} onPress={() => {
                advanceWeek(); advanceWeek(); advanceWeek(); advanceWeek(); advanceWeek();
                setShowDevOptions(false);
              }}>
                <Text style={[styles.devBtnText, { color: '#F59E0B' }]}>⏩ +5 Weeks</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.devRow, { marginTop: 6 }]}>
              <TouchableOpacity style={[styles.devBtn, { borderColor: '#F59E0B' }]} onPress={() => { skipToEndOfSeason(); setShowDevOptions(false); }}>
                <Text style={[styles.devBtnText, { color: '#F59E0B' }]}>⏭ Skip Season</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.devBtn} onPress={() => setShowChangeTeam(true)}>
                <Text style={styles.devBtnText}>🔄 Change Team</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.devBtn, { marginTop: 6, borderColor: '#ef4444' }]} onPress={handleDevReset}>
              <Text style={[styles.devBtnText, { color: '#ef4444' }]}>⚠ Reset Season</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Breaking News ── */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: '#ef4444' }]}>📰 LATEST</Text>
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

        {/* ── Next Fixture Hero Card ── */}
        <TouchableOpacity style={styles.heroMatchCard} onPress={handlePlayMatch} activeOpacity={0.85}>
          <Text style={styles.heroMatchTitle}>NEXT FIXTURE</Text>
          {homeTeam && awayTeam ? (
            <>
              <Text style={styles.heroStadium}>{homeTheme?.stadium || 'TBD'}  ·  {weekToDate(currentWeek)}</Text>
              <View style={styles.matchupRow}>
                {/* Home team */}
                <View style={styles.matchupTeam}>
                  <TeamColorBadge name={homeTeam.name} isUser={homeTeam.id === userTeamId} />
                  <View style={[styles.haTag, { backgroundColor: '#1a3a4a' }]}>
                    <Text style={[styles.haTagText, { color: '#38bdf8' }]}>HOME</Text>
                  </View>
                </View>

                <View style={styles.matchupVsBlock}>
                  <Text style={styles.matchupVs}>VS</Text>
                </View>

                {/* Away team */}
                <View style={[styles.matchupTeam, { alignItems: 'flex-end' }]}>
                  <TeamColorBadge name={awayTeam.name} isUser={awayTeam.id === userTeamId} />
                  <View style={[styles.haTag, { backgroundColor: '#2a1a1a' }]}>
                    <Text style={[styles.haTagText, { color: '#f87171' }]}>AWAY</Text>
                  </View>
                </View>
              </View>
              <View style={styles.playBtnRow}>
                <Text style={styles.heroPlayBtn}>▶  TAP TO PLAY MATCH</Text>
              </View>
            </>
          ) : (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <Text style={styles.matchupSubtext}>No fixture this week.</Text>
              <Text style={styles.heroPlayBtn}>▶  TAP TO ADVANCE WEEK</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Upcoming Fixtures ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Upcoming Fixtures</Text>
          {upcomingFixtures.map(({ week, match }) => {
            const oppId = match
              ? (match.homeTeamId === userTeamId ? match.awayTeamId : match.homeTeamId)
              : null;
            const opp = oppId ? teams[oppId] : null;
            const isHome = match?.homeTeamId === userTeamId;
            const isCurrentWeek = week === currentWeek;
            const oppTheme = opp ? getTeamTheme(opp.name) : null;
            return (
              <View key={week} style={[styles.calRow, isCurrentWeek && styles.calRowCurrent]}>
                <View style={styles.calDateBlock}>
                  <Text style={[styles.calWeek, isCurrentWeek && { color: '#38bdf8' }]}>Wk {week}</Text>
                  <Text style={styles.calDate}>{weekToDate(week)}</Text>
                </View>
                {opp && oppTheme ? (
                  <View style={styles.calMatchBlock}>
                    <View style={[styles.calHABadge, isHome ? styles.calHAHome : styles.calHAAway]}>
                      <Text style={styles.calHAText}>{isHome ? 'H' : 'A'}</Text>
                    </View>
                    <View style={[styles.calKitChip, { backgroundColor: oppTheme.primary }]} />
                    <View style={[styles.calKitChip, { backgroundColor: oppTheme.secondary === '#FFFFFF' ? '#e2e8f0' : oppTheme.secondary }]} />
                    <Text style={styles.calOpp} numberOfLines={1}>{opp.name}</Text>
                    {match && match.isPlayed && (
                      <Text style={styles.calScore}>
                        {isHome ? `${match.homeScore}–${match.awayScore}` : `${match.awayScore}–${match.homeScore}`}
                      </Text>
                    )}
                  </View>
                ) : (
                  <Text style={styles.calBye}>Rest week</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* ── Mini Table ── */}
        <TouchableOpacity style={styles.card} onPress={() => router.push('/league')}>
          <Text style={styles.cardTitle}>League Table</Text>
          {miniTable.map((team) => {
            const t = getTeamTheme(team.name);
            const isMe = team.id === userTeamId;
            return (
              <View key={team.id} style={[styles.miniRow, isMe && styles.miniRowUser]}>
                <Text style={[styles.miniPos, isMe && styles.miniTextUser]}>{team.position}.</Text>
                <View style={styles.miniKitStrip}>
                  <View style={[styles.miniKitBlock, { backgroundColor: t.primary }]} />
                  <View style={[styles.miniKitBlock, { backgroundColor: t.secondary === '#FFFFFF' ? '#e2e8f0' : t.secondary }]} />
                </View>
                <Text style={[styles.miniName, isMe && styles.miniTextUser]} numberOfLines={1}>{team.name}</Text>
                <Text style={[styles.miniStat, isMe && styles.miniTextUser]}>{team.goalsFor - team.goalsAgainst > 0 ? '+' : ''}{team.goalsFor - team.goalsAgainst}</Text>
                <Text style={[styles.miniStat, styles.miniPts, isMe && styles.miniTextUser]}>{team.points}</Text>
              </View>
            );
          })}
          <Text style={styles.smallTapText}>Tap to view full table ›</Text>
        </TouchableOpacity>

        {/* ── Season Stats ── */}
        <TouchableOpacity style={styles.card} onPress={() => router.push('/stats')}>
          <Text style={styles.cardTitle}>Season Stats</Text>
          {[
            { label: '⚽ Top Scorer', player: topScorer, stat: topScorer ? `${topScorer.goals} goals` : 'None yet' },
            { label: '🅰️ Top Assister', player: topAssister, stat: topAssister ? `${topAssister.assists} assists` : 'None yet' },
            { label: '🧤 Clean Sheets', player: topCS, stat: topCS ? `${topCS.cleanSheets} clean sheets` : 'None yet' },
          ].map(({ label, player, stat }) => (
            <View key={label} style={styles.statLeaderRow}>
              <Text style={styles.statLeaderLabel}>{label}</Text>
              <View style={styles.statLeaderInfo}>
                <Text style={styles.statLeaderName}>{player ? player.name : '—'}</Text>
                <Text style={styles.statLeaderNum}>{stat}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.smallTapText}>Tap for full stats ›</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Change Team Modal ── */}
      <Modal visible={showChangeTeam} transparent animationType="slide" onRequestClose={() => setShowChangeTeam(false)}>
        <View style={styles.ctOverlay}>
          <View style={styles.ctSheet}>
            <Text style={styles.ctTitle}>Change Team</Text>
            <ScrollView>
              {Object.values(teams).sort((a, b) => a.name.localeCompare(b.name)).map(t => {
                const th = getTeamTheme(t.name);
                return (
                  <TouchableOpacity key={t.id} style={[styles.ctRow, t.id === userTeamId && styles.ctRowActive]}
                    onPress={() => { changeTeam(t.id); setShowChangeTeam(false); setShowDevOptions(false); }}>
                    <View style={[styles.ctKitChip, { backgroundColor: th.primary }]} />
                    <View style={[styles.ctKitChip, { backgroundColor: th.secondary === '#FFFFFF' ? '#e2e8f0' : th.secondary }]} />
                    <Text style={[styles.ctTeamName, t.id === userTeamId && { color: '#38bdf8' }]}>{t.name}</Text>
                    {t.id === userTeamId && <Text style={styles.ctCurrent}>CURRENT</Text>}
                  </TouchableOpacity>
                );
              })}
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
  container: { flex: 1, backgroundColor: '#0a0f1e' },

  // ── Header
  header: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    backgroundColor: '#111827',
    borderBottomWidth: 2,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  kitStrip: { flexDirection: 'column', width: 8, height: 44, borderRadius: 4, overflow: 'hidden' },
  kitBlock: { flex: 1 },
  teamName: { fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2, fontWeight: '600' },
  devResetButton: { padding: 8, backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  devResetText: { color: '#64748b', fontSize: 10, fontWeight: '900' },

  // Stat chips
  statChipRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 10, padding: 10 },
  statChip: { flex: 1, alignItems: 'center' },
  statChipVal: { fontSize: 14, fontWeight: '900', color: '#f8fafc' },
  statChipLabel: { fontSize: 9, color: '#64748b', fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  statChipDivider: { width: 1, height: 28, backgroundColor: '#1e293b' },

  // ── Cards
  card: {
    backgroundColor: '#111827', marginHorizontal: 14, marginTop: 14,
    padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#1e293b',
  },
  cardTitle: { fontSize: 16, fontWeight: '900', marginBottom: 12, color: '#e2e8f0', letterSpacing: 0.5 },
  newsItem: { marginBottom: 8 },
  newsTextFeatured: { fontSize: 14, color: '#cbd5e1', lineHeight: 22, fontWeight: '600' },
  smallTapText: { fontSize: 11, color: '#38bdf8', fontWeight: '700', marginTop: 10, textAlign: 'right' },

  // ── Hero match card
  heroMatchCard: {
    backgroundColor: '#111827',
    marginHorizontal: 14, marginTop: 14,
    padding: 20, borderRadius: 14,
    borderWidth: 1, borderColor: '#1e3a5f',
    shadowColor: '#38bdf8', shadowOpacity: 0.08, shadowRadius: 10, elevation: 4,
  },
  heroMatchTitle: { fontSize: 10, fontWeight: '900', color: '#38bdf8', letterSpacing: 2.5, marginBottom: 4 },
  heroStadium: { fontSize: 12, color: '#64748b', fontWeight: '600', marginBottom: 16 },
  matchupRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  matchupTeam: { flex: 1, gap: 6 },
  haTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, alignSelf: 'flex-start' },
  haTagText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  matchupVsBlock: { paddingHorizontal: 16, alignItems: 'center' },
  matchupVs: { fontSize: 22, fontWeight: '900', color: '#334155' },
  matchupSubtext: { fontSize: 14, color: '#64748b', marginBottom: 8 },
  playBtnRow: { borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 12, alignItems: 'center' },
  heroPlayBtn: { fontSize: 11, fontWeight: '900', color: '#38bdf8', letterSpacing: 1.5 },

  // ── Upcoming fixtures
  calRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  calRowCurrent: { backgroundColor: '#0ea5e910' },
  calDateBlock: { width: 60 },
  calWeek: { fontSize: 10, fontWeight: '900', color: '#64748b', textTransform: 'uppercase' },
  calDate: { fontSize: 12, color: '#475569', fontWeight: '600', marginTop: 2 },
  calMatchBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  calHABadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  calHAHome: { backgroundColor: '#1a3a4a' },
  calHAAway: { backgroundColor: '#2a1a1a' },
  calHAText: { color: '#94a3b8', fontSize: 9, fontWeight: '900' },
  calKitChip: { width: 8, height: 8, borderRadius: 2 },
  calOpp: { flex: 1, fontSize: 13, fontWeight: '700', color: '#e2e8f0' },
  calScore: { fontSize: 13, fontWeight: '900', color: '#38bdf8' },
  calBye: { flex: 1, fontSize: 12, color: '#334155', fontStyle: 'italic' },

  // ── Mini table
  miniRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  miniRowUser: { backgroundColor: '#0ea5e915', borderRadius: 6 },
  miniPos: { width: 24, fontWeight: '700', color: '#64748b', fontSize: 13 },
  miniKitStrip: { flexDirection: 'row', width: 16, height: 16, borderRadius: 3, overflow: 'hidden', marginRight: 8 },
  miniKitBlock: { flex: 1 },
  miniName: { flex: 1, color: '#cbd5e1', fontWeight: '600', fontSize: 13 },
  miniTextUser: { color: '#38bdf8', fontWeight: '900' },
  miniStat: { width: 32, textAlign: 'center', color: '#64748b', fontWeight: '600', fontSize: 12 },
  miniPts: { fontWeight: '900', color: '#f8fafc', fontSize: 13 },

  // ── Season stats
  statLeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  statLeaderLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', width: 100 },
  statLeaderInfo: { flex: 1 },
  statLeaderName: { fontSize: 13, fontWeight: '800', color: '#f8fafc' },
  statLeaderNum: { fontSize: 11, color: '#64748b', fontWeight: '600' },

  // ── Dev
  devPanel: {
    backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1e293b',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  devPanelTitle: { fontSize: 10, color: '#64748b', fontWeight: '900', letterSpacing: 1.5, marginBottom: 10, textTransform: 'uppercase' },
  devRow: { flexDirection: 'row', gap: 8 },
  devBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  devBtnText: { color: '#94a3b8', fontSize: 11, fontWeight: '900' },

  // ── Change team modal
  ctOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  ctSheet: { backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%', paddingBottom: 30 },
  ctTitle: { fontSize: 18, fontWeight: '900', color: '#f8fafc', textAlign: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  ctRow: { paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b', flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctRowActive: { backgroundColor: '#0ea5e915' },
  ctKitChip: { width: 10, height: 10, borderRadius: 3 },
  ctTeamName: { flex: 1, color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  ctCurrent: { fontSize: 10, color: '#38bdf8', fontWeight: '900', backgroundColor: '#0ea5e930', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  ctClose: { margin: 16, backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  ctCloseText: { color: '#64748b', fontWeight: '900', fontSize: 15 },
});

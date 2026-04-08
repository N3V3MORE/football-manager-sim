import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { useRouter } from 'expo-router';
import {
  getDisplayKitColor,
  getDisplaySecondaryColor,
  getReadableTeamTextColor,
  getTeamTheme,
} from '@/src/constants/teamColors';
import { getFixtureCompetitionLabel } from '@/src/core/competitionUtils';
import { TeamColorBadge } from '@/src/features/hub/components/TeamColorBadge';
import {
  getCupPaneStatus,
  getDivisionSeasonLeaders,
  getLatestNewsForDivision,
  getMiniTableWindow,
  getTeamPosition,
  getUpcomingFixtures,
  weekToDate,
} from '@/src/features/hub/hubSelectors';

export default function HubScreen() {
  const router = useRouter();
  const currentWeek = useGameStore(state => state.currentWeek);
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const fixtures = useGameStore(state => state.fixtures);
  const cups = useGameStore(state => state.cups);
  const advanceWeek = useGameStore(state => state.advanceWeek);
  const news = useGameStore(state => state.news);
  const players = useGameStore(state => state.players);

  const myTeam = userTeamId ? teams[userTeamId] : null;
  const myDivision = myTeam?.division ?? 'Premier League';

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

  if (!myTeam) return <View style={styles.container}><Text style={{ color: '#fff', margin: 20 }}>Loading...</Text></View>;

  const myTheme = getTeamTheme(myTeam.name);
  const activeUserTeamId = userTeamId || '';
  const myDivisionTeams = Object.values(teams).filter(team => team.division === myDivision);
  const myDivisionTeamIds = new Set(myDivisionTeams.map(team => team.id));
  const myDivisionPlayers = Object.values(players).filter(player => myDivisionTeamIds.has(player.teamId));

  const carabaoPane = getCupPaneStatus({
    competition: 'Carabao Cup',
    fixtures,
    cups,
    activeUserTeamId,
    teams,
  });
  const faPane = getCupPaneStatus({
    competition: 'FA Cup',
    fixtures,
    cups,
    activeUserTeamId,
    teams,
  });
  const newsItems = (news || []);
  const latestNews = getLatestNewsForDivision(newsItems, myDivisionTeams);
  const miniTable = getMiniTableWindow(myDivisionTeams, userTeamId);
  const upcomingFixtures = getUpcomingFixtures(fixtures, currentWeek, userTeamId);
  const {
    topScorer,
    topAssister,
    topCleanSheetGKs,
  } = getDivisionSeasonLeaders(myDivisionPlayers);

  const myPosition = getTeamPosition(myDivisionTeams, userTeamId);
  const myRecord = `${myTeam.wins}W ${myTeam.draws}D ${myTeam.losses}L`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: myTheme.primary + '60' }]}>
          {/* Team identity top row */}
          <View style={styles.headerTop}>
            <View style={styles.kitStrip}>
              <View style={[styles.kitBlock, { backgroundColor: getDisplayKitColor(myTheme.primary) }]} />
              <View style={[styles.kitBlock, { backgroundColor: getDisplaySecondaryColor(myTheme.secondary) }]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.teamName, { color: myTheme.primary !== '#FFFFFF' ? getReadableTeamTextColor(myTheme.primary) : '#f8fafc' }]}>
                {myTeam.name}
              </Text>
              <Text style={styles.subtitle}>{myTheme.stadium} | Est. {myTheme.founded}</Text>
            </View>
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
              <Text style={styles.statChipVal}>GW {currentWeek}</Text>
              <Text style={styles.statChipLabel}>{weekToDate(currentWeek)}</Text>
            </View>
          </View>
        </View>

        {/* Breaking news */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: '#ef4444' }]}>Latest</Text>
          {latestNews.length > 0 ? (
            latestNews.map((n, idx) => (
              <View key={idx} style={styles.newsItem}>
                <Text style={styles.newsTextFeatured}>- {n}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.newsTextFeatured}>No news yet. Advance the week to see updates!</Text>
          )}
        </View>

        {/* Next fixture hero card */}
        <TouchableOpacity style={styles.heroMatchCard} onPress={handlePlayMatch} activeOpacity={0.85}>
              {homeTeam && awayTeam ? (
                <>
                  <Text style={styles.heroCompetition}>{myNextMatch ? getFixtureCompetitionLabel(myNextMatch) : ''}</Text>
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
                  <Text style={styles.vsStadium}>{homeTheme?.stadium || 'TBD'}</Text>
                </View>

                {/* Away team */}
                <View style={[styles.matchupTeam, { alignItems: 'flex-end' }]}>
                  <TeamColorBadge name={awayTeam.name} isUser={awayTeam.id === userTeamId} mirrored />
                  <View style={[styles.haTag, styles.haTagAway, { backgroundColor: '#2a1a1a' }]}>
                    <Text style={[styles.haTagText, { color: '#f87171' }]}>AWAY</Text>
                  </View>
                </View>
              </View>
              <View style={styles.playBtnRow}>
                <Text style={styles.heroPlayBtn}>Tap to play match</Text>
              </View>
              <View style={styles.quickSimRow}>
                <TouchableOpacity style={styles.quickSimBtn} onPress={advanceWeek} activeOpacity={0.85}>
                  <Text style={styles.quickSimText}>Quick Sim Week</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <Text style={styles.matchupSubtext}>No fixture this week.</Text>
              <Text style={styles.heroPlayBtn}>Tap to advance week</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.cupPaneRow}>
          <View style={styles.cupPane}>
            <Text style={styles.cupPaneTitle}>Carabao Cup</Text>
            <Text style={styles.cupPaneRound} numberOfLines={1}>{carabaoPane.round}</Text>
            <Text style={styles.cupPaneOpp} numberOfLines={1}>Next: {carabaoPane.opponent}</Text>
          </View>
          <View style={styles.cupPane}>
            <Text style={styles.cupPaneTitle}>FA Cup</Text>
            <Text style={styles.cupPaneRound} numberOfLines={1}>{faPane.round}</Text>
            <Text style={styles.cupPaneOpp} numberOfLines={1}>Next: {faPane.opponent}</Text>
          </View>
          <View style={[styles.cupPane, styles.cupPaneComingSoon]}>
            <Text style={styles.cupPaneTitle}>UCL</Text>
            <Text style={styles.cupPaneRound} numberOfLines={1}>Coming Soon</Text>
            <Text style={styles.cupPaneOpp} numberOfLines={1}>Next: Coming Soon</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.card} onPress={() => router.push('/calendar')} activeOpacity={0.85}>
          <Text style={styles.cardTitle}>Upcoming Fixtures</Text>
          {upcomingFixtures.map(({ week, matches }) => {
            const isCurrentWeek = week === currentWeek;
            return (
              <View key={week} style={[styles.calRow, isCurrentWeek && styles.calRowCurrent]}>
                <View style={styles.calDateBlock}>
                  <Text style={[styles.calWeek, isCurrentWeek && { color: '#38bdf8' }]}>Wk {week}</Text>
                  <Text style={styles.calDate}>{weekToDate(week)}</Text>
                </View>
                {matches.length > 0 ? (
                  <View style={styles.calMatchStack}>
                    {matches.map(match => {
                      const oppId = match.homeTeamId === userTeamId ? match.awayTeamId : match.homeTeamId;
                      const opp = teams[oppId];
                      if (!opp) return null;
                      const isHome = match.homeTeamId === userTeamId;
                      const oppTheme = getTeamTheme(opp.name);
                      return (
                        <View key={match.id} style={styles.calMatchBlock}>
                          <View style={[styles.calHABadge, isHome ? styles.calHAHome : styles.calHAAway]}>
                            <Text style={styles.calHAText}>{isHome ? 'H' : 'A'}</Text>
                          </View>
                          <View style={[styles.calKitChip, { backgroundColor: getDisplayKitColor(oppTheme.primary) }]} />
                          <View style={[styles.calKitChip, { backgroundColor: getDisplaySecondaryColor(oppTheme.secondary) }]} />
                          <Text style={styles.calOpp} numberOfLines={1}>
                            {opp.name}
                            {match.competition !== 'League' ? ` - ${match.competition} ${match.roundName || `R${match.roundNumber || 1}`}` : ''}
                          </Text>
                          {match.isPlayed && (
                            <Text style={styles.calScore}>
                              {isHome ? `${match.homeScore}-${match.awayScore}` : `${match.awayScore}-${match.homeScore}`}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.calBye}>Rest week</Text>
                )}
              </View>
            );
          })}
          <Text style={styles.smallTapText}>Tap to view full calendar</Text>
        </TouchableOpacity>

{/* Board room */}
        <TouchableOpacity style={styles.card} onPress={() => router.push('/board')} activeOpacity={0.85}>
          <Text style={styles.cardTitle}>Board Room</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>Manager Approval</Text>
              <Text style={{ color: myTeam.boardApproval >= 65 ? '#10B981' : (myTeam.boardApproval < 30 ? '#ef4444' : '#f59e0b'), fontSize: 24, fontWeight: '900', marginTop: 4 }}>
                {Math.round(myTeam.boardApproval)}%
              </Text>
              <Text style={{ color: '#cbd5e1', fontSize: 12, fontWeight: '800', marginTop: 6 }}>
                {myTeam.manager.name}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.smallTapText}>Tap to view objectives</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Mini table */}
        <TouchableOpacity style={styles.card} onPress={() => router.push('/league')}>
          <Text style={styles.cardTitle}>{myDivision}</Text>
          {miniTable.map((team) => {
            const t = getTeamTheme(team.name);
            const isMe = team.id === userTeamId;
            return (
              <View key={team.id} style={[styles.miniRow, isMe && styles.miniRowUser]}>
                <Text style={[styles.miniPos, isMe && styles.miniTextUser]}>{team.position}.</Text>
                <View style={styles.miniKitStrip}>
                  <View style={[styles.miniKitBlock, { backgroundColor: getDisplayKitColor(t.primary) }]} />
                  <View style={[styles.miniKitBlock, { backgroundColor: getDisplaySecondaryColor(t.secondary) }]} />
                </View>
                <Text style={[styles.miniName, isMe && styles.miniTextUser]} numberOfLines={1}>{team.name}</Text>
                <Text style={[styles.miniStat, isMe && styles.miniTextUser]}>{team.goalsFor - team.goalsAgainst > 0 ? '+' : ''}{team.goalsFor - team.goalsAgainst}</Text>
                <Text style={[styles.miniStat, styles.miniPts, isMe && styles.miniTextUser]}>{team.points}</Text>
              </View>
            );
          })}
          <Text style={styles.smallTapText}>Tap to view full table</Text>
        </TouchableOpacity>

        {/* Season stats */}
        <TouchableOpacity style={styles.card} onPress={() => router.push('/stats')}>
          <Text style={styles.cardTitle}>Season Stats</Text>
          {[
            { label: 'Top Scorer', name: topScorer ? topScorer.name : '-', stat: topScorer ? `${topScorer.goals} goals` : 'None yet' },
            { label: 'Top Assister', name: topAssister ? topAssister.name : '-', stat: topAssister ? `${topAssister.assists} assists` : 'None yet' },
            {
              label: 'Top 3 Clean Sheets (GK)',
              name: topCleanSheetGKs.length > 0 ? topCleanSheetGKs.map(player => player.name).join(', ') : '-',
              stat: topCleanSheetGKs.length > 0
                ? topCleanSheetGKs.map(player => `${player.cleanSheets}`).join(', ')
                : 'None yet'
            },
          ].map(({ label, name, stat }) => (
            <View key={label} style={styles.statLeaderRow}>
              <Text style={styles.statLeaderLabel}>{label}</Text>
              <View style={styles.statLeaderInfo}>
                <Text style={styles.statLeaderName}>{name}</Text>
                <Text style={styles.statLeaderNum}>{stat}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.smallTapText}>Tap for full stats</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.push('/trophies')} activeOpacity={0.85}>
          <Text style={styles.cardTitle}>Trophies & Finishes</Text>
          <Text style={styles.newsTextFeatured}>See every season result: what you won and where you finished.</Text>
          <Text style={styles.smallTapText}>Tap to open trophies page</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0f1e' },

  // Header
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

  // Stat chips
  statChipRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 10, padding: 10 },
  statChip: { flex: 1, alignItems: 'center' },
  statChipVal: { fontSize: 14, fontWeight: '900', color: '#f8fafc' },
  statChipLabel: { fontSize: 9, color: '#64748b', fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  statChipDivider: { width: 1, height: 28, backgroundColor: '#1e293b' },

  // Cards
  card: {
    backgroundColor: '#111827', marginHorizontal: 14, marginTop: 14,
    padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#1e293b',
  },
  cardTitle: { fontSize: 16, fontWeight: '900', marginBottom: 12, color: '#e2e8f0', letterSpacing: 0.5 },
  newsItem: { marginBottom: 8 },
  newsTextFeatured: { fontSize: 14, color: '#cbd5e1', lineHeight: 22, fontWeight: '600' },
  smallTapText: { fontSize: 11, color: '#38bdf8', fontWeight: '700', marginTop: 10, textAlign: 'right' },

  // Hero match card
  heroMatchCard: {
    backgroundColor: '#111827',
    marginHorizontal: 14, marginTop: 14,
    padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: '#1e3a5f',
    shadowColor: '#38bdf8', shadowOpacity: 0.08, shadowRadius: 10, elevation: 4,
  },
  heroCompetition: { fontSize: 11, color: '#38bdf8', fontWeight: '900', marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase' },
  matchupRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  matchupTeam: { flex: 1, gap: 6 },
  haTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, alignSelf: 'flex-start' },
  haTagAway: { alignSelf: 'flex-end' },
  haTagText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  matchupVsBlock: { paddingHorizontal: 16, alignItems: 'center' },
  matchupVs: { fontSize: 22, fontWeight: '900', color: '#334155' },
  vsStadium: { fontSize: 10, color: '#94a3b8', fontWeight: '700', marginTop: 4, textAlign: 'center' },
  matchupSubtext: { fontSize: 14, color: '#64748b', marginBottom: 8 },
  playBtnRow: { borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 12, alignItems: 'center' },
  heroPlayBtn: { fontSize: 10, fontWeight: '900', color: '#38bdf8', letterSpacing: 1.2 },
  quickSimRow: { alignItems: 'center', marginTop: 10 },
  quickSimBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  quickSimText: { fontSize: 11, fontWeight: '800', color: '#cbd5e1', letterSpacing: 0.8, textTransform: 'uppercase' },

  // Cup panes under play card
  cupPaneRow: {
    marginHorizontal: 14,
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  cupPane: {
    flex: 1,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 7,
    minHeight: 80,
  },
  cupPaneComingSoon: { borderColor: '#334155', opacity: 0.85 },
  cupPaneTitle: { fontSize: 10, fontWeight: '900', color: '#e2e8f0', marginBottom: 4, textTransform: 'uppercase' },
  cupPaneRound: { fontSize: 13, fontWeight: '900', color: '#38bdf8' },
  cupPaneOpp: { fontSize: 10, fontWeight: '700', color: '#cbd5e1', marginTop: 3 },

  // Upcoming fixtures
  calRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  calRowCurrent: { backgroundColor: '#0ea5e910' },
  calDateBlock: { width: 60 },
  calWeek: { fontSize: 10, fontWeight: '900', color: '#64748b', textTransform: 'uppercase' },
  calDate: { fontSize: 12, color: '#475569', fontWeight: '600', marginTop: 2 },
  calMatchStack: { flex: 1, gap: 6 },
  calMatchBlock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  calHABadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  calHAHome: { backgroundColor: '#1a3a4a' },
  calHAAway: { backgroundColor: '#2a1a1a' },
  calHAText: { color: '#94a3b8', fontSize: 9, fontWeight: '900' },
  calKitChip: { width: 8, height: 8, borderRadius: 2 },
  calOpp: { flex: 1, fontSize: 13, fontWeight: '700', color: '#e2e8f0' },
  calScore: { fontSize: 13, fontWeight: '900', color: '#38bdf8' },
  calBye: { flex: 1, fontSize: 12, color: '#334155', fontStyle: 'italic' },

  // Mini table
  miniRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  miniRowUser: { backgroundColor: '#0ea5e915', borderRadius: 6 },
  miniPos: { width: 24, fontWeight: '700', color: '#64748b', fontSize: 13 },
  miniKitStrip: { flexDirection: 'row', width: 16, height: 16, borderRadius: 3, overflow: 'hidden', marginRight: 8 },
  miniKitBlock: { flex: 1 },
  miniName: { flex: 1, color: '#cbd5e1', fontWeight: '600', fontSize: 13 },
  miniTextUser: { color: '#38bdf8', fontWeight: '900' },
  miniStat: { width: 32, textAlign: 'center', color: '#64748b', fontWeight: '600', fontSize: 12 },
  miniPts: { fontWeight: '900', color: '#f8fafc', fontSize: 13 },

  // Season stats
  statLeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  statLeaderLabel: { fontSize: 11, fontWeight: '700', color: '#64748b', width: 100 },
  statLeaderInfo: { flex: 1 },
  statLeaderName: { fontSize: 13, fontWeight: '800', color: '#f8fafc' },
  statLeaderNum: { fontSize: 11, color: '#64748b', fontWeight: '600' },

});



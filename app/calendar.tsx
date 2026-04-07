import React from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { formatShortDate } from '@/src/utils/calendar';
import { getTeamTheme } from '@/src/constants/teamColors';
import { PageHeader } from '@/components/ui/page-header';

export default function CalendarScreen() {
  const currentWeek = useGameStore(s => s.currentWeek);
  const userTeamId = useGameStore(s => s.userTeamId);
  const teams = useGameStore(s => s.teams);
  const allFixtures = useGameStore(s => s.fixtures);

  if (!userTeamId) return <View style={styles.container} />;

  // Filter only user's fixtures
  const myFixtures = Object.values(allFixtures)
    .filter(f => f.homeTeamId === userTeamId || f.awayTeamId === userTeamId)
    .sort((a, b) => a.week - b.week);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHeader
        title="Season Calendar"
        subtitle="2024/25 Fixtures"
        backLabel="< Hub"
        onBack={() => router.replace('/')}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {myFixtures.map(f => {
          const isHome = f.homeTeamId === userTeamId;
          const oppId = isHome ? f.awayTeamId : f.homeTeamId;
          const oppTeam = teams[oppId];
          const isPast = f.isPlayed;
          const isCurrent = f.week === currentWeek;
          
          if (!oppTeam) return null;
          
          const theme = getTeamTheme(oppTeam.name);

          // Build row items
          return (
            <View key={f.id}>
              {/* Optional Transfer Window Banner between weeks */}
              {f.week === 1 && (
                <View style={styles.windowBanner}><Text style={styles.windowText}>Summer Transfer Window Open</Text></View>
              )}
              {f.week === 5 && (
                <View style={styles.windowBannerClosed}><Text style={styles.windowText}>Transfer Window Closed</Text></View>
              )}
              {f.week === 19 && (
                <View style={styles.windowBanner}><Text style={styles.windowText}>Winter Transfer Window Open</Text></View>
              )}
              {f.week === 25 && (
                <View style={styles.windowBannerClosed}><Text style={styles.windowText}>Transfer Window Closed</Text></View>
              )}

              <View style={[
                styles.row, 
                isCurrent ? styles.rowCurrent : null,
                isPast ? styles.rowPast : null
              ]}>
                <View style={styles.dateCol}>
                  <Text style={styles.weekLabel}>WK {f.week}</Text>
                  <Text style={styles.dateLabel}>{formatShortDate(f.week)}</Text>
                </View>

                <View style={styles.badgeCol}>
                   <View style={[styles.haBadge, { backgroundColor: isHome ? '#38bdf8' : '#64748b' }]}>
                     <Text style={styles.haText}>{isHome ? 'H' : 'A'}</Text>
                   </View>
                </View>

                <View style={styles.oppCol}>
                  <View style={[styles.kitDot, { backgroundColor: theme.primary }]} />
                  <Text style={[styles.oppName, isPast && { color: '#94a3b8' }]} numberOfLines={1}>{oppTeam.name}</Text>
                </View>

                <View style={styles.scoreCol}>
                  {isPast ? (
                    <Text style={styles.scoreText}>
                      {isHome ? `${f.homeScore} - ${f.awayScore}` : `${f.awayScore} - ${f.homeScore}`}
                    </Text>
                  ) : (
                    <Text style={styles.vsText}>VS</Text>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { paddingVertical: 10 },
  row: { 
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1e293b'
  },
  rowCurrent: { backgroundColor: '#0ea5e920' },
  rowPast: { opacity: 0.7 },
  dateCol: { width: 60 },
  weekLabel: { color: '#64748b', fontSize: 10, fontWeight: '900' },
  dateLabel: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', marginTop: 2 },
  badgeCol: { width: 30, alignItems: 'center' },
  haBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  haText: { color: '#0f172a', fontWeight: '900', fontSize: 10 },
  oppCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10 },
  kitDot: { width: 10, height: 10, borderRadius: 5 },
  oppName: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  scoreCol: { width: 60, alignItems: 'flex-end' },
  vsText: { color: '#475569', fontWeight: '900', fontSize: 12 },
  scoreText: { color: '#38bdf8', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
  windowBanner: { backgroundColor: '#064e3b', paddingVertical: 6, alignItems: 'center', marginVertical: 4 },
  windowBannerClosed: { backgroundColor: '#7f1d1d', paddingVertical: 6, alignItems: 'center', marginVertical: 4 },
  windowText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' }
});

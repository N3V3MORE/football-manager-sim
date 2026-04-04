import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { useState } from 'react';
import { getTeamTheme } from '@/src/constants/teamColors';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function MatchScreen() {
  const router = useRouter();
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  
  const fixtures = useGameStore(state => state.fixtures);
  const teams = useGameStore(state => state.teams);
  const players = useGameStore(state => state.players);
  const playMatch = useGameStore(state => state.playMatch);
  const advanceWeek = useGameStore(state => state.advanceWeek);

  const fixture = fixtures[fixtureId];
  
  const [matchPlayed, setMatchPlayed] = useState(false);

  const getPosColor = (pos: string) => {
    switch(pos) {
      case 'GK': return '#F59E0B';
      case 'DEF': return '#3B82F6';
      case 'MID': return '#10B981';
      case 'FWD': return '#EF4444';
      default: return '#6B7280';
    }
  };

  if (!fixture) return <Text>Loading...</Text>;

  const homeTeam = teams[fixture.homeTeamId];
  const awayTeam = teams[fixture.awayTeamId];

  // Colors & Anti-Clash
  const homeTheme = getTeamTheme(homeTeam.name);
  const awayThemeRaw = getTeamTheme(awayTeam.name);
  let awayPrimary = awayThemeRaw.primary;
  if (homeTheme.primary === awayThemeRaw.primary) {
      awayPrimary = awayThemeRaw.secondary;
  }

  const stadium = homeTheme.stadium;

  // Starting 11s — sorted FWD → MID → DEF → GK for display
  const posOrder: Record<string, number> = { FWD: 1, MID: 2, DEF: 3, GK: 4 };
  const homePlayers = Object.values(players)
    .filter(p => p.teamId === fixture.homeTeamId && p.isStarting)
    .sort((a, b) => posOrder[a.position] - posOrder[b.position]);
  const awayPlayers = Object.values(players)
    .filter(p => p.teamId === fixture.awayTeamId && p.isStarting)
    .sort((a, b) => posOrder[a.position] - posOrder[b.position]);

  const handleSimulate = () => {
    playMatch(fixtureId);
    setMatchPlayed(true);
  };

  const handleContinue = () => {
    advanceWeek(); // advance to next week
    router.replace('/(tabs)');
  };

  const handleExit = () => {
      router.back();
  };

  const currentFixture = fixtures[fixtureId];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topNav}>
          <TouchableOpacity onPress={handleExit} style={styles.exitBtn}>
              <Text style={styles.exitText}>[ EXIT ]</Text>
          </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.headerTitle}>Match Simulation</Text>
        <Text style={styles.stadiumText}>{stadium}</Text>
        
        <View style={styles.scoreboard}>
          <View style={styles.teamBox}>
            <Text style={[styles.teamName, { color: homeTheme.primary }]}>{homeTeam.name}</Text>
            <Text style={styles.score}>{currentFixture.isPlayed ? currentFixture.homeScore : '-'}</Text>
          </View>
          <View style={styles.vsBox}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          <View style={styles.teamBox}>
            <Text style={[styles.teamName, { color: awayPrimary }]}>{awayTeam.name}</Text>
            <Text style={styles.score}>{currentFixture.isPlayed ? currentFixture.awayScore : '-'}</Text>
          </View>
        </View>

        <View style={styles.logBox}>
          {currentFixture.isPlayed ? (
            <Text style={styles.logText}>Match Finished!</Text>
          ) : (
            <Text style={styles.logText}>Ready To Kick Off</Text>
          )}
        </View>

        <View style={styles.lineupRow}>
            <View style={styles.lineupCol}>
                <Text style={[styles.lineupHeader, { color: homeTheme.primary }]}>Home XI</Text>
                {homePlayers.map(p => (
                    <View key={p.id} style={styles.lineupPlayerRow}>
                        <View style={[styles.lineupPosPill, { backgroundColor: getPosColor(p.position) }]}>
                            <Text style={styles.lineupPosText}>{p.subPosition || p.position}</Text>
                        </View>
                        <Text style={styles.lineupPlayerName} numberOfLines={1}>{p.name}</Text>
                    </View>
                ))}
            </View>
            <View style={[styles.lineupCol, { alignItems: 'flex-end' }]}>
                <Text style={[styles.lineupHeader, { color: awayPrimary, textAlign: 'right' }]}>Away XI</Text>
                {awayPlayers.map(p => (
                    <View key={p.id} style={[styles.lineupPlayerRow, { flexDirection: 'row-reverse' }]}>
                        <View style={[styles.lineupPosPill, { backgroundColor: getPosColor(p.position) }]}>
                            <Text style={styles.lineupPosText}>{p.subPosition || p.position}</Text>
                        </View>
                        <Text style={[styles.lineupPlayerName, { textAlign: 'right', marginRight: 6, marginLeft: 0 }]} numberOfLines={1}>{p.name}</Text>
                    </View>
                ))}
            </View>
        </View>

        <View style={styles.buttonContainer}>
          {!matchPlayed ? (
            <TouchableOpacity style={styles.btnSimulate} onPress={handleSimulate}>
              <Text style={styles.btnText}>Quick Simulate</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.btnContinue} onPress={handleContinue}>
              <Text style={styles.btnText}>Continue to Next Week</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  topNav: {
      paddingHorizontal: 20,
      paddingTop: 10,
      alignItems: 'flex-end',
  },
  exitBtn: {
      padding: 8,
  },
  exitText: {
      color: '#ef4444',
      fontWeight: 'bold',
      fontSize: 16,
  },
  scrollContent: {
      padding: 24,
      paddingTop: 10,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  stadiumText: {
      color: '#64748b',
      fontSize: 14,
      textAlign: 'center',
      fontWeight: '600',
      marginBottom: 32,
      letterSpacing: 1,
  },
  scoreboard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  teamBox: {
    flex: 1,
    alignItems: 'center',
  },
  teamName: {
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  score: {
    color: '#f8fafc',
    fontSize: 42,
    fontWeight: '900',
  },
  vsBox: {
    paddingHorizontal: 16,
  },
  vsText: {
    color: '#64748b',
    fontSize: 16,
    fontWeight: '900',
  },
  logBox: {
    marginTop: 24,
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  logText: {
    color: '#38bdf8',
    fontSize: 18,
    fontWeight: '800',
  },
  lineupRow: {
      flexDirection: 'row',
      marginTop: 24,
      justifyContent: 'space-between',
  },
  lineupCol: {
      flex: 1,
  },
  lineupHeader: {
      fontSize: 14,
      fontWeight: '900',
      marginBottom: 12,
      textTransform: 'uppercase',
  },
  lineupPlayerName: {
      color: '#cbd5e1',
      fontSize: 12,
      marginBottom: 4,
  },
  buttonContainer: {
    marginTop: 48,
    paddingBottom: 40,
  },
  btnSimulate: {
    backgroundColor: '#38bdf8',
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 200,
  },
  btnContinue: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 200,
  },
  btnText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
  },
  lineupPosPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
    minWidth: 32,
    alignItems: 'center',
  },
  lineupPosText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
  },
  lineupPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
});

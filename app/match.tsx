import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { useState, useEffect, useRef } from 'react';
import { getTeamTheme } from '@/src/constants/teamColors';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function MatchScreen() {
  const router = useRouter();
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  
  const fixtures = useGameStore(state => state.fixtures);
  const teams = useGameStore(state => state.teams);
  const players = useGameStore(state => state.players);
  const processMatchMinute = useGameStore(state => state.processMatchMinute);
  const finishLiveMatch = useGameStore(state => state.finishLiveMatch);
  const advanceWeek = useGameStore(state => state.advanceWeek);

  const fixture = fixtures[fixtureId];
  
  const [minute, setMinute] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHalfTime, setIsHalfTime] = useState(false);
  const [matchFinished, setMatchFinished] = useState(false);
  const [logs, setLogs] = useState<string[]>(['Match is ready to start!']);

  const minuteRef = useRef(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && !isHalfTime && !matchFinished) {
      interval = setInterval(() => {
        minuteRef.current += 1;
        const nextMin = minuteRef.current;
        setMinute(nextMin);

        const { event } = processMatchMinute(fixtureId, nextMin);
        if (event) {
          setLogs((l) => [event, ...l].slice(0, 8));
        }
        if (nextMin === 45) {
          setIsHalfTime(true);
          setIsPlaying(false);
        } else if (nextMin >= 90) {
          setMatchFinished(true);
          setIsPlaying(false);
          finishLiveMatch(fixtureId);
        }
      }, 167); // 15 seconds total for 90 minutes
    }
    return () => clearInterval(interval);
  }, [isPlaying, isHalfTime, matchFinished, fixtureId, processMatchMinute, finishLiveMatch]);

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

  const homePlayers = sortPlayersByPositionGroup(
    Object.values(players).filter(p => p.teamId === fixture.homeTeamId && p.isStarting)
  );
  const awayPlayers = sortPlayersByPositionGroup(
    Object.values(players).filter(p => p.teamId === fixture.awayTeamId && p.isStarting)
  );

  const handleStart = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleResumeHT = () => { setIsHalfTime(false); setIsPlaying(true); };

  const handleContinue = () => {
    advanceWeek(); // advance to next week
    router.replace('/(tabs)');
  };

  const handleExit = () => {
    if (!matchFinished && minute > 0 && minute < 90) {
      for (let m = minute + 1; m <= 90; m++) {
        processMatchMinute(fixtureId, m);
      }
      finishLiveMatch(fixtureId);
    }
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
        <Text style={styles.minuteClock}>{minute}&apos;</Text>
        
        <View style={styles.scoreboard}>
          <View style={styles.teamBox}>
            <Text style={[styles.teamName, { color: homeTheme.primary }]}>{homeTeam.name}</Text>
            <Text style={styles.score}>
                {minute > 0 || currentFixture.isPlayed ? currentFixture.homeScore : '-'}
            </Text>
          </View>
          <View style={styles.vsBox}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          <View style={styles.teamBox}>
            <Text style={[styles.teamName, { color: awayPrimary }]}>{awayTeam.name}</Text>
            <Text style={styles.score}>
                {minute > 0 || currentFixture.isPlayed ? currentFixture.awayScore : '-'}
            </Text>
          </View>
        </View>

        <View style={styles.logBox}>
          {logs.map((log, idx) => (
             <Text key={idx} style={[styles.logText, idx === 0 && styles.logTextLatest]}>
                {log}
             </Text>
          ))}
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
          {!isPlaying && !isHalfTime && !matchFinished && minute === 0 && (
            <TouchableOpacity style={styles.btnSimulate} onPress={handleStart}>
              <Text style={styles.btnText}>Kick Off</Text>
            </TouchableOpacity>
          )}
          {isPlaying && (
            <TouchableOpacity style={styles.btnPause} onPress={handlePause}>
              <Text style={styles.btnText}>Pause & Tactics</Text>
            </TouchableOpacity>
          )}
          {!isPlaying && !isHalfTime && !matchFinished && minute > 0 && (
            <TouchableOpacity style={styles.btnSimulate} onPress={handleStart}>
              <Text style={styles.btnText}>Resume</Text>
            </TouchableOpacity>
          )}
          {isHalfTime && (
            <TouchableOpacity style={styles.btnSimulate} onPress={handleResumeHT}>
              <Text style={styles.btnText}>Start Second Half</Text>
            </TouchableOpacity>
          )}
          {matchFinished && (
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
      marginBottom: 12,
      letterSpacing: 1,
  },
  minuteClock: {
      color: '#ef4444',
      fontSize: 32,
      fontWeight: '900',
      textAlign: 'center',
      marginBottom: 20,
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
    borderWidth: 1,
    borderColor: '#334155',
    minHeight: 120,
  },
  logText: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 4,
  },
  logTextLatest: {
    color: '#38bdf8',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
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
  btnPause: {
    backgroundColor: '#F59E0B',
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

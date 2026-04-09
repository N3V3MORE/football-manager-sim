import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { useState, useEffect, useRef } from 'react';
import { getTeamTheme } from '@/src/constants/teamColors';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getFixtureCompetitionLabel } from '@/src/core/competitionUtils';

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

  if (!fixture) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading match...</Text>
        </View>
      </SafeAreaView>
    );
  }

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
    if (minute > 0 || matchFinished) {
      advanceWeek();
      router.replace('/(tabs)');
      return;
    }
    router.back();
  };

  const currentFixture = fixtures[fixtureId];
  const matchStateLabel =
    matchFinished ? 'Full Time' :
    isHalfTime ? 'Half Time' :
    isPlaying ? 'Live' :
    minute > 0 ? 'Paused' :
    'Ready';
  const matchStateColor =
    matchFinished ? '#34d399' :
    isHalfTime ? '#f59e0b' :
    isPlaying ? '#38bdf8' :
    '#94a3b8';
  const minuteLabel =
    matchFinished ? 'FT' :
    isHalfTime ? 'HT' :
    minute > 0 ? `${minute}'` :
    'KO';
  const controlHeadline =
    matchFinished ? 'Match complete' :
    isHalfTime ? 'Second half ready' :
    isPlaying ? 'Simulation running' :
    minute > 0 ? 'Simulation paused' :
    'Ready for kick off';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topNav}>
        <TouchableOpacity onPress={handleExit} style={styles.exitBtn} activeOpacity={0.85}>
          <Text style={styles.exitText}>Exit Match</Text>
        </TouchableOpacity>
        <View style={[styles.statusPill, { borderColor: `${matchStateColor}55`, backgroundColor: `${matchStateColor}15` }]}>
          <Text style={[styles.statusPillText, { color: matchStateColor }]}>{matchStateLabel}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <Text style={styles.headerTitle}>Match Simulation</Text>
          <Text style={styles.competitionText}>{getFixtureCompetitionLabel(currentFixture)}</Text>
          <Text style={styles.stadiumText}>{stadium}</Text>
          <Text style={[styles.minuteClock, { color: matchStateColor }]}>{minuteLabel}</Text>

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
        </View>

        <View style={styles.feedCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Match Feed</Text>
            <Text style={styles.sectionHint}>Latest incidents first</Text>
          </View>
          {logs.map((log, idx) => (
            <View key={idx} style={[styles.logRow, idx === 0 && styles.logRowLatest]}>
              <View style={[styles.logMarker, idx === 0 && styles.logMarkerLatest]} />
              <Text style={[styles.logText, idx === 0 && styles.logTextLatest]}>
                {log}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.lineupCard}>
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

        <View style={styles.lineupCard}>
          <Text style={[styles.lineupHeader, { color: awayPrimary }]}>Away XI</Text>
          {awayPlayers.map(p => (
            <View key={p.id} style={styles.lineupPlayerRow}>
              <View style={[styles.lineupPosPill, { backgroundColor: getPosColor(p.position) }]}>
                <Text style={styles.lineupPosText}>{p.subPosition || p.position}</Text>
              </View>
              <Text style={styles.lineupPlayerName} numberOfLines={1}>{p.name}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actionCard}>
          <Text style={styles.sectionTitle}>Controls</Text>
          <Text style={styles.controlHeadline}>{controlHeadline}</Text>
          <Text style={styles.controlHint}>Leaving mid-match will sim the rest automatically.</Text>
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
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94a3b8', fontSize: 16, fontWeight: '700' },
  topNav: {
    paddingHorizontal: 20,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exitBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
  },
  exitText: {
    color: '#e2e8f0',
    fontWeight: '900',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  statusPillText: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  scrollContent: {
    padding: 20,
    paddingTop: 14,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: '#111827',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 18,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  stadiumText: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: 8,
  },
  competitionText: {
    color: '#38bdf8',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '900',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  minuteClock: {
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 16,
  },
  scoreboard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
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
  feedCard: {
    marginTop: 24,
    backgroundColor: '#111827',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
  sectionTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '900' },
  sectionHint: { color: '#64748b', fontSize: 11, fontWeight: '700' },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  logRowLatest: { borderTopWidth: 0, paddingTop: 0 },
  logMarker: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#334155',
    marginTop: 5,
  },
  logMarkerLatest: { backgroundColor: '#38bdf8' },
  logText: {
    color: '#94a3b8',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  logTextLatest: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '800',
  },
  lineupCard: {
    marginTop: 20,
    backgroundColor: '#111827',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
  },
  lineupHeader: {
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  lineupPlayerName: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  actionCard: {
    marginTop: 20,
    backgroundColor: '#111827',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
  },
  controlHeadline: { color: '#e2e8f0', fontSize: 16, fontWeight: '900', marginTop: 8 },
  controlHint: { color: '#64748b', fontSize: 12, marginTop: 6, marginBottom: 16, lineHeight: 18 },
  btnSimulate: {
    backgroundColor: '#38bdf8',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 200,
  },
  btnPause: {
    backgroundColor: '#F59E0B',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 200,
  },
  btnContinue: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 200,
  },
  btnText: {
    color: '#0f172a',
    fontSize: 15,
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
    marginBottom: 8,
  },
});

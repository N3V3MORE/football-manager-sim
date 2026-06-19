import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { useState, useEffect, useRef } from 'react';
import { getTeamTheme } from '@/src/constants/teamColors';
import { getPositionColor } from '@/src/constants/positionColors';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TeamTactics } from '@/src/models/types';
import { TacticSection } from '@/components/squad/tactic-section';

export default function MatchScreen() {
  const router = useRouter();
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  
  const fixtures = useGameStore(state => state.fixtures);
  const teams = useGameStore(state => state.teams);
  const players = useGameStore(state => state.players);
  const liveMatches = useGameStore(state => state.liveMatches);
  const userTeamId = useGameStore(state => state.userTeamId);
  const setTactics = useGameStore(state => state.setTactics);
  const processMatchMinute = useGameStore(state => state.processMatchMinute);
  const finishLiveMatch = useGameStore(state => state.finishLiveMatch);
  const advanceWeek = useGameStore(state => state.advanceWeek);

  const fixture = fixtures[fixtureId];
  const liveMatchState = liveMatches?.[fixtureId];
  const liveProcessedMinutes = liveMatchState?.processedMinutes || [];
  const liveProcessedCount = liveProcessedMinutes.length;
  const liveProcessedMax = liveProcessedCount > 0 ? Math.max(...liveProcessedMinutes) : 0;
  const restoreStateKey = [
    fixtureId,
    fixture?.isPlayed ? 'played' : 'unplayed',
    fixture?.homeScore ?? 'null',
    fixture?.awayScore ?? 'null',
    liveMatchState?.initialized ? 'live' : 'none',
    liveProcessedCount,
    liveProcessedMax,
  ].join(':');
  
  const [minute, setMinute] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHalfTime, setIsHalfTime] = useState(false);
  const [matchFinished, setMatchFinished] = useState(false);
  const [logs, setLogs] = useState<string[]>(['Match is ready to start!']);
  const [showTactics, setShowTactics] = useState(false);

  const minuteRef = useRef(0);
  const appliedRestoreKeyRef = useRef<string | null>(null);

  // On mount / fixture state change: restore live-match state from persistence if available.
  // The derived key lets async persisted state rehydration rerun this effect without
  // repeatedly resetting active in-progress play as processMatchMinute updates the store.
  useEffect(() => {
    if (isPlaying || appliedRestoreKeyRef.current === restoreStateKey) return;

    const liveState = liveMatches?.[fixtureId];
    const fixtureData = fixtures[fixtureId];
    appliedRestoreKeyRef.current = restoreStateKey;

    if (liveState && liveState.initialized && !fixtureData?.isPlayed) {
      const processed = liveState.processedMinutes || [];
      const maxProcessed = processed.length > 0 ? Math.max(...processed) : 0;
      const resumedMinute = maxProcessed;
      minuteRef.current = resumedMinute;
      setMinute(resumedMinute);
      setIsPlaying(false); // always start paused when resuming
      const isFinished = resumedMinute >= 90;
      setMatchFinished(isFinished);
      setIsHalfTime(resumedMinute === 45);
      if (resumedMinute === 0) {
        setLogs(['Match is ready to start!']);
      } else if (isFinished) {
        setLogs(['Match has finished.']);
      } else if (resumedMinute === 45) {
        setLogs(['HALF TIME. Match state restored.']);
      } else {
        setLogs([`Resumed at ${resumedMinute}' — tap Resume to continue.`]);
      }
    } else {
      minuteRef.current = 0;
      setMinute(0);
      setIsPlaying(false);
      setIsHalfTime(false);
      setMatchFinished(false);
      setLogs(['Match is ready to start!']);
    }
  }, [fixtureId, restoreStateKey]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    let mounted = true;
    if (isPlaying && !isHalfTime && !matchFinished) {
      interval = setInterval(() => {
        minuteRef.current += 1;
        const nextMin = minuteRef.current;
        if (!mounted) return;
        setMinute(nextMin);

        const { event } = processMatchMinute(fixtureId, nextMin);
        if (event) {
          setLogs((l) => [event, ...l].slice(0, 8));
        }
        if (nextMin === 45) {
          if (!mounted) return;
          setIsHalfTime(true);
          setIsPlaying(false);
        } else if (nextMin >= 90) {
          if (!mounted) return;
          setMatchFinished(true);
          setIsPlaying(false);
          finishLiveMatch(fixtureId);
        }
      }, 167);
    }
    return () => { mounted = false; clearInterval(interval); };
  }, [isPlaying, isHalfTime, matchFinished, fixtureId, processMatchMinute, finishLiveMatch]);

  const handleContinue = () => {
    advanceWeek(); // advance to next week
    router.replace('/(tabs)');
  };

  if (!fixture) return <Text>Loading...</Text>;

  const homeTeam = teams[fixture.homeTeamId];
  const awayTeam = teams[fixture.awayTeamId];

  // If the fixture is already played, show the result screen
  if (fixture.isPlayed) {
    const hScore = fixture.homeScore ?? 0;
    const aScore = fixture.awayScore ?? 0;
    const homeTheme = getTeamTheme(homeTeam.name);
    const awayThemeRaw = getTeamTheme(awayTeam.name);
    let awayPrimary = awayThemeRaw.primary;
    if (homeTheme.primary === awayThemeRaw.primary) {
      awayPrimary = awayThemeRaw.secondary;
    }
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topNav}>
          <TouchableOpacity onPress={() => router.back()} style={styles.exitBtn}>
            <Text style={styles.exitText}>[ EXIT ]</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.headerTitle}>Match Result</Text>
          <Text style={styles.stadiumText}>{homeTheme.stadium}</Text>
          <View style={styles.scoreboard}>
            <View style={styles.teamBox}>
              <Text style={[styles.teamName, { color: homeTheme.primary }]}>{homeTeam.name}</Text>
              <Text style={styles.score}>{hScore}</Text>
            </View>
            <View style={styles.vsBox}>
              <Text style={styles.vsText}>VS</Text>
            </View>
            <View style={styles.teamBox}>
              <Text style={[styles.teamName, { color: awayPrimary }]}>{awayTeam.name}</Text>
              <Text style={styles.score}>{aScore}</Text>
            </View>
          </View>
          {fixture.resolution === 'penalties' && (
            <Text style={{ color: '#facc15', fontSize: 14, fontWeight: '900', textAlign: 'center', marginTop: 12 }}>
              Won on penalties
            </Text>
          )}
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.btnContinue} onPress={handleContinue}>
              <Text style={styles.btnText}>Continue to Next Week</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

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
  const handlePause = () => { setIsPlaying(false); setShowTactics(true); };
  const handleResumeHT = () => { setIsHalfTime(false); setIsPlaying(true); };
  const canResumeFromTactics = !isHalfTime && !matchFinished && minute > 0 && minute < 90;
  const handleResumeFromTactics = () => {
    setShowTactics(false);
    if (canResumeFromTactics) {
      setIsPlaying(true);
    }
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

  // Tactical overlay config
  const TACTIC_SECTIONS: { key: keyof TeamTactics; title: string; options: string[]; descriptions: Record<string, string> }[] = [
    {
      key: 'mentality',
      title: 'Mentality',
      options: ['Defensive', 'Balanced', 'Attacking'],
      descriptions: {
        Defensive: 'Focus on shape and discipline. Lower goal threat but stronger defence.',
        Balanced: 'Standard approach. No specific stat bonuses or penalties.',
        Attacking: 'Push players forward. Increased shooting accuracy but vulnerable to counters.',
      },
    },
    {
      key: 'passingStyle',
      title: 'Passing Style',
      options: ['Short', 'Mixed', 'Direct'],
      descriptions: {
        Short: 'Patient buildup. Higher pass completion but fewer through-balls.',
        Mixed: 'A balanced blend of short and direct passing.',
        Direct: 'Bypass midfield. More through-balls, more risk on passing.',
      },
    },
    {
      key: 'tempo',
      title: 'Tempo',
      options: ['Slow', 'Normal', 'Fast'],
      descriptions: {
        Slow: 'Control the game and limit opponent chances.',
        Normal: 'Standard rhythm and frequency of play.',
        Fast: 'Higher intensity and chance creation, but costs more energy.',
      },
    },
    {
      key: 'defensiveLine',
      title: 'Defensive Line',
      options: ['Deep', 'Standard', 'High'],
      descriptions: {
        Deep: 'Protect space behind the defence but concede midfield territory.',
        Standard: 'Balanced defensive positioning.',
        High: 'Compress the pitch but risk through-balls behind.',
      },
    },
    {
      key: 'pressing',
      title: 'Pressing',
      options: ['None', 'Medium', 'High'],
      descriptions: {
        None: 'Sit off and conserve energy.',
        Medium: 'Press selectively.',
        High: 'Aggressive pressure with higher energy cost.',
      },
    },
  ];

  const myTeam = userTeamId ? teams[userTeamId] : null;
  const myTactics = myTeam?.tactics;

  const handleTacticChange = (key: keyof TeamTactics, value: string) => {
    if (!userTeamId) return;
    setTactics(userTeamId, { [key]: value } as Partial<TeamTactics>);
  };

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
                        <View style={[styles.lineupPosPill, { backgroundColor: getPositionColor(p.position) }]}>
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
                        <View style={[styles.lineupPosPill, { backgroundColor: getPositionColor(p.position) }]}>
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

      {/* Tactical Overlay Modal */}
      <Modal
        visible={showTactics}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowTactics(false)}
      >
        <View style={styles.tacticsModalOverlay}>
          <View style={styles.tacticsModalContainer}>
            <View style={styles.tacticsModalHeader}>
              <Text style={styles.tacticsModalTitle}>Pause &amp; Tactics</Text>
              <TouchableOpacity onPress={() => setShowTactics(false)} style={styles.tacticsModalCloseBtn}>
                <Text style={styles.tacticsModalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.tacticsModalScroll} showsVerticalScrollIndicator={false}>
              {myTactics && TACTIC_SECTIONS.map((section) => (
                <TacticSection
                  key={section.key}
                  title={section.title}
                  selectedOption={myTactics[section.key]}
                  options={section.options}
                  descriptions={section.descriptions}
                  onSelect={(option) => handleTacticChange(section.key, option)}
                />
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.tacticsModalResumeBtn}
              onPress={handleResumeFromTactics}
              activeOpacity={0.85}
            >
              <Text style={styles.tacticsModalResumeText}>{canResumeFromTactics ? 'Resume Match' : 'Back to Match'}</Text>
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
    borderRadius: 0,
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
    borderRadius: 0,
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
    borderRadius: 0,
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 200,
  },
  btnPause: {
    backgroundColor: '#F59E0B',
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 0,
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 200,
  },
  btnContinue: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 0,
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
    borderRadius: 0,
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
  // Tactical modal
  tacticsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  tacticsModalContainer: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 2,
    borderTopColor: '#38bdf8',
    maxHeight: '80%',
    paddingBottom: 20,
  },
  tacticsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  tacticsModalTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '900',
  },
  tacticsModalCloseBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#334155',
    borderRadius: 0,
  },
  tacticsModalCloseText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '800',
  },
  tacticsModalScroll: {
    padding: 16,
    gap: 18,
  },
  tacticsModalResumeBtn: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#38bdf8',
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 0,
  },
  tacticsModalResumeText: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '900',
  },
});

import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { useState, useEffect, useRef } from 'react';
import { getTeamTheme } from '@/src/constants/teamColors';
import { getPositionColor } from '@/src/constants/positionColors';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { Formation, MatchPlayerSummaryRow, TeamTactics } from '@/src/models/types';
import { TacticSection } from '@/components/squad/tactic-section';
import { FormationSelectionModal } from '@/components/squad/formation-selection-modal';
import { Screen, ModalSheet, Button } from '@/components/ui';
import { color } from '@/src/design/tokens';
import { useConfirmStore } from '@/src/store/confirmStore';
import { SUPPORTED_FORMATIONS } from '@/src/constants/formations';
import * as Haptics from 'expo-haptics';

// B4: extend haptics beyond the tab bar. A light tick on primary match actions
// and a medium impact at full-time give the live sim some physical feedback.
// No-op on platforms without a haptic engine.
const tap = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
  if (process.env.EXPO_OS === 'ios' || process.env.EXPO_OS === 'android') {
    Haptics.impactAsync(style).catch(() => {});
  }
};

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
  const makeLiveSubstitutions = useGameStore(state => state.makeLiveSubstitutions);
  const setLiveMatchFormation = useGameStore(state => state.setLiveMatchFormation);
  const advanceWeek = useGameStore(state => state.advanceWeek);

  const fixture = fixtures[fixtureId];
  const liveMatchState = liveMatches?.[fixtureId];
  const liveProcessedMinutes = liveMatchState?.processedMinutes || [];
  const liveProcessedCount = liveProcessedMinutes.length;
  const liveProcessedMax = liveProcessedCount > 0 ? Math.max(...liveProcessedMinutes) : 0;
  const liveKnockoutNeedsExtraTime = Boolean(
    fixture?.isKnockout &&
    (
      liveMatchState?.extraTimeStarted ||
      (liveProcessedMax >= 90 && (fixture.homeScore ?? 0) === (fixture.awayScore ?? 0))
    )
  );
  const liveMatchEndMinute = liveKnockoutNeedsExtraTime ? 120 : 90;
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
  const [showLiveFormationPicker, setShowLiveFormationPicker] = useState(false);
  const [selectedOffPlayerId, setSelectedOffPlayerId] = useState<string | null>(null);
  const [selectedOnPlayerId, setSelectedOnPlayerId] = useState<string | null>(null);
  const [pendingReplacements, setPendingReplacements] = useState<{ offPlayerId: string; onPlayerId: string }[]>([]);
  const showConfirm = useConfirmStore(s => s.showConfirm);

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
      const isFinished = resumedMinute >= liveMatchEndMinute;
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
  }, [fixtureId, restoreStateKey, isPlaying, liveMatches, fixtures, liveMatchEndMinute]);

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
        const latestFixture = useGameStore.getState().fixtures[fixtureId];
        const needsExtraTime = Boolean(
          latestFixture?.isKnockout &&
          nextMin === 90 &&
          (latestFixture.homeScore ?? 0) === (latestFixture.awayScore ?? 0)
        );
        if (nextMin === 45) {
          if (!mounted) return;
          setIsHalfTime(true);
          setIsPlaying(false);
        } else if (needsExtraTime) {
          if (!mounted) return;
          setIsPlaying(false);
          setLogs((l) => ['Extra time to come. Use Team Management, then Resume.', ...l].slice(0, 8));
        } else if (nextMin >= liveMatchEndMinute) {
          if (!mounted) return;
          setMatchFinished(true);
          setIsPlaying(false);
          tap(Haptics.ImpactFeedbackStyle.Medium);
          finishLiveMatch(fixtureId);
        }
      }, 167);
    }
    return () => { mounted = false; clearInterval(interval); };
  }, [isPlaying, isHalfTime, matchFinished, fixtureId, processMatchMinute, finishLiveMatch, liveMatchEndMinute]);

  const handleContinue = () => {
    tap();
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
    const matchSummary = fixture.matchSummary;
    const manOfTheMatch = matchSummary?.playerRows.find(row => row.playerId === matchSummary.manOfTheMatchPlayerId);
    const homeSummaryRows = matchSummary?.playerRows.filter(row => row.teamId === fixture.homeTeamId) || [];
    const awaySummaryRows = matchSummary?.playerRows.filter(row => row.teamId === fixture.awayTeamId) || [];
    const renderRatingRows = (rows: MatchPlayerSummaryRow[]) => (
      rows
        .sort((left, right) => right.minutes - left.minutes || right.rating - left.rating)
        .map(row => (
          <View key={row.playerId} style={styles.ratingRow}>
            <Text style={styles.ratingName} numberOfLines={1}>{row.name}</Text>
            <Text style={styles.ratingMeta}>{`${row.minutes}'`}</Text>
            <Text style={styles.ratingMeta}>{row.rating.toFixed(1)}</Text>
          </View>
        ))
    );
    return (
      <Screen scroll={false}>
        <View style={styles.topNav}>
          <TouchableOpacity onPress={() => router.back()} style={styles.exitBtn} accessibilityRole="button" accessibilityLabel="Exit match">
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
          {fixture.resolution === 'extra_time' && (
            <Text style={styles.penaltiesNote}>
              Won after extra time
            </Text>
          )}
          {fixture.resolution === 'penalties' && (
            <Text style={styles.penaltiesNote}>
              Won on penalties{fixture.penaltyShootout ? ` (${fixture.penaltyShootout.homeScore}-${fixture.penaltyShootout.awayScore})` : ''}
            </Text>
          )}
          {fixture.penaltyShootout && (
            <View style={styles.summaryPanel}>
              <Text style={styles.summaryTitle}>Penalty Shootout</Text>
              {fixture.penaltyShootout.kicks.map((kick, index) => (
                <Text key={`${kick.teamId}-${kick.takerPlayerId}-${index}`} style={styles.ratingMeta}>
                  {teams[kick.teamId]?.name}: {players[kick.takerPlayerId]?.name || 'Taker'} - {kick.outcome.toUpperCase()} ({kick.homeScore}-{kick.awayScore})
                </Text>
              ))}
            </View>
          )}
          {matchSummary && (
            <View style={styles.summaryPanel}>
              <Text style={styles.summaryTitle}>Match Stats</Text>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{matchSummary.homeTeamStats.shots}</Text>
                <Text style={styles.statLabel}>Shots</Text>
                <Text style={styles.statValue}>{matchSummary.awayTeamStats.shots}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{matchSummary.homeTeamStats.shotsOnTarget}</Text>
                <Text style={styles.statLabel}>Shots on Target</Text>
                <Text style={styles.statValue}>{matchSummary.awayTeamStats.shotsOnTarget}</Text>
              </View>
              {manOfTheMatch && (
                <View style={styles.motmBox}>
                  <Text style={styles.summaryTitle}>Man of the Match</Text>
                  <Text style={styles.motmName}>{manOfTheMatch.name}</Text>
                  <Text style={styles.motmMeta}>{manOfTheMatch.rating.toFixed(1)} rating</Text>
                </View>
              )}
              <Text style={styles.summaryTitle}>Player Ratings</Text>
              <View style={styles.ratingsGrid}>
                <View style={styles.ratingsCol}>
                  <Text style={[styles.lineupHeader, { color: homeTheme.primary }]}>{homeTeam.name}</Text>
                  {renderRatingRows(homeSummaryRows)}
                </View>
                <View style={styles.ratingsCol}>
                  <Text style={[styles.lineupHeader, { color: awayPrimary, textAlign: 'right' }]}>{awayTeam.name}</Text>
                  {renderRatingRows(awaySummaryRows)}
                </View>
              </View>
            </View>
          )}
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.btnContinue} onPress={handleContinue} accessibilityRole="button" accessibilityLabel="Continue to next week">
              <Text style={styles.btnText}>Continue to Next Week</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Screen>
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

  const getPlayersByIds = (ids?: string[]) => (
    (ids || []).map(id => players[id]).filter(Boolean)
  );
  const homePlayers = sortPlayersByPositionGroup(
    liveMatchState?.currentHomePlayerIds
      ? getPlayersByIds(liveMatchState.currentHomePlayerIds)
      : Object.values(players).filter(p => p.teamId === fixture.homeTeamId && p.isStarting)
  );
  const awayPlayers = sortPlayersByPositionGroup(
    liveMatchState?.currentAwayPlayerIds
      ? getPlayersByIds(liveMatchState.currentAwayPlayerIds)
      : Object.values(players).filter(p => p.teamId === fixture.awayTeamId && p.isStarting)
  );

  const handleStart = () => { tap(); setIsPlaying(true); };
  const handlePause = () => { tap(); setIsPlaying(false); setShowTactics(true); };
  const handleResumeHT = () => { tap(); setIsHalfTime(false); setIsPlaying(true); };
  const canResumeFromTactics = !isHalfTime && !matchFinished && minute > 0 && minute < liveMatchEndMinute;
  const handleResumeFromTactics = () => {
    setShowTactics(false);
    if (canResumeFromTactics) {
      setIsPlaying(true);
    }
  };

  const handleExit = () => {
    // B4: confirm before silently quick-simming the remaining minutes. Previously
    // tapping EXIT mid-match finalized the result with no warning.
    if (!matchFinished && minute > 0 && minute < liveMatchEndMinute) {
      showConfirm({
        title: 'Exit Match?',
        message: 'The remaining minutes will be quick-simulated and the result finalized.',
        confirmText: 'Sim & Exit',
        onConfirm: () => {
          for (let m = minute + 1; m <= liveMatchEndMinute; m++) {
            processMatchMinute(fixtureId, m);
          }
          finishLiveMatch(fixtureId);
          router.back();
        },
      });
      return;
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

  const userIsHome = userTeamId ? fixture.homeTeamId === userTeamId : false;
  const userCurrentIds = liveMatchState
    ? (userIsHome ? liveMatchState.currentHomePlayerIds : liveMatchState.currentAwayPlayerIds)
    : undefined;
  const userBenchIds = liveMatchState
    ? (userIsHome ? liveMatchState.homeBenchIds : liveMatchState.awayBenchIds)
    : undefined;
  const userSubState = liveMatchState
    ? (userIsHome ? liveMatchState.homeSubstitutionState : liveMatchState.awaySubstitutionState)
    : undefined;
  const liveFormation = liveMatchState
    ? (userIsHome ? liveMatchState.homeActiveFormation : liveMatchState.awayActiveFormation)
    : undefined;
  const activeSubOffIds = new Set(pendingReplacements.map(replacement => replacement.offPlayerId));
  const activeSubOnIds = new Set(pendingReplacements.map(replacement => replacement.onPlayerId));
  const manageableCurrentPlayers = sortPlayersByPositionGroup(
    getPlayersByIds(userCurrentIds).filter(player => !activeSubOffIds.has(player.id))
  );
  const manageableBenchPlayers = sortPlayersByPositionGroup(
    getPlayersByIds(userBenchIds).filter(player => (
      !userCurrentIds?.includes(player.id) &&
      !activeSubOnIds.has(player.id)
    ))
  );
  const usedSubs = userSubState?.substitutesUsed || 0;
  const usedWindows = userSubState?.substitutionWindowsUsed || 0;
  const maxSubs = userSubState?.maxSubstitutes || 5;
  const maxWindows = Math.max(userSubState?.maxWindows || 3, liveMatchEndMinute > 90 && liveProcessedMax >= 90 ? 4 : 3);
  const remainingSubs = Math.max(0, maxSubs - usedSubs - pendingReplacements.length);
  const isManagingHalfTime = liveProcessedMax === 45;
  const remainingWindows = Math.max(0, maxWindows - usedWindows);
  const canQueueSubstitution = remainingSubs > 0 && (isManagingHalfTime || remainingWindows > 0);
  const canManageLiveTeam = Boolean(userTeamId && liveMatchState?.initialized && userCurrentIds?.length);
  const handleQueueSubstitution = () => {
    if (!selectedOffPlayerId || !selectedOnPlayerId || !canQueueSubstitution) return;
    setPendingReplacements(current => [...current, { offPlayerId: selectedOffPlayerId, onPlayerId: selectedOnPlayerId }]);
    setSelectedOffPlayerId(null);
    setSelectedOnPlayerId(null);
  };
  const handleApplySubstitutions = () => {
    if (pendingReplacements.length === 0) return;
    const result = makeLiveSubstitutions(fixtureId, pendingReplacements);
    setLogs(current => [result.message, ...current].slice(0, 8));
    if (result.success) {
      setPendingReplacements([]);
      setSelectedOffPlayerId(null);
      setSelectedOnPlayerId(null);
    }
  };
  const handleLiveFormationSelect = (formation: Formation) => {
    if (!userTeamId) return;
    const result = setLiveMatchFormation(fixtureId, userTeamId, formation);
    setLogs(current => [result.message, ...current].slice(0, 8));
    setShowLiveFormationPicker(false);
  };

  return (
    <Screen scroll={false}>
      <View style={styles.topNav}>
          <TouchableOpacity onPress={handleExit} style={styles.exitBtn} accessibilityRole="button" accessibilityLabel="Exit match">
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
            <TouchableOpacity style={styles.btnSimulate} onPress={handleStart} accessibilityRole="button" accessibilityLabel="Kick off">
              <Text style={styles.btnText}>Kick Off</Text>
            </TouchableOpacity>
          )}
          {isPlaying && (
            <TouchableOpacity style={styles.btnPause} onPress={handlePause} accessibilityRole="button" accessibilityLabel="Pause and edit tactics">
              <Text style={styles.btnText}>Pause & Tactics</Text>
            </TouchableOpacity>
          )}
          {!isPlaying && !isHalfTime && !matchFinished && minute > 0 && minute < liveMatchEndMinute && (
            <TouchableOpacity style={styles.btnPause} onPress={() => setShowTactics(true)} accessibilityRole="button" accessibilityLabel="Open team management">
              <Text style={styles.btnText}>Team Management</Text>
            </TouchableOpacity>
          )}
          {!isPlaying && !isHalfTime && !matchFinished && minute > 0 && minute < liveMatchEndMinute && (
            <TouchableOpacity style={styles.btnSimulate} onPress={handleStart} accessibilityRole="button" accessibilityLabel="Resume match">
              <Text style={styles.btnText}>Resume</Text>
            </TouchableOpacity>
          )}
          {isHalfTime && (
            <View style={styles.halfTimeActions}>
              <TouchableOpacity style={styles.btnPause} onPress={() => setShowTactics(true)} accessibilityRole="button" accessibilityLabel="Open team management">
                <Text style={styles.btnText}>Team Management</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnSimulate} onPress={handleResumeHT} accessibilityRole="button" accessibilityLabel="Start second half">
                <Text style={styles.btnText}>Start Second Half</Text>
              </TouchableOpacity>
            </View>
          )}
          {matchFinished && (
            <TouchableOpacity style={styles.btnContinue} onPress={handleContinue} accessibilityRole="button" accessibilityLabel="Continue to next week">
              <Text style={styles.btnText}>Continue to Next Week</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <ModalSheet
        visible={showTactics}
        onClose={() => setShowTactics(false)}
        title="Pause & Tactics"
        variant="sheet"
        footer={
          <Button
            title={canResumeFromTactics ? 'Resume Match' : 'Back to Match'}
            variant="primary"
            onPress={handleResumeFromTactics}
            fullWidth
          />
        }
      >
        {canManageLiveTeam && (
          <View style={styles.liveControlPanel}>
            <View style={styles.liveControlHeader}>
              <View>
                <Text style={styles.liveControlTitle}>Live Team</Text>
                <Text style={styles.liveControlMeta}>
                  Subs {Math.max(0, maxSubs - usedSubs)} / {maxSubs} · Windows {remainingWindows} / {maxWindows}{isManagingHalfTime ? ' · Half-time window free' : ''}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.shapeButton}
                onPress={() => setShowLiveFormationPicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Change live formation"
              >
                <Text style={styles.shapeButtonText}>{liveFormation || myTeam?.activeFormation || 'Shape'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.subPickerGrid}>
              <View style={styles.subPickerCol}>
                <Text style={styles.subPickerTitle}>Off</Text>
                {manageableCurrentPlayers.map(player => (
                  <TouchableOpacity
                    key={player.id}
                    style={[styles.subPlayerRow, selectedOffPlayerId === player.id && styles.subPlayerSelected]}
                    onPress={() => setSelectedOffPlayerId(player.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedOffPlayerId === player.id }}
                  >
                    <Text style={styles.subPlayerName} numberOfLines={1}>{player.name}</Text>
                    <Text style={styles.subPlayerMeta}>{player.subPosition || player.position}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.subPickerCol}>
                <Text style={styles.subPickerTitle}>On</Text>
                {manageableBenchPlayers.map(player => (
                  <TouchableOpacity
                    key={player.id}
                    style={[styles.subPlayerRow, selectedOnPlayerId === player.id && styles.subPlayerSelected]}
                    onPress={() => setSelectedOnPlayerId(player.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedOnPlayerId === player.id }}
                  >
                    <Text style={styles.subPlayerName} numberOfLines={1}>{player.name}</Text>
                    <Text style={styles.subPlayerMeta}>{player.subPosition || player.position}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.pendingSubsBox}>
              {pendingReplacements.length === 0 ? (
                <Text style={styles.pendingSubText}>No pending substitutions</Text>
              ) : pendingReplacements.map((replacement, index) => (
                <Text key={`${replacement.offPlayerId}-${replacement.onPlayerId}`} style={styles.pendingSubText}>
                  {index + 1}. {players[replacement.offPlayerId]?.name} {'->'} {players[replacement.onPlayerId]?.name}
                </Text>
              ))}
            </View>
            <View style={styles.subActionRow}>
              <Button
                title="Queue Sub"
                variant="secondary"
                onPress={handleQueueSubstitution}
                disabled={!selectedOffPlayerId || !selectedOnPlayerId || !canQueueSubstitution}
              />
              <Button
                title="Apply Subs"
                variant="primary"
                onPress={handleApplySubstitutions}
                disabled={pendingReplacements.length === 0}
              />
            </View>
          </View>
        )}
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
      </ModalSheet>
      <FormationSelectionModal
        visible={showLiveFormationPicker}
        formations={SUPPORTED_FORMATIONS as Formation[]}
        selectedFormation={liveFormation || myTeam?.activeFormation || '4-3-3'}
        onClose={() => setShowLiveFormationPicker(false)}
        onSelect={handleLiveFormationSelect}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topNav: {
      paddingHorizontal: 20,
      paddingTop: 10,
      alignItems: 'flex-end',
  },
  exitBtn: {
      padding: 8,
  },
  exitText: {
      color: color.danger.base,
      fontWeight: 'bold',
      fontSize: 16,
  },
  scrollContent: {
      padding: 24,
      paddingTop: 10,
  },
  headerTitle: {
    color: color.text.primary,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  stadiumText: {
      color: color.text.faint,
      fontSize: 14,
      textAlign: 'center',
      fontWeight: '600',
      marginBottom: 12,
      letterSpacing: 1,
  },
  minuteClock: {
      color: color.danger.base,
      fontSize: 32,
      fontWeight: '900',
      textAlign: 'center',
      marginBottom: 20,
  },
  scoreboard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: color.bg.card,
    padding: 20,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: color.border.default,
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
    color: color.text.primary,
    fontSize: 42,
    fontWeight: '900',
  },
  vsBox: {
    paddingHorizontal: 16,
  },
  vsText: {
    color: color.text.faint,
    fontSize: 16,
    fontWeight: '900',
  },
  penaltiesNote: {
    color: color.warning.fg,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 12,
  },
  summaryPanel: {
    marginTop: 20,
    backgroundColor: color.bg.card,
    borderWidth: 1,
    borderColor: color.border.default,
    padding: 14,
  },
  summaryTitle: {
    color: color.text.primary,
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle,
  },
  statValue: {
    flex: 1,
    color: color.text.primary,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  statLabel: {
    flex: 2,
    color: color.text.muted,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  motmBox: {
    marginTop: 14,
    marginBottom: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.border.subtle,
  },
  motmName: {
    color: color.warning.fg,
    fontSize: 18,
    fontWeight: '900',
  },
  motmMeta: {
    color: color.text.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  ratingsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  ratingsCol: {
    flex: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: color.border.subtle,
  },
  ratingName: {
    flex: 1,
    color: color.text.secondary,
    fontSize: 11,
    fontWeight: '700',
  },
  ratingMeta: {
    color: color.text.primary,
    fontSize: 11,
    fontWeight: '900',
    minWidth: 32,
    textAlign: 'right',
  },
  logBox: {
    marginTop: 24,
    backgroundColor: color.bg.card,
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: color.border.default,
    minHeight: 120,
  },
  logText: {
    color: color.text.muted,
    fontSize: 12,
    marginBottom: 4,
  },
  logTextLatest: {
    color: color.accent.primary,
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
      color: color.text.secondary,
      fontSize: 12,
      marginBottom: 4,
  },
  buttonContainer: {
    marginTop: 48,
    paddingBottom: 40,
  },
  halfTimeActions: {
    gap: 12,
    alignItems: 'center',
  },
  btnSimulate: {
    backgroundColor: color.accent.primary,
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 0,
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 200,
  },
  btnPause: {
    backgroundColor: color.warning.base,
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 0,
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 200,
  },
  btnContinue: {
    backgroundColor: color.success.base,
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 0,
    alignItems: 'center',
    alignSelf: 'center',
    minWidth: 200,
  },
  btnText: {
    color: color.bg.screen,
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
  liveControlPanel: {
    borderWidth: 1,
    borderColor: color.border.default,
    backgroundColor: color.bg.card,
    padding: 12,
    marginBottom: 16,
  },
  liveControlHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  liveControlTitle: {
    color: color.text.primary,
    fontSize: 16,
    fontWeight: '900',
  },
  liveControlMeta: {
    color: color.text.muted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  shapeButton: {
    borderWidth: 1,
    borderColor: color.accent.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shapeButtonText: {
    color: color.accent.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  subPickerGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  subPickerCol: {
    flex: 1,
  },
  subPickerTitle: {
    color: color.text.primary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  subPlayerRow: {
    borderWidth: 1,
    borderColor: color.border.subtle,
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginBottom: 6,
  },
  subPlayerSelected: {
    borderColor: color.accent.primary,
    backgroundColor: color.accent.dim,
  },
  subPlayerName: {
    color: color.text.secondary,
    fontSize: 11,
    fontWeight: '800',
  },
  subPlayerMeta: {
    color: color.text.faint,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  pendingSubsBox: {
    marginTop: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: color.border.subtle,
  },
  pendingSubText: {
    color: color.text.muted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 3,
  },
  subActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
});

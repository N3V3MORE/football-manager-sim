import { MatchResultView } from '@/components/match/match-result-view';
import { MatchTeamManagement } from '@/components/match/match-team-management';
import { matchStyles as styles } from '@/components/match/match-styles';
import { useShallow } from 'zustand/react/shallow';
import { Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { getReadableTextColor } from '@/src/design/textContrast';
import { color } from '@/src/design/tokens';
import { useState, useEffect, useRef } from 'react';
import { getTeamTheme } from '@/src/constants/teamColors';
import { getPositionColor } from '@/src/constants/positionColors';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { Formation, TeamTactics } from '@/src/models/types';
import { TacticSection } from '@/components/squad/tactic-section';
import { FormationSelectionModal } from '@/components/squad/formation-selection-modal';
import { Screen, ModalSheet, Button, EmptyState } from '@/components/ui';
import { useConfirmStore } from '@/src/store/confirmStore';
import { SUPPORTED_FORMATIONS } from '@/src/constants/formations';
import * as Haptics from 'expo-haptics';
import { getDecisiveTieScore, resolveFirstLegId } from '@/src/core/matchTieResolution';

// B4: extend haptics beyond the tab bar. A light tick on primary match actions
// and a medium impact at full-time give the live sim some physical feedback.
// No-op on platforms without a haptic engine.
const tap = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
  if (process.env.EXPO_OS === 'ios' || process.env.EXPO_OS === 'android') {
    Haptics.impactAsync(style).catch(() => {});
  }
};

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

export default function MatchScreen() {
  const router = useRouter();
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  
  const fixture = useGameStore(state => state.fixtures[fixtureId]);
  const firstLeg = useGameStore(state => {
    const current = state.fixtures[fixtureId];
    const id = current ? resolveFirstLegId(current, state.fixtures) : null;
    return id ? state.fixtures[id] : undefined;
  });
  const liveMatchState = useGameStore(state => state.liveMatches?.[fixtureId]);
  const teams = useGameStore(useShallow(state => {
    const current = state.fixtures[fixtureId];
    const ids = [current?.homeTeamId, current?.awayTeamId, state.userTeamId].filter((id): id is string => Boolean(id));
    return Object.fromEntries(ids.map(id => [id, state.teams[id]]));
  }));
  const players = useGameStore(useShallow(state => {
    const current = state.fixtures[fixtureId];
    const takerIds = new Set(current?.penaltyShootout?.kicks.map(kick => kick.takerPlayerId) ?? []);
    return Object.fromEntries(Object.entries(state.players).filter(([, player]) => current && (player.teamId === current.homeTeamId || player.teamId === current.awayTeamId || takerIds.has(player.id))));
  }));
  const userTeamId = useGameStore(state => state.userTeamId);
  const setTactics = useGameStore(state => state.setTactics);
  const processMatchMinute = useGameStore(state => state.processMatchMinute);
  const finishLiveMatch = useGameStore(state => state.finishLiveMatch);
  const makeLiveSubstitutions = useGameStore(state => state.makeLiveSubstitutions);
  const setLiveMatchFormation = useGameStore(state => state.setLiveMatchFormation);
  const advanceWeek = useGameStore(state => state.advanceWeek);

  const liveProcessedMinutes = liveMatchState?.processedMinutes || [];
  const liveProcessedCount = liveProcessedMinutes.length;
  const liveProcessedMax = liveProcessedCount > 0 ? Math.max(...liveProcessedMinutes) : 0;
  const tieScore = fixture ? getDecisiveTieScore(fixture, firstLeg ? { [firstLeg.id]: firstLeg } : {}, firstLeg?.id ?? null) : null;
  const liveKnockoutNeedsExtraTime = Boolean(
    !fixture?.isPlayed && tieScore?.isDecisive &&
    (
      liveMatchState?.extraTimeStarted ||
      (liveProcessedMax >= 90 && tieScore.homeScore === tieScore.awayScore)
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

    const liveState = liveMatchState;
    const fixtureData = fixture;
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
  }, [fixtureId, restoreStateKey, isPlaying, liveMatchState, fixture, liveMatchEndMinute]);

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
        const latestTieScore = latestFixture ? getDecisiveTieScore(latestFixture, useGameStore.getState().fixtures) : null;
        const needsExtraTime = Boolean(
          !latestFixture?.isPlayed && latestTieScore?.isDecisive &&
          nextMin === 90 &&
          latestTieScore.homeScore === latestTieScore.awayScore
        );
        if (latestFixture?.isPlayed) {
          setMatchFinished(true);
          setIsPlaying(false);
        } else if (nextMin === 45) {
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

  if (!fixture || !teams[fixture.homeTeamId] || !teams[fixture.awayTeamId]) return (
    <Screen scroll={false}>
      <EmptyState title="Match unavailable" message="This fixture could not be found. Return to the Hub to choose your next match.">
        <Button title="Back to Hub" onPress={() => router.replace('/(tabs)')} />
      </EmptyState>
    </Screen>
  );

  const homeTeam = teams[fixture.homeTeamId];
  const awayTeam = teams[fixture.awayTeamId];

  if (fixture.isPlayed) return <MatchResultView fixture={fixture} teams={teams} players={players} onExit={() => router.back()} onContinue={handleContinue} />;

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

  const handleStart = () => { tap(); setPendingReplacements([]); setIsPlaying(true); };
  const handlePause = () => { tap(); setIsPlaying(false); setShowTactics(true); };
  const handleResumeHT = () => { tap(); setPendingReplacements([]); setIsHalfTime(false); setIsPlaying(true); };
  const canResumeFromTactics = !isHalfTime && !matchFinished && minute > 0 && minute < liveMatchEndMinute;
  const handleResumeFromTactics = () => {
    setPendingReplacements([]);
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
          setIsPlaying(false);
          finishLiveMatch(fixtureId);
          router.back();
        },
      });
      return;
    }
    router.back();
  };

  const currentFixture = fixture;

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
            <Text style={[styles.teamName, { color: getReadableTextColor(homeTheme.primary, color.bg.card) }]}>{homeTeam.name}</Text>
            <Text style={styles.score}>
                {minute > 0 || currentFixture.isPlayed ? currentFixture.homeScore : '-'}
            </Text>
          </View>
          <View style={styles.vsBox}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          <View style={styles.teamBox}>
            <Text style={[styles.teamName, { color: getReadableTextColor(awayPrimary, color.bg.card) }]}>{awayTeam.name}</Text>
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
                <Text style={[styles.lineupHeader, { color: getReadableTextColor(homeTheme.primary, color.bg.screen) }]}>Home XI</Text>
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
                <Text style={[styles.lineupHeader, { color: getReadableTextColor(awayPrimary, color.bg.screen), textAlign: 'right' }]}>Away XI</Text>
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
          <MatchTeamManagement
            remainingSubs={Math.max(0, maxSubs - usedSubs)} maxSubs={maxSubs}
            remainingWindows={remainingWindows} maxWindows={maxWindows} isManagingHalfTime={isManagingHalfTime}
            formationLabel={liveFormation || myTeam?.activeFormation || 'Shape'}
            manageableCurrentPlayers={manageableCurrentPlayers} manageableBenchPlayers={manageableBenchPlayers}
            selectedOffPlayerId={selectedOffPlayerId} selectedOnPlayerId={selectedOnPlayerId}
            pendingReplacements={pendingReplacements.map(replacement => ({ ...replacement,
              offName: players[replacement.offPlayerId]?.name, onName: players[replacement.onPlayerId]?.name }))}
            canQueueSubstitution={canQueueSubstitution}
            onSelectOff={setSelectedOffPlayerId} onSelectOn={setSelectedOnPlayerId}
            onOpenFormation={() => setShowLiveFormationPicker(true)}
            onQueue={handleQueueSubstitution} onApply={handleApplySubstitutions}
          />
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

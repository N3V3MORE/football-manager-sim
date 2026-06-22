import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CurrentTeamCard } from '@/components/settings/current-team-card';
import { AvailabilityWatchCard } from '@/components/settings/availability-watch-card';
import { ContractWatchCard } from '@/components/settings/contract-watch-card';
import { DevToolsCard } from '@/components/settings/dev-tools-card';
import { TeamSelectionSheet } from '@/components/settings/team-selection-sheet';
import { useGameStore } from '@/src/store/gameStore';
import { sortTeamsByDivisionAndName } from '@/src/core/leagueUtils';
import { isContractExpiringSoon, isPlayerInjured, isPlayerUnavailable } from '@/src/core/playerStatusUtils';


export default function SettingsScreen() {
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const players = useGameStore(state => state.players);
  const advanceWeek = useGameStore(state => state.advanceWeek);
  const skipToEndOfSeason = useGameStore(state => state.skipToEndOfSeason);
  const clearStuckLiveMatches = useGameStore(state => state.clearStuckLiveMatches);
  const changeTeam = useGameStore(state => state.changeTeam);
  const initializeGame = useGameStore(state => state.initializeGame);
  const renewPlayerContract = useGameStore(state => state.renewPlayerContract);

  const [showChangeTeam, setShowChangeTeam] = useState(false);

  const userTeam = userTeamId ? teams[userTeamId] : null;
  const sortedTeams = useMemo(
    () => sortTeamsByDivisionAndName(Object.values(teams).filter(team => !team.isExternal)),
    [teams]
  );
  const userSquad = useMemo(
    () => userTeamId ? Object.values(players).filter(player => player.teamId === userTeamId) : [],
    [players, userTeamId]
  );
  const injuredCount = useMemo(
    () => userSquad.filter(player => isPlayerInjured(player)).length,
    [userSquad]
  );
  const expiringCount = useMemo(
    () => userSquad.filter(player => isContractExpiringSoon(player)).length,
    [userSquad]
  );
  const expiringPlayers = useMemo(
    () => userSquad.filter(player => isContractExpiringSoon(player)),
    [userSquad]
  );
  const unavailablePlayers = useMemo(
    () => userSquad.filter(player => isPlayerUnavailable(player)),
    [userSquad]
  );


  const advanceWeeks = useCallback((count: number) => {
    for (let i = 0; i < count; i++) {
      advanceWeek();
    }
  }, [advanceWeek]);



  const handleResetSeason = () => {
    if (!userTeamId) return;
    initializeGame(userTeamId);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Club controls and squad status</Text>
        </View>

        <CurrentTeamCard
          team={userTeam}
          injuredCount={injuredCount}
          expiringCount={expiringCount}
          onChangeTeam={() => setShowChangeTeam(true)}
          showChangeTeamButton={__DEV__}
        />

        <ContractWatchCard
          players={expiringPlayers}
          team={userTeam}
          onRenew={renewPlayerContract}
        />

        <AvailabilityWatchCard players={unavailablePlayers} />

        {__DEV__ ? (
          <DevToolsCard
            onAdvanceFiveWeeks={() => advanceWeeks(5)}
            onSkipSeason={skipToEndOfSeason}
            onClearStuckLiveMatch={clearStuckLiveMatches}
            onResetSeason={handleResetSeason}
          />
        ) : null}
      </ScrollView>

      {__DEV__ && (
        <TeamSelectionSheet
          visible={showChangeTeam}
          teams={sortedTeams}
          currentTeamId={userTeamId}
          onClose={() => setShowChangeTeam(false)}
          onSelect={(teamId) => {
            const targetTeam = sortedTeams.find(t => t.id === teamId);
            if (!targetTeam) return;
            if (teamId === userTeamId) {
              setShowChangeTeam(false);
              return;
            }
            Alert.alert(
              'Switch Teams',
              `Are you sure you want to leave ${userTeam?.name ?? 'your current club'} and take control of ${targetTeam.name} (${targetTeam.division})?\n\nThis will be recorded as a career event and your manager identity will follow you.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Switch',
                  style: 'destructive',
                  onPress: () => {
                    changeTeam(teamId);
                    setShowChangeTeam(false);
                  },
                },
              ]
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '900', color: '#f8fafc' },
  subtitle: { color: '#64748b', fontSize: 13, marginTop: 2, fontWeight: '600' },
});

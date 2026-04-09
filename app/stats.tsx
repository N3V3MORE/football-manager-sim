import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { useEffect, useMemo, useState } from 'react';
import { Player } from '@/src/models/types';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageHeader } from '@/components/ui/page-header';
import { getPlayerStatValueForScope, getRankedPlayersForScope, resolveStatsView } from '@/src/features/stats/statSelectors';
import { getUserLeagueId } from '@/src/features/world/worldSelectors';

type PlayerStatKey = 'goals' | 'assists' | 'cleanSheets' | 'yellowCards' | 'redCards';

export default function StatsScreen() {
  const players = useGameStore(state => state.players);
  const teams = useGameStore(state => state.teams);
  const userTeamId = useGameStore(state => state.userTeamId);
  const season = useGameStore(state => state.season);
  const seasonResults = useGameStore(state => state.seasonResults);
  const [expandedPane, setExpandedPane] = useState<string | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);

  const userLeagueId = getUserLeagueId(teams, userTeamId);
  const previousLeagueId = seasonResults[0]?.leagueId;
  const statsView = useMemo(() => resolveStatsView({
    players,
    currentLeagueId: userLeagueId,
    previousLeagueId,
  }), [players, previousLeagueId, userLeagueId]);

  useEffect(() => {
    if (!statsView.defaultScopeId) {
      setSelectedScopeId(null);
      return;
    }
    if (!selectedScopeId || !statsView.scopeOptions.some(option => option.id === selectedScopeId)) {
      setSelectedScopeId(statsView.defaultScopeId);
    }
  }, [selectedScopeId, statsView.defaultScopeId, statsView.scopeOptions]);

  const activeScopeId = selectedScopeId || statsView.defaultScopeId;
  const allPlayers = Object.values(players);
  const activeScopeLabel = statsView.scopeOptions.find(option => option.id === activeScopeId)?.label || 'Stats';
  const seasonSubtitle = statsView.dataset === 'current'
    ? `Season ${season}`
    : `Season ${Math.max(1, season - 1)} completed`;

  const topScorers = activeScopeId
    ? getRankedPlayersForScope(allPlayers, activeScopeId, 'goals', statsView.dataset, { limit: 10 })
    : [];

  const topAssisters = activeScopeId
    ? getRankedPlayersForScope(allPlayers, activeScopeId, 'assists', statsView.dataset, { limit: 10 })
    : [];

  const topCleanSheets = activeScopeId
    ? getRankedPlayersForScope(allPlayers, activeScopeId, 'cleanSheets', statsView.dataset, {
        limit: 10,
        filter: player => player.position === 'GK',
      })
    : [];

  const topYellowCards = activeScopeId
    ? getRankedPlayersForScope(allPlayers, activeScopeId, 'yellowCards', statsView.dataset, { limit: 10 })
    : [];

  const topRedCards = activeScopeId
    ? getRankedPlayersForScope(allPlayers, activeScopeId, 'redCards', statsView.dataset, { limit: 10 })
    : [];

  const getStatValue = (item: Player, stat: PlayerStatKey) => {
    if (!activeScopeId) return 0;
    switch (stat) {
      case 'goals': return getPlayerStatValueForScope(item, activeScopeId, 'goals', statsView.dataset);
      case 'assists': return getPlayerStatValueForScope(item, activeScopeId, 'assists', statsView.dataset);
      case 'cleanSheets': return getPlayerStatValueForScope(item, activeScopeId, 'cleanSheets', statsView.dataset);
      case 'yellowCards': return getPlayerStatValueForScope(item, activeScopeId, 'yellowCards', statsView.dataset);
      case 'redCards': return getPlayerStatValueForScope(item, activeScopeId, 'redCards', statsView.dataset);
      default: return 0;
    }
  };

  const renderPlayerStat = (item: Player, stat: PlayerStatKey, index: number) => {
    const team = teams[item.teamId];
    return (
      <View key={item.id} style={styles.row}>
        <Text style={styles.rank}>{index + 1}.</Text>
        <View style={styles.playerInfo}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.teamName}>{team ? team.name : 'Unknown'}</Text>
        </View>
        <Text style={[styles.statValue, stat === 'redCards' && { color: '#ef4444' }, stat === 'yellowCards' && { color: '#F59E0B' }]}>{getStatValue(item, stat)}</Text>
      </View>
    );
  };

  const renderPane = (title: string, id: string, data: Player[], type: PlayerStatKey) => {
      const isExpanded = expandedPane === id;
      const displayData = isExpanded ? data : data.slice(0, 3);
      
      return (
          <TouchableOpacity 
              style={styles.card} 
              activeOpacity={0.8}
              onPress={() => setExpandedPane(isExpanded ? null : id)}
          >
              <View style={styles.paneHeaderRow}>
                  <Text style={styles.cardTitle}>{title}</Text>
                  <Text style={styles.expandText}>{isExpanded ? 'Collapse' : 'Expand'}</Text>
              </View>
              {data.length > 0 ? (
                  displayData.map((p, i) => renderPlayerStat(p, type, i))
              ) : (
                  <Text style={styles.emptyText}>No stats recorded yet.</Text>
              )}
          </TouchableOpacity>
      )
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHeader title={`${activeScopeLabel} Stats`} subtitle={seasonSubtitle} backLabel="< Hub" onBack={() => router.replace('/')} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.scopeRow}>
          {statsView.scopeOptions.map(option => {
            const isActive = option.id === activeScopeId;
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.scopeChip, isActive && styles.scopeChipActive]}
                onPress={() => setSelectedScopeId(option.id)}
              >
                <Text style={[styles.scopeChipText, isActive && styles.scopeChipTextActive]}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {renderPane('Golden Boot', 'goals', topScorers, 'goals')}
        {renderPane('Playmaker of the Season', 'assists', topAssisters, 'assists')}
        {renderPane('Golden Glove', 'cleanSheets', topCleanSheets, 'cleanSheets')}
        {renderPane('Yellow Cards', 'yellow', topYellowCards, 'yellowCards')}
        {renderPane('Red Cards', 'red', topRedCards, 'redCards')}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scroll: { paddingHorizontal: 16, paddingBottom: 16 },
  scopeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 6 },
  scopeChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  scopeChipActive: { backgroundColor: '#38bdf8', borderColor: '#38bdf8' },
  scopeChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '800' },
  scopeChipTextActive: { color: '#0f172a' },
  card: {
    backgroundColor: '#1e293b',
    marginTop: 10,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#e2e8f0',
  },
  paneHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: '#334155',
      paddingBottom: 8,
      marginBottom: 12,
  },
  expandText: {
      color: '#38bdf8',
      fontSize: 12,
      fontWeight: 'bold',
  },
  emptyText: {
    color: '#64748b',
    fontStyle: 'italic',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  rank: {
    width: 30,
    fontSize: 18,
    fontWeight: '900',
    color: '#94a3b8',
  },
  playerInfo: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  teamName: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '600',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#38bdf8',
    width: 40,
    textAlign: 'center',
  },
});

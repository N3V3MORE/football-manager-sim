import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { useState } from 'react';
import { Player } from '@/src/models/types';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageHeader } from '@/components/ui/page-header';

type PlayerStatKey = 'goals' | 'assists' | 'cleanSheets' | 'yellowCards' | 'redCards';

export default function StatsScreen() {
  const players = useGameStore(state => state.players);
  const teams = useGameStore(state => state.teams);
  const [expandedPane, setExpandedPane] = useState<string | null>(null);

  const allPlayers = Object.values(players);

  const topScorers = [...allPlayers]
    .filter(p => p.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.overallRating - a.overallRating)
    .slice(0, 10);

  const topAssisters = [...allPlayers]
    .filter(p => p.assists > 0)
    .sort((a, b) => b.assists - a.assists || b.overallRating - a.overallRating)
    .slice(0, 10);

  const topCleanSheets = [...allPlayers]
    .filter(p => p.position === 'GK' && p.cleanSheets && p.cleanSheets > 0)
    .sort((a, b) => b.cleanSheets - a.cleanSheets || b.overallRating - a.overallRating)
    .slice(0, 10);

  const topYellowCards = [...allPlayers]
    .filter(p => p.yellowCards && p.yellowCards > 0)
    .sort((a, b) => b.yellowCards - a.yellowCards || b.overallRating - a.overallRating)
    .slice(0, 10);

  const topRedCards = [...allPlayers]
    .filter(p => p.redCards && p.redCards > 0)
    .sort((a, b) => b.redCards - a.redCards || b.overallRating - a.overallRating)
    .slice(0, 10);

  const getStatValue = (item: Player, stat: PlayerStatKey) => {
    switch (stat) {
      case 'goals': return item.goals;
      case 'assists': return item.assists;
      case 'cleanSheets': return item.cleanSheets;
      case 'yellowCards': return item.yellowCards;
      case 'redCards': return item.redCards;
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
      <PageHeader title="League Stats" backLabel="< Hub" onBack={() => router.replace('/')} />

      <ScrollView contentContainerStyle={styles.scroll}>
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

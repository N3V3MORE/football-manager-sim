import { StyleSheet, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { useMemo, useState } from 'react';
import { Player } from '@/src/models/types';
import { StatsLeaderboardCard, StatsLeaderboardRow } from '@/components/stats/stats-leaderboard-card';
import { Screen } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { color, space } from '@/src/design/tokens';

type PlayerStatKey = 'goals' | 'assists' | 'cleanSheets' | 'yellowCards' | 'redCards';
type PaneConfig = {
  title: string;
  stat: PlayerStatKey;
  rows: StatsLeaderboardRow[];
  valueColor?: string;
};

const getStatValue = (player: Player, stat: PlayerStatKey): number => {
  switch (stat) {
    case 'goals':
      return player.goals;
    case 'assists':
      return player.assists;
    case 'cleanSheets':
      return player.cleanSheets;
    case 'yellowCards':
      return player.yellowCards;
    case 'redCards':
      return player.redCards;
    default:
      return 0;
  }
};

const buildLeaderboard = (
  allPlayers: Player[],
  stat: PlayerStatKey,
  filter?: (player: Player) => boolean
): Player[] => (
  [...allPlayers]
    .filter(player => (!filter || filter(player)) && getStatValue(player, stat) > 0)
    .sort((a, b) => getStatValue(b, stat) - getStatValue(a, stat) || b.overallRating - a.overallRating)
    .slice(0, 10)
);

const toLeaderboardRows = (
  items: Player[],
  teams: ReturnType<typeof useGameStore.getState>['teams'],
  stat: PlayerStatKey
): StatsLeaderboardRow[] => (
  items.map((player) => ({
    id: player.id,
    name: player.name,
    teamName: teams[player.teamId]?.name || 'Unknown',
    value: getStatValue(player, stat),
  }))
);

export default function StatsScreen() {
  const userTeamId = useGameStore(state => state.userTeamId);
  const players = useGameStore(state => state.players);
  const teams = useGameStore(state => state.teams);
  const [expandedPane, setExpandedPane] = useState<PlayerStatKey | null>(null);

  const userTeam = userTeamId ? teams[userTeamId] : null;
  const allPlayers = useMemo(() => Object.values(players).filter(player => {
    if (!userTeam) return false;
    const playerTeam = teams[player.teamId];
    return playerTeam && playerTeam.division === userTeam.division;
  }), [players, teams, userTeam]);
  const topScorers = useMemo(() => buildLeaderboard(allPlayers, 'goals'), [allPlayers]);
  const topAssisters = useMemo(() => buildLeaderboard(allPlayers, 'assists'), [allPlayers]);
  const topCleanSheets = useMemo(
    () => buildLeaderboard(allPlayers, 'cleanSheets', player => player.position === 'GK'),
    [allPlayers]
  );
  const topYellowCards = useMemo(() => buildLeaderboard(allPlayers, 'yellowCards'), [allPlayers]);
  const topRedCards = useMemo(() => buildLeaderboard(allPlayers, 'redCards'), [allPlayers]);

  const paneConfigs = useMemo<PaneConfig[]>(() => ([
    { title: 'Golden Boot', stat: 'goals', rows: toLeaderboardRows(topScorers, teams, 'goals') },
    { title: 'Playmaker of the Season', stat: 'assists', rows: toLeaderboardRows(topAssisters, teams, 'assists') },
    { title: 'Golden Glove', stat: 'cleanSheets', rows: toLeaderboardRows(topCleanSheets, teams, 'cleanSheets') },
    { title: 'Yellow Cards', stat: 'yellowCards', rows: toLeaderboardRows(topYellowCards, teams, 'yellowCards'), valueColor: color.warning.base },
    { title: 'Red Cards', stat: 'redCards', rows: toLeaderboardRows(topRedCards, teams, 'redCards'), valueColor: color.danger.base },
  ]), [teams, topAssisters, topCleanSheets, topRedCards, topScorers, topYellowCards]);

  return (
    <Screen scroll={false}>
      <PageHeader title="All-Competition Stats" backLabel="< Hub" onBack={() => router.replace('/')} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {paneConfigs.map((pane) => {
          const isExpanded = expandedPane === pane.stat;

          return (
            <StatsLeaderboardCard
              key={pane.stat}
              title={pane.title}
              rows={pane.rows}
              isExpanded={isExpanded}
              valueColor={pane.valueColor}
              onToggle={() => setExpandedPane(isExpanded ? null : pane.stat)}
            />
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.lg },
});

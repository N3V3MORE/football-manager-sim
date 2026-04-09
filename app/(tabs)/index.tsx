import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { useRouter } from 'expo-router';
import { BoardRoomCard } from '@/components/hub/board-room-card';
import { getTeamTheme } from '@/src/constants/teamColors';
import { LatestNewsCard } from '@/components/hub/latest-news-card';
import { getSeasonWeekLimit, sortTeamsByTable } from '@/src/core/leagueUtils';
import { Fixture, Player, Team } from '@/src/models/types';
import { HubHeader } from '@/components/hub/hub-header';
import { MiniTableCard } from '@/components/hub/mini-table-card';
import { NextFixtureCard } from '@/components/hub/next-fixture-card';
import { SeasonStatsCard } from '@/components/hub/season-stats-card';
import { UpcomingFixtureCardRow, UpcomingFixturesCard } from '@/components/hub/upcoming-fixtures-card';

// Week 1 = Aug 10 2024. Each week adds 7 days.
const SEASON_START = new Date(2024, 7, 10);

type UpcomingFixtureRow = {
  week: number;
  match: Fixture | undefined;
};

type MiniTableTeam = Team & {
  position: number;
};

const weekToDate = (week: number): string => {
  const d = new Date(SEASON_START);
  d.setDate(d.getDate() + (week - 1) * 7);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const getStatValue = (player: Player, stat: 'goals' | 'assists' | 'cleanSheets'): number => {
  if (stat === 'goals') return player.goals;
  if (stat === 'assists') return player.assists;
  return player.cleanSheets || 0;
};

const getTopPlayerByStat = (allPlayers: Player[], stat: 'goals' | 'assists' | 'cleanSheets'): Player | undefined => (
  [...allPlayers]
    .filter(player => getStatValue(player, stat) > 0)
    .sort((a, b) => getStatValue(b, stat) - getStatValue(a, stat))[0]
);

export default function HubScreen() {
  const router = useRouter();
  const currentWeek = useGameStore(state => state.currentWeek);
  const userTeamId = useGameStore(state => state.userTeamId);
  const teams = useGameStore(state => state.teams);
  const fixtures = useGameStore(state => state.fixtures);
  const advanceWeek = useGameStore(state => state.advanceWeek);
  const news = useGameStore(state => state.news);
  const players = useGameStore(state => state.players);

  const myTeam = userTeamId ? teams[userTeamId] : null;
  const myDivision = myTeam?.division ?? 'Premier League';
  const myTheme = myTeam ? getTeamTheme(myTeam.name) : null;

  const fixtureList = useMemo(() => Object.values(fixtures), [fixtures]);
  const weekFixtures = useMemo(
    () => fixtureList.filter(fixture => fixture.week === currentWeek),
    [fixtureList, currentWeek]
  );

  const myNextMatch = useMemo(
    () => weekFixtures.find(fixture => fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId),
    [weekFixtures, userTeamId]
  );

  const homeTeam = myNextMatch ? teams[myNextMatch.homeTeamId] ?? null : null;
  const awayTeam = myNextMatch ? teams[myNextMatch.awayTeamId] ?? null : null;
  const homeTheme = homeTeam ? getTeamTheme(homeTeam.name) : null;

  const handlePlayMatch = useCallback(() => {
    if (!myNextMatch) {
      advanceWeek();
      return;
    }
    router.push({ pathname: '/match', params: { fixtureId: myNextMatch.id } });
  }, [advanceWeek, myNextMatch, router]);

  const miniTableData = useMemo(() => {
    const sortedTeams = sortTeamsByTable(Object.values(teams).filter(team => team.division === myDivision));
    if (sortedTeams.length === 0) {
      return { rows: [] as MiniTableTeam[], myPosition: 0 };
    }

    const myIndex = sortedTeams.findIndex(team => team.id === userTeamId);
    const normalizedIndex = myIndex >= 0 ? myIndex : 0;

    let startIdx = Math.max(0, normalizedIndex - 3);
    let endIdx = Math.min(sortedTeams.length - 1, normalizedIndex + 3);
    if (normalizedIndex < 3) {
      endIdx = Math.min(sortedTeams.length - 1, 6);
    } else if (normalizedIndex > sortedTeams.length - 4) {
      startIdx = Math.max(0, sortedTeams.length - 7);
    }

    const rows = sortedTeams.slice(startIdx, endIdx + 1).map((team, index) => ({
      ...team,
      position: startIdx + index + 1,
    }));

    return { rows, myPosition: normalizedIndex + 1 };
  }, [teams, myDivision, userTeamId]);

  const seasonWeekLimit = useMemo(() => getSeasonWeekLimit(fixtures), [fixtures]);
  const upcomingFixtures = useMemo<UpcomingFixtureRow[]>(() => {
    const rows: UpcomingFixtureRow[] = [];
    for (let week = currentWeek; week <= Math.min(currentWeek + 4, seasonWeekLimit); week++) {
      const match = fixtureList.find(
        fixture => fixture.week === week && (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
      );
      rows.push({ week, match });
    }
    return rows;
  }, [currentWeek, fixtureList, seasonWeekLimit, userTeamId]);

  const upcomingFixtureRows = useMemo<UpcomingFixtureCardRow[]>(() => (
    upcomingFixtures.map(({ week, match }) => {
      const opponentId = match
        ? (match.homeTeamId === userTeamId ? match.awayTeamId : match.homeTeamId)
        : null;
      const opponent = opponentId ? teams[opponentId] : null;
      const opponentTheme = opponent ? getTeamTheme(opponent.name) : null;
      const isHome = match?.homeTeamId === userTeamId;

      return {
        week,
        dateLabel: weekToDate(week),
        isCurrentWeek: week === currentWeek,
        isHome: !!isHome,
        opponentName: opponent?.name || null,
        opponentPrimary: opponentTheme?.primary,
        opponentSecondary: opponentTheme?.secondary,
        score: match && match.isPlayed
          ? (isHome ? `${match.homeScore}-${match.awayScore}` : `${match.awayScore}-${match.homeScore}`)
          : null,
      };
    })
  ), [currentWeek, upcomingFixtures, teams, userTeamId]);

  const allPlayers = useMemo(() => Object.values(players), [players]);
  const topScorer = useMemo(() => getTopPlayerByStat(allPlayers, 'goals'), [allPlayers]);
  const topAssister = useMemo(() => getTopPlayerByStat(allPlayers, 'assists'), [allPlayers]);
  const topCS = useMemo(() => getTopPlayerByStat(allPlayers, 'cleanSheets'), [allPlayers]);

  const seasonLeaders = useMemo(() => ([
    { label: 'Top Scorer', player: topScorer, stat: topScorer ? `${topScorer.goals} goals` : 'None yet' },
    { label: 'Top Assister', player: topAssister, stat: topAssister ? `${topAssister.assists} assists` : 'None yet' },
    { label: 'Clean Sheets', player: topCS, stat: topCS ? `${topCS.cleanSheets} clean sheets` : 'None yet' },
  ]), [topAssister, topCS, topScorer]);

  if (!myTeam || !myTheme) return <View style={styles.container}><Text style={{ color: '#fff', margin: 20 }}>Loading...</Text></View>;

  const myPosition = miniTableData.myPosition;
  const myRecord = `${myTeam.wins}W ${myTeam.draws}D ${myTeam.losses}L`;
  const nextFixtureLabel = `${homeTheme?.stadium || 'TBD'} | ${weekToDate(currentWeek)}`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <HubHeader
          team={myTeam}
          theme={myTheme}
          position={myPosition}
          record={myRecord}
          currentWeek={currentWeek}
          weekLabel={weekToDate(currentWeek)}
        />

        <LatestNewsCard news={news} />

        <NextFixtureCard
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          userTeamId={userTeamId}
          subLabel={nextFixtureLabel}
          onPress={handlePlayMatch}
        />

        <UpcomingFixturesCard rows={upcomingFixtureRows} onPress={() => router.push('/calendar')} />

        <BoardRoomCard
          boardApproval={myTeam.boardApproval}
          managerName={myTeam.manager.name}
          onPress={() => router.push('/board')}
        />

        <MiniTableCard
          title={myDivision}
          rows={miniTableData.rows}
          userTeamId={userTeamId}
          onPress={() => router.push('/league')}
        />

        <SeasonStatsCard leaders={seasonLeaders} onPress={() => router.push('/stats')} />

        <View style={{ height: 40 }} />
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0f1e' },
});

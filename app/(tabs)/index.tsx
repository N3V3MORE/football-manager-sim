import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { useRouter } from 'expo-router';
import { BoardRoomCard } from '@/components/hub/board-room-card';
import { CareerStatsCard } from '@/components/hub/career-stats-card';
import { getTeamTheme } from '@/src/constants/teamColors';
import { getSeasonWeekLimit, sortTeamsByTable } from '@/src/core/leagueUtils';
import { getCompetitionPanelForTeam, getCompetitionShortName } from '@/src/core/competitionEngine';
import { formatShortDate } from '@/src/utils/calendar';
import { Fixture, Player, Team } from '@/src/models/types';
import { HubHeader } from '@/components/hub/hub-header';
import { MiniTableCard } from '@/components/hub/mini-table-card';
import { NextFixtureCard } from '@/components/hub/next-fixture-card';
import { SeasonStatsCard } from '@/components/hub/season-stats-card';
import { LatestNewsCard } from '@/components/hub/latest-news-card';
import { CompetitionPanelsCard } from '@/components/hub/competition-panels-card';
import { UpcomingFixturesCard, UpcomingFixtureCardRow } from '@/components/hub/upcoming-fixtures-card';
import { Ionicons } from '@expo/vector-icons';

type UpcomingFixtureRow = {
  week: number;
  match: Fixture | undefined;
};

type MiniTableTeam = Team & {
  position: number;
};

type CompetitionPanelItem = {
  title: string;
  status: string;
  note: string;
  accent: string;
};

const weekToDate = (week: number): string => formatShortDate(week);

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
  const competitions = useGameStore(state => state.competitions);
  const advanceWeek = useGameStore(state => state.advanceWeek);
  const playMatch = useGameStore(state => state.playMatch);
  const inboxMessages = useGameStore(state => state.inboxMessages);
  const players = useGameStore(state => state.players);
  const news = useGameStore(state => state.news);
  const careerRecord = useGameStore(state => state.careerRecord);

  const myTeam = userTeamId ? teams[userTeamId] : null;
  const myDivision = myTeam?.division ?? 'Premier League';
  const myTheme = myTeam ? getTeamTheme(myTeam.name) : null;

  const fixtureList = useMemo(() => Object.values(fixtures), [fixtures]);
  const weekFixtures = useMemo(
    () => fixtureList.filter(fixture => fixture.week === currentWeek),
    [fixtureList, currentWeek]
  );

  const myNextMatch = useMemo(
    () => weekFixtures.find(fixture =>
      !fixture.isPlayed &&
      (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId)
    ),
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

  const handleQuickSim = useCallback(() => {
    if (!myNextMatch) return;
    playMatch(myNextMatch.id);
    advanceWeek();
  }, [advanceWeek, myNextMatch, playMatch]);

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

  const seasonWeekLimit = useMemo(() => getSeasonWeekLimit(fixtures, competitions), [competitions, fixtures]);
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

  const allPlayers = useMemo(() => {
    return Object.values(players).filter(player => {
      const playerTeam = teams[player.teamId];
      return playerTeam && playerTeam.division === myDivision;
    });
  }, [players, teams, myDivision]);
  const topScorer = useMemo(() => getTopPlayerByStat(allPlayers, 'goals'), [allPlayers]);
  const topAssister = useMemo(() => getTopPlayerByStat(allPlayers, 'assists'), [allPlayers]);
  const topCS = useMemo(
    () => getTopPlayerByStat(allPlayers.filter(player => player.position === 'GK'), 'cleanSheets'),
    [allPlayers]
  );
  const unreadInboxCount = useMemo(
    () => inboxMessages.filter(message => !message.isRead).length,
    [inboxMessages]
  );


  const seasonLeaders = useMemo(() => ([
    { label: 'Top Scorer', player: topScorer, stat: topScorer ? `${topScorer.goals} goals` : 'None yet' },
    { label: 'Top Assister', player: topAssister, stat: topAssister ? `${topAssister.assists} assists` : 'None yet' },
    { label: 'Clean Sheets', player: topCS, stat: topCS ? `${topCS.cleanSheets} clean sheets` : 'None yet' },
  ]), [topAssister, topCS, topScorer]);

  if (!myTeam || !myTheme) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Between Jobs</Text>
          <Text style={styles.emptyCopy}>
            You are not currently attached to a club. Check your inbox for job offers and season updates.
          </Text>
          <LatestNewsCard news={news} />
          {careerRecord.seasonsManaged > 0 ? (
            <CareerStatsCard careerRecord={careerRecord} onPress={() => router.push('/board')} />
          ) : null}
          <TouchableOpacity
            style={styles.emptyInboxButton}
            onPress={() => router.push('/inbox')}
            activeOpacity={0.8}
          >
            <Ionicons name="mail" size={18} color="#0f172a" />
            <Text style={styles.emptyInboxText}>
              Open Inbox{unreadInboxCount > 0 ? ` (${unreadInboxCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const myPosition = miniTableData.myPosition;
  const myRecord = `${myTeam.wins}W ${myTeam.draws}D ${myTeam.losses}L`;
  const nextFixtureLabel = `${myNextMatch ? getCompetitionShortName(myNextMatch.competitionId) : 'Matchday'} | ${homeTheme?.stadium || 'TBD'} | ${weekToDate(currentWeek)}`;
  const competitionPanels = [
    getCompetitionPanelForTeam('carabao-cup', competitions, fixtures, teams, myTeam.id, currentWeek),
    getCompetitionPanelForTeam('fa-cup', competitions, fixtures, teams, myTeam.id, currentWeek),
    getCompetitionPanelForTeam('europe', competitions, fixtures, teams, myTeam.id, currentWeek),
  ] as CompetitionPanelItem[];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={{ flex: 1 }}>
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
            onQuickSim={handleQuickSim}
          />

          <MiniTableCard
            title={myDivision}
            rows={miniTableData.rows}
            userTeamId={userTeamId}
            onPress={() => router.push('/league')}
          />

          <CompetitionPanelsCard items={competitionPanels} />

          <UpcomingFixturesCard rows={upcomingFixtureRows} onPress={() => router.push('/calendar')} />

          <SeasonStatsCard leaders={seasonLeaders} onPress={() => router.push('/stats')} />

          <BoardRoomCard
            boardApproval={myTeam.boardApproval}
            managerName={myTeam.manager.name}
            onPress={() => router.push('/board')}
          />

          {careerRecord && careerRecord.seasonsManaged > 0 && (
            <CareerStatsCard
              careerRecord={careerRecord}
              onPress={() => router.push('/board')}
            />
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        <TouchableOpacity 
          style={styles.floatingInbox}
          onPress={() => router.push('/inbox')}
          activeOpacity={0.8}
        >
          <Ionicons name="mail" size={22} color="#facc15" />
          {unreadInboxCount > 0 && <View style={styles.unreadDot} />}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0f1e' },
  emptyState: {
    flex: 1,
    padding: 20,
    gap: 16,
    justifyContent: 'center',
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '900',
  },
  emptyCopy: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 22,
  },
  emptyInboxButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#facc15',
    paddingVertical: 14,
    borderRadius: 0,
  },
  emptyInboxText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '900',
  },
  floatingInbox: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 44,
    height: 44,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  unreadDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    backgroundColor: '#ef4444',
  },
});

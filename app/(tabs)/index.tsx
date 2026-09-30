import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { useGameStore } from '@/src/store/gameStore';
import { useRouter } from 'expo-router';
import { BoardRoomCard } from '@/components/hub/board-room-card';
import { CareerStatsCard } from '@/components/hub/career-stats-card';
import { getTeamTheme } from '@/src/constants/teamColors';
import { getSeasonWeekLimit, sortTeamsByTable } from '@/src/core/leagueUtils';
import { getCompetitionPanelForTeam, getCompetitionShortName } from '@/src/core/competitionEngine';
import { formatFixtureShortDate, formatShortDate } from '@/src/utils/calendar';
import { compareFixturesChronologically, getNextDueFixture } from '@/src/core/fixtureLifecycle';
import { Fixture, Player, Team } from '@/src/models/types';
import { HubHeader } from '@/components/hub/hub-header';
import { MiniTableCard } from '@/components/hub/mini-table-card';
import { NextFixtureCard } from '@/components/hub/next-fixture-card';
import { SeasonStatsCard } from '@/components/hub/season-stats-card';
import { LatestNewsCard } from '@/components/hub/latest-news-card';
import { CompetitionPanelsCard } from '@/components/hub/competition-panels-card';
import { UpcomingFixturesCard, UpcomingFixtureCardRow } from '@/components/hub/upcoming-fixtures-card';
import { Screen } from '@/components/ui';
import { color } from '@/src/design/tokens';
import { Ionicons } from '@expo/vector-icons';
import { getInboxSeason } from '@/src/store/inboxCore';

type UpcomingFixtureRow = {
  id: string;
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

const weekToDate = (week: number, season: number): string => formatShortDate(week, season);

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
  const seasonNumber = getInboxSeason(competitions);
  const openLeague = useCallback(() => router.push('/league'), [router]);
  const openCalendar = useCallback(() => router.push('/calendar'), [router]);
  const openStats = useCallback(() => router.push('/stats'), [router]);
  const openBoard = useCallback(() => router.push('/board'), [router]);

  const myTeam = userTeamId ? teams[userTeamId] : null;
  const myDivision = myTeam?.division ?? 'Premier League';
  const myTheme = myTeam ? getTeamTheme(myTeam.name) : null;

  const fixtureList = useMemo(() => Object.values(fixtures), [fixtures]);
  const myNextMatch = useMemo(
    () => getNextDueFixture(fixtures, userTeamId, currentWeek),
    [currentWeek, fixtures, userTeamId]
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
    router.push({ pathname: '/match', params: { fixtureId: myNextMatch.id } });
  }, [myNextMatch, playMatch, router]);

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
    const matches = fixtureList
      .filter(fixture => fixture.week >= currentWeek && (fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId))
      .sort(compareFixturesChronologically)
      .slice(0, 5)
      .map(match => ({ id: match.id, week: match.week, match }));

    if (matches.length > 0) return matches;
    return [{ id: `rest-${currentWeek}`, week: Math.min(currentWeek, seasonWeekLimit), match: undefined }];
  }, [currentWeek, fixtureList, seasonWeekLimit, userTeamId]);

  const upcomingFixtureRows = useMemo<UpcomingFixtureCardRow[]>(() => (
    upcomingFixtures.map(({ id, week, match }) => {
      const opponentId = match
        ? (match.homeTeamId === userTeamId ? match.awayTeamId : match.homeTeamId)
        : null;
      const opponent = opponentId ? teams[opponentId] : null;
      const opponentTheme = opponent ? getTeamTheme(opponent.name) : null;
      const isHome = match?.homeTeamId === userTeamId;

      return {
        id,
        week,
        dateLabel: match ? formatFixtureShortDate(match, seasonNumber) : weekToDate(week, seasonNumber),
        isCurrentWeek: week === currentWeek,
        isHome: !!isHome,
        opponentName: opponent?.name || null,
        opponentPrimary: opponentTheme?.primary,
        opponentSecondary: opponentTheme?.secondary,
        score: match && match.isPlayed
          ? (match.resolution === 'void' ? 'VOID' : isHome ? `${match.homeScore}-${match.awayScore}` : `${match.awayScore}-${match.homeScore}`)
          : null,
      };
    })
  ), [currentWeek, upcomingFixtures, teams, userTeamId, seasonNumber]);

  const { topScorer, topAssister, topCS } = useMemo(() => {
    let topScorer: Player | undefined;
    let topAssister: Player | undefined;
    let topCS: Player | undefined;
    for (const player of Object.values(players)) {
      if (teams[player.teamId]?.division !== myDivision) continue;
      if (player.goals > (topScorer?.goals ?? 0)) topScorer = player;
      if (player.assists > (topAssister?.assists ?? 0)) topAssister = player;
      if (player.position === 'GK' && (player.cleanSheets || 0) > (topCS?.cleanSheets || 0)) topCS = player;
    }
    return { topScorer, topAssister, topCS };
  }, [players, teams, myDivision]);
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
      <Screen scroll={false}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Between Jobs</Text>
          <Text style={styles.emptyCopy}>
            You are not currently attached to a club. Check your inbox for job offers and season updates.
          </Text>
          <LatestNewsCard news={news} />
          <TouchableOpacity style={styles.emptyInboxButton} onPress={advanceWeek}
            accessibilityRole="button" accessibilityLabel="Advance week while between jobs">
            <Text style={styles.emptyInboxText}>Advance Week · W{currentWeek}</Text>
          </TouchableOpacity>
          {careerRecord.seasonsManaged > 0 ? (
            <CareerStatsCard careerRecord={careerRecord} onPress={openBoard} />
          ) : null}
          <TouchableOpacity
            style={styles.emptyInboxButton}
            onPress={() => router.push('/inbox')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Open inbox"
          >
            <Ionicons name="mail" size={18} color={color.bg.screen} />
            <Text style={styles.emptyInboxText}>
              Open Inbox{unreadInboxCount > 0 ? ` (${unreadInboxCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const myPosition = miniTableData.myPosition;
  const myRecord = `${myTeam.wins}W ${myTeam.draws}D ${myTeam.losses}L`;
  const nextFixtureLabel = `${myNextMatch ? getCompetitionShortName(myNextMatch.competitionId) : 'Matchday'} | ${homeTheme?.stadium || 'TBD'} | ${myNextMatch ? formatFixtureShortDate(myNextMatch, seasonNumber) : weekToDate(currentWeek, seasonNumber)}`;
  const competitionPanels = [
    getCompetitionPanelForTeam('carabao-cup', competitions, fixtures, teams, myTeam.id, currentWeek),
    getCompetitionPanelForTeam('fa-cup', competitions, fixtures, teams, myTeam.id, currentWeek),
    getCompetitionPanelForTeam('europe', competitions, fixtures, teams, myTeam.id, currentWeek),
  ] as CompetitionPanelItem[];

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <HubHeader
            team={myTeam}
            theme={myTheme}
            position={myPosition}
            record={myRecord}
            currentWeek={currentWeek}
            weekLabel={weekToDate(currentWeek, seasonNumber)}
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
            onPress={openLeague}
          />

          <CompetitionPanelsCard items={competitionPanels} />

          <UpcomingFixturesCard rows={upcomingFixtureRows} onPress={openCalendar} />

          <SeasonStatsCard leaders={seasonLeaders} onPress={openStats} />

          <BoardRoomCard
            boardApproval={myTeam.boardApproval}
            managerName={myTeam.manager.name}
            onPress={openBoard}
          />

          {careerRecord && careerRecord.seasonsManaged > 0 && (
            <CareerStatsCard
              careerRecord={careerRecord}
              onPress={openBoard}
            />
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        <TouchableOpacity
          style={styles.floatingInbox}
          onPress={() => router.push('/inbox')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Open inbox${unreadInboxCount > 0 ? `, ${unreadInboxCount} unread` : ''}`}
        >
          <Ionicons name="mail" size={22} color={color.warning.fg} />
          {unreadInboxCount > 0 && <View style={styles.unreadDot} />}
        </TouchableOpacity>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    flex: 1,
    padding: 20,
    gap: 16,
    justifyContent: 'center',
  },
  emptyTitle: {
    color: color.text.primary,
    fontSize: 28,
    fontWeight: '900',
  },
  emptyCopy: {
    color: color.text.muted,
    fontSize: 14,
    lineHeight: 22,
  },
  emptyInboxButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: color.warning.fg,
    paddingVertical: 14,
    borderRadius: 0,
  },
  emptyInboxText: {
    color: color.bg.screen,
    fontSize: 13,
    fontWeight: '900',
  },
  floatingInbox: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 44,
    height: 44,
    backgroundColor: color.bg.card,
    borderWidth: 1,
    borderColor: color.border.subtle,
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
    backgroundColor: color.danger.base,
  },
});

import React, { useMemo } from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { CalendarFixtureRow } from '@/components/calendar/calendar-fixture-row';
import { CalendarWindowBanner } from '@/components/calendar/calendar-window-banner';
import { useGameStore } from '@/src/store/gameStore';
import { formatFixtureShortDate, formatSeasonLabel, getWindowStatus } from '@/src/utils/calendar';
import { getTeamTheme } from '@/src/constants/teamColors';
import { Screen } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { Fixture } from '@/src/models/types';
import { getTeamFixturesChronologically } from '@/src/core/fixtureLifecycle';

type WindowBanner = {
  text: string;
  isOpen: boolean;
};

type CalendarFixtureRowData = {
  id: string;
  week: number;
  dateLabel: string;
  competitionLabel: string;
  roundLabel: string;
  isHome: boolean;
  opponentName: string;
  opponentColor: string;
  isPast: boolean;
  isCurrent: boolean;
  score: string | null;
  windowBanner?: WindowBanner;
};

export default function CalendarScreen() {
  const currentWeek = useGameStore(s => s.currentWeek);
  const userTeamId = useGameStore(s => s.userTeamId);
  const teams = useGameStore(s => s.teams);
  const allFixtures = useGameStore(s => s.fixtures);
  const competitions = useGameStore(s => s.competitions);
  const seasonNumber = useMemo(() => (
    Math.max(1, ...Object.values(competitions).map(competition => competition.season || 1))
  ), [competitions]);

  const myFixtures = useMemo<Fixture[]>(
    () => {
      if (!userTeamId) return [];
      return getTeamFixturesChronologically(allFixtures, userTeamId);
    },
    [allFixtures, userTeamId]
  );

  const fixtureRows = useMemo<CalendarFixtureRowData[]>(
    () => myFixtures.flatMap((fixture) => {
      const isHome = fixture.homeTeamId === userTeamId;
      const oppId = isHome ? fixture.awayTeamId : fixture.homeTeamId;
      const oppTeam = teams[oppId];

      if (!oppTeam) return [];

      const theme = getTeamTheme(oppTeam.name);
      const status = getWindowStatus(fixture.week);
      const prevStatus = fixture.week > 1 ? getWindowStatus(fixture.week - 1) : 'closed';
      const competition = competitions[fixture.competitionId];
      const roundLabel = competition?.rounds.find(round => round.key === fixture.round)?.label || fixture.round.replace(/_/g, ' ');
      const banner: WindowBanner | undefined = status !== 'closed'
        ? { text: status === 'summer_open' ? 'Summer Transfer Window Open' : 'Winter Transfer Window Open', isOpen: true }
        : prevStatus !== 'closed'
          ? { text: 'Transfer Window Closed', isOpen: false }
          : undefined;

      return [{
        id: fixture.id,
        week: fixture.week,
        dateLabel: formatFixtureShortDate(fixture, seasonNumber),
        competitionLabel: competition?.shortName || fixture.competitionId,
        roundLabel,
        isHome,
        opponentName: oppTeam.name,
        opponentColor: theme.primary,
        isPast: fixture.isPlayed,
        isCurrent: fixture.week === currentWeek,
        score: fixture.isPlayed
          ? (isHome ? `${fixture.homeScore} - ${fixture.awayScore}` : `${fixture.awayScore} - ${fixture.homeScore}`)
          : null,
        windowBanner: banner,
      }];
    }),
    [competitions, currentWeek, myFixtures, seasonNumber, teams, userTeamId]
  );

  if (!userTeamId) return <Screen scroll={false} />;

  return (
    <Screen scroll={false}>
      <PageHeader
        title="Season Calendar"
        subtitle={formatSeasonLabel(seasonNumber)}
        backLabel="< Hub"
        onBack={() => router.replace('/')}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {fixtureRows.map((fixture) => (
          <React.Fragment key={fixture.id}>
            {fixture.windowBanner && (
              <CalendarWindowBanner
                text={fixture.windowBanner.text}
                isOpen={fixture.windowBanner.isOpen}
              />
            )}
            <CalendarFixtureRow
              week={fixture.week}
              dateLabel={fixture.dateLabel}
              competitionLabel={fixture.competitionLabel}
              roundLabel={fixture.roundLabel}
              isHome={fixture.isHome}
              opponentName={fixture.opponentName}
              opponentColor={fixture.opponentColor}
              isPast={fixture.isPast}
              isCurrent={fixture.isCurrent}
              score={fixture.score}
            />
          </React.Fragment>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: 10 },
});

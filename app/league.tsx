import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type DimensionValue,
} from 'react-native';
import { router } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { getTeamTheme } from '@/src/constants/teamColors';
import { Player, Team } from '@/src/models/types';
import { getSlotsForFormation } from '@/src/constants/formations';
import { getPositionColor } from '@/src/constants/positionColors';
import { rebuildFormationSlotPlayers } from '@/src/core/formationMapUtils';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { DEFAULT_COUNTRY_ID, LEAGUE_COUNTRIES, getLeagueCountry } from '@/src/core/leaguePyramids';
import { sortTeamsByTable } from '@/src/core/leagueUtils';
import { PageHeader } from '@/components/ui/page-header';
import { Screen, ModalSheet } from '@/components/ui';
import { color, space } from '@/src/design/tokens';

const MINI_SLOT_WIDTH = 46;
const MINI_SLOT_HEIGHT = 54;
const MINI_DOT_SIZE = 24;

const getMiniSlotPosition = (rowIdx: number, colIdx: number, rowLength: number, totalRows: number) => {
  const rowPercent = totalRows > 1 ? 11 + (rowIdx / (totalRows - 1)) * 63 : 42;
  return {
    left: `${((colIdx + 1) / (rowLength + 1)) * 100}%` as DimensionValue,
    top: `${rowPercent}%` as DimensionValue,
  };
};

export default function LeagueTableScreen() {
  const teams = useGameStore(state => state.teams);
  const players = useGameStore(state => state.players);
  const userTeamId = useGameStore(state => state.userTeamId);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [selectedCountryId, setSelectedCountryId] = useState(
    teams[userTeamId || '']?.countryId || DEFAULT_COUNTRY_ID
  );
  const { width } = useWindowDimensions();
  const countryScrollRef = useRef<ScrollView>(null);
  const divisionScrollRefs = useRef<Record<string, ScrollView | null>>({});
  const divisionOffsets = useRef<Record<string, Record<string, number>>>({});

  const userTeam = userTeamId ? teams[userTeamId] : null;
  const activeCountryId = userTeam?.countryId || selectedCountryId || DEFAULT_COUNTRY_ID;
  const activeCountry = getLeagueCountry(activeCountryId);

  const teamsByCountry = useMemo(() => Object.fromEntries(
    LEAGUE_COUNTRIES.map(country => [
      country.id,
      sortTeamsByTable(
        Object.values(teams).filter(team => (team.countryId || DEFAULT_COUNTRY_ID) === country.id)
      ),
    ])
  ) as Record<string, Team[]>, [teams]);

  useEffect(() => {
    const targetIndex = Math.max(0, LEAGUE_COUNTRIES.findIndex(country => country.id === activeCountryId));
    if (targetIndex < 0) return;
    requestAnimationFrame(() => {
      countryScrollRef.current?.scrollTo({ x: targetIndex * width, animated: true });
    });
  }, [activeCountryId, width]);

  const getLastLineup = (team: Team) => {
    if (!team.lastStartingXI || team.lastStartingXI.length === 0) return null;
    return team.lastStartingXI.map(id => players[id]).filter(Boolean) as Player[];
  };

  const scrollToCountry = (countryId: string) => {
    const index = Math.max(0, LEAGUE_COUNTRIES.findIndex(country => country.id === countryId));
    setSelectedCountryId(countryId);
    countryScrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  const scrollToDivision = (countryId: string, division: string) => {
    const offset = divisionOffsets.current[countryId]?.[division];
    if (offset !== undefined) {
      divisionScrollRefs.current[countryId]?.scrollTo({ y: offset, animated: true });
    }
  };

  const scrollCountryToTop = (countryId: string) => {
    divisionScrollRefs.current[countryId]?.scrollTo({ y: 0, animated: true });
  };

  const renderMiniPitch = (team: Team, lineup: Player[]) => {
    const slots = getSlotsForFormation(team.activeFormation);
    const slotPlayers = rebuildFormationSlotPlayers(slots, lineup, team.formationMap || {});

    return (
      <View style={styles.miniPitch}>
        <View style={styles.miniPitchOutline} />
        <View style={styles.miniPitchSlots}>
          {slots.map((row, rowIdx) => row.map((slot, colIdx) => {
            const assigned = slotPlayers[rowIdx]?.[colIdx];
            const position = getMiniSlotPosition(rowIdx, colIdx, row.length, slots.length);

            return (
              <View key={`${rowIdx}-${colIdx}`} style={[styles.miniSlotAnchor, position]}>
                <View style={[
                  styles.miniDot,
                  { backgroundColor: assigned ? getPositionColor(assigned.position) : '#1e3a2f' },
                ]}>
                  <Text style={styles.miniDotLabel}>
                    {assigned ? (assigned.subPosition || assigned.position).substring(0, 2) : slot.label}
                  </Text>
                </View>
                <Text style={styles.miniDotName} numberOfLines={1}>
                  {assigned ? assigned.name.split(' ').pop() : ''}
                </Text>
                {assigned && <Text style={styles.miniRating}>{assigned.overallRating}</Text>}
              </View>
            );
          }))}
        </View>
      </View>
    );
  };

  const renderDivisionSection = (countryId: string, division: string, isActiveCountry: boolean) => {
    const divisionTeams = teamsByCountry[countryId] || [];
    const divisionTeamsOnly = divisionTeams.filter(team => team.division === division);
    const isActiveDivision = isActiveCountry && division === userTeam?.division;

    return (
      <View
        key={division}
        onLayout={(event) => {
          if (!divisionOffsets.current[countryId]) divisionOffsets.current[countryId] = {};
          divisionOffsets.current[countryId][division] = event.nativeEvent.layout.y;
        }}
        style={[styles.divisionSection, isActiveDivision && styles.divisionSectionActive]}
      >
        <View style={styles.divisionHeaderRow}>
          <View>
            <Text style={styles.divisionTitle}>{division}</Text>
            <Text style={styles.divisionSubtitle}>
              {isActiveDivision ? 'Your current division' : 'Scroll down through this country'}
            </Text>
          </View>
          <TouchableOpacity style={styles.divisionJumpBtn} onPress={() => scrollToDivision(countryId, division)} accessibilityRole="button" accessibilityLabel={`Jump to ${division}`}>
            <Text style={styles.divisionJumpText}>Go</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cell, styles.pos]}>#</Text>
            <Text style={[styles.cell, styles.name]}>Club</Text>
            <Text style={[styles.cell, styles.stat]}>P</Text>
            <Text style={[styles.cell, styles.stat]}>W</Text>
            <Text style={[styles.cell, styles.stat]}>D</Text>
            <Text style={[styles.cell, styles.stat]}>L</Text>
            <Text style={[styles.cell, styles.stat]}>GF</Text>
            <Text style={[styles.cell, styles.stat]}>GA</Text>
            <Text style={[styles.cell, styles.stat]}>GD</Text>
            <Text style={[styles.cell, styles.stat, styles.pts]}>Pts</Text>
          </View>

          {divisionTeamsOnly.map((team, index) => {
            const isUser = team.id === userTeamId;
            const gd = team.goalsFor - team.goalsAgainst;
            const theme = getTeamTheme(team.name);

            return (
              <TouchableOpacity
                key={team.id}
                style={[styles.row, isUser && styles.userRow]}
                onPress={() => setSelectedTeam(team)}
                accessibilityRole="button"
                accessibilityLabel={`${index + 1}. ${team.name}, ${team.points} points${isUser ? ', your team' : ''}`}
              >
                <Text style={[styles.cell, styles.pos, isUser && styles.userText]}>{index + 1}</Text>
                <View style={styles.nameCell}>
                  <View style={styles.kitStrip}>
                    <View style={[styles.kitBlock, { backgroundColor: theme.primary }]} />
                    <View style={[styles.kitBlock, { backgroundColor: theme.secondary === '#FFFFFF' ? color.text.secondary : theme.secondary }]} />
                  </View>
                  <Text style={[styles.cell, styles.name, isUser && styles.userText]} numberOfLines={1}>{team.name}</Text>
                </View>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.played}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.wins}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.draws}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]}>{team.losses}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]} numberOfLines={1} adjustsFontSizeToFit>{team.goalsFor}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]} numberOfLines={1} adjustsFontSizeToFit>{team.goalsAgainst}</Text>
                <Text style={[styles.cell, styles.stat, isUser && styles.userText]} numberOfLines={1} adjustsFontSizeToFit>{gd > 0 ? `+${gd}` : gd}</Text>
                <Text style={[styles.cell, styles.stat, styles.pts, isUser && styles.userText]} numberOfLines={1} adjustsFontSizeToFit>{team.points}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderCountryPage = (countryId: string) => {
    const country = getLeagueCountry(countryId);
    const isActiveCountry = countryId === activeCountryId;

    return (
      <View key={countryId} style={[styles.countryPage, { width }]}>
        <ScrollView
          ref={ref => {
            divisionScrollRefs.current[countryId] = ref;
          }}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.countryScrollContent}
        >
          <View style={styles.countryBanner}>
            <View>
              <Text style={styles.countryLabel}>{country.label}</Text>
              <Text style={styles.countryHint}>{country.reelHint}</Text>
            </View>
            <TouchableOpacity style={styles.countryTopBtn} onPress={() => scrollCountryToTop(countryId)} accessibilityRole="button" accessibilityLabel={`Scroll ${country.label} to top`}>
              <Text style={styles.countryTopBtnText}>Top</Text>
            </TouchableOpacity>
          </View>
          {country.divisions.map(division => renderDivisionSection(countryId, division, isActiveCountry))}
        </ScrollView>
      </View>
    );
  };

  return (
    <Screen scroll={false}>
      <PageHeader
        title="League Table"
        subtitle="Swipe left/right for countries. Scroll down for lower divisions."
        backLabel="< Hub"
        onBack={() => router.replace('/')}
      />
      <View style={styles.reelRow}>
        {LEAGUE_COUNTRIES.map(country => (
          <TouchableOpacity
            key={country.id}
            style={[styles.reelChip, country.id === activeCountry.id && styles.reelChipActive]}
            onPress={() => scrollToCountry(country.id)}
            accessibilityRole="button"
            accessibilityLabel={`View ${country.label} leagues`}
            accessibilityState={{ selected: country.id === activeCountry.id }}
          >
            <Text style={[styles.reelChipText, country.id === activeCountry.id && styles.reelChipTextActive]}>
              {country.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        ref={countryScrollRef}
        style={styles.countryPager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / width);
          const nextCountry = LEAGUE_COUNTRIES[index];
          if (nextCountry) setSelectedCountryId(nextCountry.id);
        }}
      >
        {LEAGUE_COUNTRIES.map(country => renderCountryPage(country.id))}
      </ScrollView>

      <ModalSheet
        visible={selectedTeam !== null}
        onClose={() => setSelectedTeam(null)}
        title={selectedTeam?.name ?? ''}
        subtitle={selectedTeam ? getTeamTheme(selectedTeam.name).stadium : undefined}
      >
        {selectedTeam && (() => {
          const theme = getTeamTheme(selectedTeam.name);
          const lineup = getLastLineup(selectedTeam);
          const subPlayers = sortPlayersByPositionGroup(
            Object.values(players).filter(p => p.teamId === selectedTeam.id && !p.isStarting && p.isSub)
          );
          return (
            <>
              <View style={styles.modalKitStrip}>
                <View style={[styles.modalKitBlock, { backgroundColor: theme.primary }]} />
                <View style={[styles.modalKitBlock, { backgroundColor: theme.secondary === '#FFFFFF' ? color.text.secondary : theme.secondary }]} />
              </View>

              {lineup ? (
                <>
                  <Text style={styles.modalSectionTitle}>Last Starting XI</Text>
                  {renderMiniPitch(selectedTeam, lineup)}
                  {subPlayers.length > 0 && (
                    <>
                      <Text style={styles.modalSectionTitle}>Substitutes</Text>
                      {subPlayers.map(p => (
                        <View key={p.id} style={styles.modalPlayerRow}>
                          <View style={[styles.modalPosPill, { backgroundColor: getPositionColor(p.position) }]}>
                            <Text style={styles.modalPosText}>{p.subPosition || p.position}</Text>
                          </View>
                          <Text style={[styles.modalPlayerName, { color: color.text.muted }]}>{p.name}</Text>
                          <Text style={styles.modalPlayerRating}>{p.overallRating}</Text>
                        </View>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <View style={styles.noLineupBox}>
                  <Text style={styles.noLineupText}>No match played yet this season</Text>
                </View>
              )}
            </>
          );
        })()}
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  reelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  reelChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 0,
    backgroundColor: color.bg.card,
    borderWidth: 1,
    borderColor: color.border.default,
  },
  reelChipActive: { backgroundColor: color.bg.screen, borderColor: color.accent.primary },
  reelChipText: { color: color.text.muted, fontSize: 11, fontWeight: '800' },
  reelChipTextActive: { color: color.accent.primary },
  countryPager: { flex: 1 },
  countryPage: { flex: 1 },
  countryScrollContent: { paddingBottom: 18 },
  countryBanner: {
    paddingHorizontal: space.lg,
    paddingTop: 4,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countryLabel: { color: color.text.primary, fontSize: 15, fontWeight: '900' },
  countryHint: { color: color.text.faint, fontSize: 11, marginTop: 2 },
  countryTopBtn: {
    backgroundColor: color.bg.screen,
    borderWidth: 1,
    borderColor: color.border.default,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 0,
  },
  countryTopBtnText: { color: color.text.secondary, fontSize: 11, fontWeight: '900' },
  divisionSection: { paddingHorizontal: 8, paddingTop: 2, paddingBottom: 20 },
  divisionSectionActive: {},
  divisionHeaderRow: {
    paddingHorizontal: 8,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  divisionTitle: { color: color.text.primary, fontSize: 18, fontWeight: '900' },
  divisionSubtitle: { color: color.text.faint, fontSize: 11, marginTop: 2 },
  divisionJumpBtn: {
    backgroundColor: color.bg.card,
    borderWidth: 1,
    borderColor: color.border.default,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 0,
  },
  divisionJumpText: { color: color.text.secondary, fontSize: 12, fontWeight: '800' },
  table: {
    backgroundColor: color.bg.card,
    margin: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: color.border.default,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.border.default,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  headerRow: { backgroundColor: color.bg.screen },
  userRow: { backgroundColor: color.accent.dim },
  cell: { fontSize: 12, color: color.text.secondary },
  nameCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pos: { width: 22, textAlign: 'center', fontWeight: '900', color: color.text.muted },
  name: { flex: 1, fontWeight: '700', fontSize: 11 },
  stat: { width: 29, textAlign: 'center', fontWeight: '600' },
  pts: { width: 32, textAlign: 'center', fontWeight: '900', color: color.text.primary },
  userText: { color: color.accent.primary, fontWeight: '900' },
  kitStrip: {
    flexDirection: 'row',
    width: 14,
    height: 14,
    borderRadius: 0,
    overflow: 'hidden',
    marginRight: 5,
  },
  kitBlock: { flex: 1 },
  modalKitStrip: {
    flexDirection: 'row',
    width: 40,
    height: 6,
    borderRadius: 0,
    overflow: 'hidden',
    marginBottom: 8,
    alignSelf: 'center',
  },
  modalKitBlock: { flex: 1 },
  modalSectionTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: color.text.faint,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingTop: 16,
    paddingBottom: 6,
  },
  modalPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.border.default,
  },
  modalPosPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 0,
    marginRight: 12,
    minWidth: 36,
    alignItems: 'center',
  },
  modalPosText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  modalPlayerName: { flex: 1, fontSize: 15, fontWeight: '700', color: color.text.secondary },
  modalPlayerRating: {
    fontSize: 14,
    fontWeight: '900',
    color: color.accent.primary,
    width: 32,
    textAlign: 'right',
  },
  miniPitch: {
    height: 246,
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: color.success.bgStrong,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: color.success.bgStrongBorder,
    overflow: 'hidden',
    position: 'relative',
  },
  miniPitchOutline: {
    position: 'absolute',
    top: 10,
    bottom: 10,
    left: 10,
    right: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
    borderRadius: 0,
  },
  miniPitchSlots: {
    position: 'absolute',
    top: 10,
    bottom: 10,
    left: 10,
    right: 10,
    zIndex: 10,
  },
  miniSlotAnchor: {
    position: 'absolute',
    width: MINI_SLOT_WIDTH,
    height: MINI_SLOT_HEIGHT,
    marginLeft: -(MINI_SLOT_WIDTH / 2),
    marginTop: -(MINI_DOT_SIZE / 2),
    alignItems: 'center',
  },
  miniDot: {
    width: MINI_DOT_SIZE,
    height: MINI_DOT_SIZE,
    borderRadius: MINI_DOT_SIZE / 2,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  miniDotLabel: { color: '#fff', fontSize: 7, fontWeight: '900', width: '100%', textAlign: 'center' },
  miniDotName: {
    color: '#fff',
    fontSize: 7,
    marginTop: 2,
    textAlign: 'center',
    fontWeight: '700',
    width: MINI_SLOT_WIDTH,
    alignSelf: 'center',
  },
  miniRating: {
    backgroundColor: color.text.secondary,
    color: color.bg.screen,
    alignSelf: 'center',
    minWidth: 20,
    paddingHorizontal: 0,
    paddingVertical: 1,
    borderRadius: 0,
    marginTop: 1,
    fontSize: 7,
    fontWeight: '900',
    textAlign: 'center',
  },
  noLineupBox: { padding: 40, alignItems: 'center' },
  noLineupText: { color: color.text.faint, fontStyle: 'italic', textAlign: 'center' },
});

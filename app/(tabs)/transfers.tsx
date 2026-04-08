import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { getTransferWindowLabel, isTransferWindowOpen } from '@/src/utils/calendar';
import { Player } from '@/src/models/types';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';

type TransferDialog =
  | { type: 'buy'; player: Player; fee: string; wage: string }
  | { type: 'sell'; player: Player; price: string }
  | null;

type MarketSection = {
  countryId: string;
  countryName: string;
  league: string;
  players: Player[];
};

const DIVISION_SORT_ORDER = ['Premier League', 'Championship', 'League One', 'League Two'];

const getCountryName = (countryId?: string) => {
  if (!countryId) return 'Unknown Country';
  return countryId
    .split(/[_-]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getDivisionSortKey = (division: string) => {
  const rank = DIVISION_SORT_ORDER.indexOf(division);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
};

export default function TransfersScreen() {
  const currentWeek = useGameStore(s => s.currentWeek);
  const userTeamId = useGameStore(s => s.userTeamId);
  const teams = useGameStore(s => s.teams);
  const players = useGameStore(s => s.players);
  const buyPlayer = useGameStore(s => s.buyPlayer);
  const listPlayerForSale = useGameStore(s => s.listPlayerForSale);
  const unlistPlayer = useGameStore(s => s.unlistPlayer);

  const windowLabel = getTransferWindowLabel(currentWeek);
  const windowOpen = isTransferWindowOpen(currentWeek);

  const [tab, setTab] = useState<'market' | 'squad'>('market');
  const [dialog, setDialog] = useState<TransferDialog>(null);
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);

  if (!userTeamId) return <View style={styles.container} />;
  const userTeam = teams[userTeamId];

  const marketPlayers = Object.values(players).filter(player => player.isTransferListed && player.teamId !== userTeamId);
  const marketPlayersByRating = [...marketPlayers].sort((a, b) => {
    if (b.overallRating !== a.overallRating) return b.overallRating - a.overallRating;
    if (b.marketValue !== a.marketValue) return b.marketValue - a.marketValue;
    return a.name.localeCompare(b.name);
  });
  const marketSectionMap = new Map<string, Map<string, Player[]>>();
  marketPlayersByRating.forEach(player => {
    const team = teams[player.teamId];
    const countryId = team?.countryId || 'unknown';
    const league = team?.division || 'Unknown League';
    if (!marketSectionMap.has(countryId)) {
      marketSectionMap.set(countryId, new Map<string, Player[]>());
    }
    const leagueMap = marketSectionMap.get(countryId)!;
    if (!leagueMap.has(league)) {
      leagueMap.set(league, []);
    }
    leagueMap.get(league)!.push(player);
  });
  const marketSections: MarketSection[] = Array.from(marketSectionMap.entries())
    .sort(([countryA], [countryB]) => getCountryName(countryA).localeCompare(getCountryName(countryB)))
    .flatMap(([countryId, leagues]) => (
      Array.from(leagues.entries())
        .sort(([leagueA], [leagueB]) => {
          const rankA = getDivisionSortKey(leagueA);
          const rankB = getDivisionSortKey(leagueB);
          if (rankA !== rankB) return rankA - rankB;
          return leagueA.localeCompare(leagueB);
        })
        .map(([league, leaguePlayers]) => ({
          countryId,
          countryName: getCountryName(countryId),
          league,
          players: leaguePlayers,
        }))
    ));
  const availableCountries = Array.from(new Set(marketSections.map(section => section.countryId)));
  const activeCountryId = selectedCountryId && availableCountries.includes(selectedCountryId)
    ? selectedCountryId
    : (availableCountries[0] || null);
  const countrySections = activeCountryId
    ? marketSections.filter(section => section.countryId === activeCountryId)
    : [];
  const availableLeagues = countrySections.map(section => section.league);
  const topLeagueForCountry = [...availableLeagues].sort((a, b) => {
    const rankA = getDivisionSortKey(a);
    const rankB = getDivisionSortKey(b);
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  })[0] || null;
  const activeLeague = selectedLeague && availableLeagues.includes(selectedLeague)
    ? selectedLeague
    : topLeagueForCountry;
  const visibleMarketSections = activeLeague
    ? countrySections.filter(section => section.league === activeLeague)
    : [];
  const mySquad = sortPlayersByPositionGroup(Object.values(players).filter(p => p.teamId === userTeamId));

  const handleBuy = (player: Player) => {
    if (!windowOpen) {
      Alert.alert('Transfer Window Closed', 'You cannot buy players outside of the transfer window.');
      return;
    }
    setDialog({
      type: 'buy',
      player,
      fee: player.askingPrice.toString(),
      wage: player.wage.toString(),
    });
  };

  const handleSellToggle = (player: Player) => {
    if (player.isTransferListed) {
      unlistPlayer(player.id);
      return;
    }
    setDialog({ type: 'sell', player, price: player.marketValue.toString() });
  };

  const handleSubmitDialog = () => {
    if (!dialog) return;

    if (dialog.type === 'buy') {
      const fee = Number(dialog.fee);
      const wage = Number(dialog.wage);
      if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(wage) || wage <= 0) {
        Alert.alert('Invalid Offer', 'Enter a positive transfer fee and wage.');
        return;
      }
      const result = buyPlayer(dialog.player.id, fee, wage);
      setDialog(null);
      Alert.alert(result.success ? 'Success' : 'Rejected', result.message);
      return;
    }

    const price = Number(dialog.price);
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Enter a positive asking price.');
      return;
    }
    listPlayerForSale(dialog.player.id, price);
    setDialog(null);
  };

  const updateDialogValue = (field: 'fee' | 'wage' | 'price', value: string) => {
    setDialog(current => {
      if (!current) return current;
      if (current.type === 'buy' && (field === 'fee' || field === 'wage')) {
        return { ...current, [field]: value };
      }
      if (current.type === 'sell' && field === 'price') {
        return { ...current, price: value };
      }
      return current;
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Transfer Market</Text>
        <Text style={styles.budget}>Budget: GBP {userTeam.budget.toFixed(1)}m</Text>
        <View style={[styles.banner, windowOpen ? styles.bannerOpen : styles.bannerClosed]}>
          <Text style={styles.bannerText}>{windowLabel}</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'market' && styles.tabActive]} onPress={() => setTab('market')}>
          <Text style={[styles.tabText, tab === 'market' && styles.tabTextActive]}>Market ({marketPlayers.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'squad' && styles.tabActive]} onPress={() => setTab('squad')}>
          <Text style={[styles.tabText, tab === 'squad' && styles.tabTextActive]}>Sell Players</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'market' && (
          marketSections.length === 0 ? <Text style={styles.empty}>No players listed.</Text> :
          <>
            <View style={styles.marketFilterBlock}>
              <Text style={styles.filterLabel}>Country</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {availableCountries.map(countryId => {
                  const isActive = countryId === activeCountryId;
                  return (
                    <TouchableOpacity
                      key={countryId}
                      style={[styles.filterChip, isActive && styles.filterChipActive]}
                      onPress={() => {
                        setSelectedCountryId(countryId);
                        setSelectedLeague(null);
                      }}
                    >
                      <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                        {getCountryName(countryId)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {availableLeagues.length > 0 && (
                <>
                  <Text style={styles.filterLabel}>League</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    {availableLeagues.map(league => {
                      const isActive = league === activeLeague;
                      return (
                        <TouchableOpacity
                          key={league}
                          style={[styles.filterChip, isActive && styles.filterChipActive]}
                          onPress={() => setSelectedLeague(league)}
                        >
                          <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{league}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              )}
            </View>

            {visibleMarketSections.map(section => (
              <View key={`${section.countryId}-${section.league}`} style={styles.marketSection}>
                <Text style={styles.countryHeader}>{section.countryName}</Text>
                <View style={styles.leagueHeaderRow}>
                  <Text style={styles.leagueHeaderText}>{section.league}</Text>
                  <Text style={styles.leagueHeaderCount}>{section.players.length}</Text>
                </View>
                {section.players.map(p => (
                  <View key={p.id} style={styles.card}>
                    <View style={styles.cardLeft}>
                      <Text style={styles.pos}>{p.subPosition || p.position}</Text>
                      <View style={styles.playerTextBlock}>
                        <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                        <Text style={styles.club} numberOfLines={1}>{teams[p.teamId]?.name}</Text>
                      </View>
                    </View>
                    <View style={styles.cardRight}>
                      <View style={styles.ratingBox}>
                        <Text style={styles.rating}>{p.overallRating}</Text>
                      </View>
                      <TouchableOpacity style={styles.buyBtn} onPress={() => handleBuy(p)}>
                        <Text style={styles.buyText}>GBP {p.askingPrice.toFixed(1)}m</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </>
        )}

        {tab === 'squad' && (
          mySquad.map(p => (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardLeft}>
                 <Text style={styles.pos}>{p.subPosition || p.position}</Text>
                 <View style={styles.playerTextBlock}>
                   <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                   <Text style={styles.club}>Value: GBP {p.marketValue}m</Text>
                 </View>
              </View>
              <View style={styles.cardRight}>
                <View style={styles.ratingBox}>
                   <Text style={styles.rating}>{p.overallRating}</Text>
                </View>
                <TouchableOpacity
                   style={[styles.buyBtn, p.isTransferListed && { backgroundColor: '#ef4444' }]}
                   onPress={() => handleSellToggle(p)}
                >
                   <Text style={[styles.buyText, p.isTransferListed && { color: '#fff' }]}>
                     {p.isTransferListed ? `Unlist (GBP ${p.askingPrice}m)` : 'List'}
                   </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={() => setDialog(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {dialog && (
              <>
                <Text style={styles.modalTitle}>{dialog.type === 'buy' ? 'Make Transfer Offer' : 'List Player'}</Text>
                <Text style={styles.modalSubtitle}>{dialog.player.name}</Text>

                {dialog.type === 'buy' ? (
                  <>
                    <Text style={styles.fieldLabel}>Transfer fee (GBP millions)</Text>
                    <TextInput
                      value={dialog.fee}
                      onChangeText={value => updateDialogValue('fee', value)}
                      keyboardType="decimal-pad"
                      style={styles.input}
                      placeholderTextColor="#64748b"
                    />
                    <Text style={styles.fieldHint}>
                      Asking price: GBP {dialog.player.askingPrice.toFixed(1)}m | Budget: GBP {userTeam.budget.toFixed(1)}m
                    </Text>

                    <Text style={styles.fieldLabel}>Wage (GBP k/week)</Text>
                    <TextInput
                      value={dialog.wage}
                      onChangeText={value => updateDialogValue('wage', value)}
                      keyboardType="number-pad"
                      style={styles.input}
                      placeholderTextColor="#64748b"
                    />
                    <Text style={styles.fieldHint}>Current wage: GBP {dialog.player.wage}k/w</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>Asking price (GBP millions)</Text>
                    <TextInput
                      value={dialog.price}
                      onChangeText={value => updateDialogValue('price', value)}
                      keyboardType="decimal-pad"
                      style={styles.input}
                      placeholderTextColor="#64748b"
                    />
                    <Text style={styles.fieldHint}>Market value: GBP {dialog.player.marketValue}m</Text>
                  </>
                )}

                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancel} onPress={() => setDialog(null)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalSubmit} onPress={handleSubmitDialog}>
                    <Text style={styles.modalSubmitText}>{dialog.type === 'buy' ? 'Submit Offer' : 'List Player'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#1e293b' },
  title: { fontSize: 24, fontWeight: '900', color: '#f8fafc' },
  budget: { fontSize: 16, color: '#10B981', fontWeight: '700', marginTop: 4 },
  banner: { padding: 10, borderRadius: 8, marginTop: 12, alignItems: 'center' },
  bannerOpen: { backgroundColor: '#065f46' },
  bannerClosed: { backgroundColor: '#7f1d1d' },
  bannerText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#334155' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#38bdf8' },
  tabText: { color: '#64748b', fontWeight: '800' },
  tabTextActive: { color: '#38bdf8' },
  scroll: { padding: 16, gap: 10 },
  marketFilterBlock: { marginBottom: 8 },
  filterLabel: { color: '#64748b', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  filterRow: { gap: 8, paddingBottom: 10 },
  filterChip: { borderWidth: 1, borderColor: '#334155', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#0f172a' },
  filterChipActive: { borderColor: '#38bdf8', backgroundColor: '#0ea5e920' },
  filterChipText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  filterChipTextActive: { color: '#38bdf8', fontWeight: '900' },
  marketSection: { marginBottom: 8 },
  countryHeader: { color: '#38bdf8', fontSize: 12, fontWeight: '900', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' },
  leagueHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 2 },
  leagueHeaderText: { color: '#cbd5e1', fontSize: 12, fontWeight: '800' },
  leagueHeaderCount: { color: '#64748b', fontSize: 11, fontWeight: '800' },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 20 },
  card: { backgroundColor: '#1e293b', padding: 12, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  playerTextBlock: { flex: 1, minWidth: 0 },
  pos: { width: 34, textAlign: 'center', backgroundColor: '#334155', color: '#fff', paddingVertical: 4, borderRadius: 4, fontSize: 10, fontWeight: '900' },
  name: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  club: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ratingBox: { backgroundColor: '#cbd5e1', width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  rating: { color: '#0f172a', fontWeight: '900', fontSize: 12 },
  buyBtn: { backgroundColor: '#38bdf8', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  buyText: { color: '#0f172a', fontWeight: '900', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#334155' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '900' },
  modalSubtitle: { color: '#94a3b8', fontSize: 13, marginTop: 4, marginBottom: 16, fontWeight: '700' },
  fieldLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '900', marginTop: 10, marginBottom: 6 },
  fieldHint: { color: '#64748b', fontSize: 11, marginTop: 6, lineHeight: 16 },
  input: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 10, color: '#f8fafc', fontSize: 16, fontWeight: '800', paddingHorizontal: 12, paddingVertical: 10 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalCancel: { flex: 1, backgroundColor: '#334155', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalCancelText: { color: '#cbd5e1', fontWeight: '900' },
  modalSubmit: { flex: 1, backgroundColor: '#38bdf8', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalSubmitText: { color: '#0f172a', fontWeight: '900' },
});

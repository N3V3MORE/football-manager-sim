import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { getTransferWindowLabel, isTransferWindowOpen } from '@/src/utils/calendar';

export default function TransfersScreen() {
  const currentWeek = useGameStore(s => s.currentWeek);
  const userTeamId = useGameStore(s => s.userTeamId);
  const teams = useGameStore(s => s.teams);
  const players = useGameStore(s => s.players);
  const buyPlayer = useGameStore(s => s.buyPlayer);

  const windowLabel = getTransferWindowLabel(currentWeek);
  const windowOpen = isTransferWindowOpen(currentWeek);

  const [tab, setTab] = useState<'market' | 'squad'>('market');

  if (!userTeamId) return <View style={styles.container} />;
  const userTeam = teams[userTeamId];

  const marketPlayers = Object.values(players).filter(p => p.isTransferListed && p.teamId !== userTeamId);
  const mySquad = Object.values(players).filter(p => p.teamId === userTeamId);

  const handleBuy = (player: typeof players[0]) => {
    if (!windowOpen) {
      Alert.alert('Transfer Window Closed', 'You cannot buy players outside of the transfer window.');
      return;
    }
    
    Alert.prompt(
      'Transfer Bid (In Millions)',
      `Asking Price: £${player.askingPrice.toFixed(1)}m. Your budget: £${userTeam.budget.toFixed(1)}m. Enter your bid:`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Next (Wage)', onPress: (feeStr?: string) => {
           const fee = parseFloat(feeStr || '0');
           if (fee <= 0) return;
           
           Alert.prompt(
             'Contract Wage Offer (k/week)',
             `Current Wage: £${player.wage}k/w. How much will you offer?`,
             [
               { text: 'Cancel', style: 'cancel' },
               { text: 'Submit Bid', onPress: (wageStr?: string) => {
                  const wage = parseInt(wageStr || '0', 10);
                  const res = buyPlayer(player.id, fee, wage);
                  Alert.alert(res.success ? 'Success' : 'Rejected', res.message);
               }}
             ],
             'plain-text',
             player.wage.toString()
           );
        }}
      ],
      'plain-text',
      player.askingPrice.toString()
    );
  };

  const handleSellToggle = (player: typeof players[0]) => {
     if (player.isTransferListed) {
        useGameStore.getState().unlistPlayer(player.id);
     } else {
        Alert.prompt(
           'List for Sale',
           `Enter asking price in millions (Market Value: £${player.marketValue}m)`,
           [
              { text: 'Cancel', style: 'cancel' },
              { text: 'List Player', onPress: (val?: string) => {
                 const price = parseFloat(val || '0');
                 if (price > 0) useGameStore.getState().listPlayerForSale(player.id, price);
              }}
           ],
           'plain-text',
           player.marketValue.toString()
        );
     }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Transfer Market</Text>
        <Text style={styles.budget}>Budget: £{userTeam.budget.toFixed(1)}m</Text>
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
          marketPlayers.length === 0 ? <Text style={styles.empty}>No players listed.</Text> :
          marketPlayers.map(p => (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardLeft}>
                 <Text style={styles.pos}>{p.subPosition || p.position}</Text>
                 <View>
                   <Text style={styles.name}>{p.name}</Text>
                   <Text style={styles.club}>{teams[p.teamId]?.name}</Text>
                 </View>
              </View>
              <View style={styles.cardRight}>
                <View style={styles.ratingBox}>
                   <Text style={styles.rating}>{p.overallRating}</Text>
                </View>
                <TouchableOpacity style={styles.buyBtn} onPress={() => handleBuy(p)}>
                   <Text style={styles.buyText}>£{p.askingPrice.toFixed(1)}m</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {tab === 'squad' && (
          mySquad.sort((a,b) => b.overallRating - a.overallRating).map(p => (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardLeft}>
                 <Text style={styles.pos}>{p.subPosition || p.position}</Text>
                 <View>
                   <Text style={styles.name}>{p.name}</Text>
                   <Text style={styles.club}>Value: £{p.marketValue}m</Text>
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
                     {p.isTransferListed ? `Unlist (£${p.askingPrice}m)` : 'List'}
                   </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
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
  empty: { color: '#64748b', textAlign: 'center', marginTop: 20 },
  card: { backgroundColor: '#1e293b', padding: 12, borderRadius: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pos: { width: 34, textAlign: 'center', backgroundColor: '#334155', color: '#fff', paddingVertical: 4, borderRadius: 4, fontSize: 10, fontWeight: '900' },
  name: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  club: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ratingBox: { backgroundColor: '#cbd5e1', width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  rating: { color: '#0f172a', fontWeight: '900', fontSize: 12 },
  buyBtn: { backgroundColor: '#38bdf8', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  buyText: { color: '#0f172a', fontWeight: '900', fontSize: 12 }
});

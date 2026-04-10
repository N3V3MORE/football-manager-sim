import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameStore } from '@/src/store/gameStore';
import { getTransferWindowLabel, isTransferWindowOpen } from '@/src/utils/calendar';
import { Player } from '@/src/models/types';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { formatContractLength, getPlayerAvailabilityStatus, isContractExpiringSoon } from '@/src/core/playerStatusUtils';
import { TransferDialog, TransferDialogState } from '@/components/transfers/transfer-dialog';
import { TransferPlayerCard } from '@/components/transfers/transfer-player-card';
import { TransferTabs } from '@/components/transfers/transfer-tabs';

type TransferTab = 'market' | 'squad';

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

  const [tab, setTab] = useState<TransferTab>('market');
  const [dialog, setDialog] = useState<TransferDialogState>(null);

  if (!userTeamId) return <View style={styles.container} />;
  const userTeam = teams[userTeamId];

  const marketPlayers = sortPlayersByPositionGroup(Object.values(players).filter(p => p.isTransferListed && p.teamId !== userTeamId));
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

      <TransferTabs activeTab={tab} marketCount={marketPlayers.length} onChange={setTab} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'market' && (
          marketPlayers.length === 0 ? <Text style={styles.empty}>No players listed.</Text> :
          marketPlayers.map(p => (
            <TransferPlayerCard
              key={p.id}
              player={p}
              subLabel={`${teams[p.teamId]?.name || ''} | ${getPlayerAvailabilityStatus(p)} | ${formatContractLength(p)}`}
              actionLabel={`GBP ${p.askingPrice.toFixed(1)}m`}
              onAction={() => handleBuy(p)}
            />
          ))
        )}

        {tab === 'squad' && (
          mySquad.map(p => (
            <TransferPlayerCard
              key={p.id}
              player={p}
              subLabel={`Value: GBP ${p.marketValue}m | ${getPlayerAvailabilityStatus(p)} | ${formatContractLength(p)}${isContractExpiringSoon(p) ? ' | Expiring' : ''}`}
              actionLabel={p.isTransferListed ? `Unlist (GBP ${p.askingPrice}m)` : 'List'}
              actionVariant={p.isTransferListed ? 'danger' : 'primary'}
              onAction={() => handleSellToggle(p)}
            />
          ))
        )}
      </ScrollView>

      <TransferDialog
        dialog={dialog}
        budget={userTeam.budget}
        onClose={() => setDialog(null)}
        onChangeValue={updateDialogValue}
        onSubmit={handleSubmitDialog}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#1e293b' },
  title: { fontSize: 24, fontWeight: '900', color: '#f8fafc' },
  budget: { fontSize: 16, color: '#10B981', fontWeight: '700', marginTop: 4 },
  banner: { padding: 10, borderRadius: 0, marginTop: 12, alignItems: 'center' },
  bannerOpen: { backgroundColor: '#065f46' },
  bannerClosed: { backgroundColor: '#7f1d1d' },
  bannerText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  scroll: { padding: 16, gap: 10 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 20 },
});

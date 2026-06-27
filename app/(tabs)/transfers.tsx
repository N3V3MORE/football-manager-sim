import React, { useState } from 'react';
import { StyleSheet, Text, ScrollView } from 'react-native';
import { useGameStore } from '@/src/store/gameStore';
import { getTransferWindowLabel, isTransferWindowOpen } from '@/src/utils/calendar';
import { Player } from '@/src/models/types';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { formatContractLength, getPlayerAvailabilityStatus, isContractExpiringSoon } from '@/src/core/playerStatusUtils';
import { TransferDialog, TransferDialogState } from '@/components/transfers/transfer-dialog';
import { TransferPlayerCard } from '@/components/transfers/transfer-player-card';
import { TransferTabs } from '@/components/transfers/transfer-tabs';
import { Screen, Card, Badge, EmptyState } from '@/components/ui';
import { color, space, type } from '@/src/design/tokens';
import { useConfirmStore } from '@/src/store/confirmStore';

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
  const showAlert = useConfirmStore(s => s.showAlert);

  if (!userTeamId) return <Screen scroll={false} />;
  const userTeam = teams[userTeamId];

  const marketPlayers = sortPlayersByPositionGroup(Object.values(players).filter(p => p.isTransferListed && p.teamId !== userTeamId));
  const mySquad = sortPlayersByPositionGroup(Object.values(players).filter(p => p.teamId === userTeamId));

  const handleBuy = (player: Player) => {
    if (!windowOpen) {
      showAlert({
        title: 'Transfer Window Closed',
        message: 'You cannot buy players outside of the transfer window.',
      });
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
      if (!windowOpen) {
        showAlert({ title: 'Transfer Window Closed', message: 'The transfer window has closed.' });
        setDialog(null);
        return;
      }
      const fee = Number(dialog.fee);
      const wage = Number(dialog.wage);
      if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(wage) || wage <= 0) {
        showAlert({ title: 'Invalid Offer', message: 'Enter a positive transfer fee and wage.' });
        return;
      }
      const result = buyPlayer(dialog.player.id, fee, wage);
      setDialog(null);
      showAlert({ title: result.success ? 'Success' : 'Rejected', message: result.message });
      return;
    }

    const price = Number(dialog.price);
    if (!Number.isFinite(price) || price <= 0) {
      showAlert({ title: 'Invalid Price', message: 'Enter a positive asking price.' });
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
    <Screen scroll={false}>
      <Card padded={space.lg} style={styles.headerCard}>
        <Text style={styles.title}>Transfer Market</Text>
        <Text style={styles.budget}>Budget: GBP {userTeam.budget.toFixed(1)}m</Text>
        <Badge
          variant={windowOpen ? 'success' : 'danger'}
          shape="square"
          style={styles.banner}
        >
          {windowLabel}
        </Badge>
      </Card>

      <TransferTabs activeTab={tab} marketCount={marketPlayers.length} onChange={setTab} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'market' && (
          marketPlayers.length === 0 ? (
            <EmptyState title="No players listed" message="The market is quiet right now." />
          ) : (
            marketPlayers.map(p => (
              <TransferPlayerCard
                key={p.id}
                player={p}
                subLabel={`${teams[p.teamId]?.name || ''} | ${getPlayerAvailabilityStatus(p)} | ${formatContractLength(p)}`}
                actionLabel={`GBP ${p.askingPrice.toFixed(1)}m`}
                onAction={() => handleBuy(p)}
              />
            ))
          )
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerCard: { borderWidth: 0 },
  title: { fontSize: type.h2.fontSize, fontWeight: type.h2.fontWeight, color: color.text.primary },
  budget: { fontSize: type.subtitle.fontSize, color: color.success.base, fontWeight: '700', marginTop: space.xs },
  banner: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 10, marginTop: space.md },
  scroll: { padding: space.lg, gap: 10 },
});

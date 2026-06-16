import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getContractAdviceLabel, getRenewalOffer, shouldRenewContract } from '@/src/core/contractUtils';
import { formatContractLength, getPlayerAvailabilityStatus } from '@/src/core/playerStatusUtils';
import { Player, Team } from '@/src/models/types';

type ContractWatchCardProps = {
  players: Player[];
  team: Team | null;
  onRenew: (playerId: string, years: number, wage: number) => void;
};

const ADVICE_STYLES = {
  renew: { container: { backgroundColor: '#052e16', borderColor: '#166534' }, text: { color: '#86efac' } },
  'cash in': { container: { backgroundColor: '#451a03', borderColor: '#92400e' }, text: { color: '#fbbf24' } },
  replace: { container: { backgroundColor: '#172033', borderColor: '#334155' }, text: { color: '#cbd5e1' } },
} as const;

export default React.memo(function ContractWatchCard({ players, team, onRenew }: ContractWatchCardProps) {
  if (!team) return null;

  const visiblePlayers = [...players]
    .sort((a, b) => {
      const renewDelta = Number(shouldRenewContract(b, team)) - Number(shouldRenewContract(a, team));
      if (renewDelta !== 0) return renewDelta;
      const contractDelta = a.contractLeft - b.contractLeft;
      if (contractDelta !== 0) return contractDelta;
      return b.overallRating - a.overallRating;
    })
    .slice(0, 4);
  const hiddenCount = Math.max(0, players.length - visiblePlayers.length);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Contract Watch</Text>
      <Text style={styles.note}>Deals inside a year need a call before the season rolls over.</Text>

      {visiblePlayers.length > 0 ? (
        <>
          {visiblePlayers.map(player => {
            const offer = getRenewalOffer(player);
            const advice = getContractAdviceLabel(player, team);
            const palette = ADVICE_STYLES[advice];

            return (
              <View key={player.id} style={styles.row}>
                <View style={styles.rowHeader}>
                  <View style={styles.copy}>
                    <Text style={styles.name}>{player.name}</Text>
                    <Text style={styles.meta}>
                      {player.position} | OVR {player.overallRating} | {formatContractLength(player)} | GBP {player.wage}k/w
                    </Text>
                    <Text style={styles.meta}>{getPlayerAvailabilityStatus(player)}</Text>
                  </View>
                  <View style={[styles.adviceChip, palette.container]}>
                    <Text style={[styles.adviceText, palette.text]}>{advice.toUpperCase()}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.renewButton, advice === 'renew' ? styles.primaryRenewButton : styles.secondaryRenewButton]}
                  onPress={() => onRenew(player.id, offer.years, offer.wage)}
                >
                  <Text style={[styles.renewText, advice === 'renew' ? styles.primaryRenewText : styles.secondaryRenewText]}>
                    Offer {offer.years}y | GBP {offer.wage}k/w
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
          {hiddenCount > 0 ? (
            <Text style={styles.footer}>+{hiddenCount} more expiring contract{hiddenCount === 1 ? '' : 's'}</Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.clearText}>No urgent renewals in the squad right now.</Text>
      )}
    </View>
  );
}
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#e2e8f0', marginBottom: 8 },
  note: { color: '#64748b', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  row: {
    backgroundColor: '#0f172a',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginTop: 8,
    gap: 10,
  },
  rowHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  copy: { flex: 1, gap: 4 },
  name: { color: '#f8fafc', fontSize: 14, fontWeight: '800' },
  meta: { color: '#94a3b8', fontSize: 12, lineHeight: 18 },
  adviceChip: {
    borderRadius: 0,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  adviceText: { fontSize: 11, fontWeight: '900' },
  renewButton: {
    borderRadius: 0,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryRenewButton: { backgroundColor: '#38bdf8' },
  secondaryRenewButton: {
    borderWidth: 1,
    borderColor: '#475569',
  },
  renewText: { fontSize: 12, fontWeight: '900' },
  primaryRenewText: { color: '#082f49' },
  secondaryRenewText: { color: '#cbd5e1' },
  clearText: { color: '#cbd5e1', fontSize: 13, lineHeight: 20 },
  footer: { color: '#64748b', fontSize: 12, fontWeight: '700', marginTop: 10 },
});

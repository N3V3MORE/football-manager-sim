import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Player } from '@/src/models/types';
import { getPlayerAvailabilityStatus } from '@/src/core/playerStatusUtils';

type AvailabilityWatchCardProps = {
  players: Player[];
};

export function AvailabilityWatchCard({ players }: AvailabilityWatchCardProps) {
  const visiblePlayers = players.slice(0, 4);
  const hiddenCount = Math.max(0, players.length - visiblePlayers.length);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Availability Watch</Text>
      <Text style={styles.note}>Unavailable players are blocked from selection until they return.</Text>

      {visiblePlayers.length > 0 ? (
        <>
          {visiblePlayers.map(player => (
            <View key={player.id} style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.name}>{player.name}</Text>
                <Text style={styles.meta}>
                  {player.position} | OVR {player.overallRating} | {getPlayerAvailabilityStatus(player)}
                </Text>
              </View>
            </View>
          ))}
          {hiddenCount > 0 ? (
            <Text style={styles.footer}>+{hiddenCount} more unavailable player{hiddenCount === 1 ? '' : 's'}</Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.clearText}>Everyone is available for selection right now.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#e2e8f0', marginBottom: 8 },
  note: { color: '#64748b', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  row: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginTop: 8,
  },
  copy: { gap: 4 },
  name: { color: '#f8fafc', fontSize: 14, fontWeight: '800' },
  meta: { color: '#94a3b8', fontSize: 12, lineHeight: 18 },
  clearText: { color: '#cbd5e1', fontSize: 13, lineHeight: 20 },
  footer: { color: '#64748b', fontSize: 12, fontWeight: '700', marginTop: 10 },
});

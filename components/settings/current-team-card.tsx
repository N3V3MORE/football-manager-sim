import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Team } from '@/src/models/types';

type CurrentTeamCardProps = {
  team: Team | null;
  injuredCount?: number;
  expiringCount?: number;
  onChangeTeam: () => void;
  /** When false, hides the "Change Team" button and shows an explanatory message instead. Defaults to true. */
  showChangeTeamButton?: boolean;
};

export function CurrentTeamCard({ team, injuredCount = 0, expiringCount = 0, onChangeTeam, showChangeTeamButton = true }: CurrentTeamCardProps) {
  const manager = team?.manager;
  const hasAlerts = injuredCount > 0 || expiringCount > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Current Team</Text>
      <Text style={styles.teamName}>{team?.name || 'No team selected'}</Text>
      {team && <Text style={styles.teamDivision}>{team.division}</Text>}
      {team ? (
        <Text style={styles.statusSummary}>
          {hasAlerts
            ? `${injuredCount} injured, ${expiringCount} contracts to review`
            : 'No immediate squad issues flagged'}
        </Text>
      ) : null}
      {manager && (
        <View style={styles.managerBlock}>
          <Text style={styles.managerLabel}>Manager</Text>
          <Text style={styles.managerName}>{manager.name}</Text>
          <Text style={styles.managerMeta}>
            {manager.nationality} | Rep {manager.reputation}% | Fit {manager.clubFit}%
          </Text>
        </View>
      )}
      {showChangeTeamButton ? (
        <TouchableOpacity style={styles.primaryBtn} onPress={onChangeTeam}>
          <Text style={styles.primaryBtnText}>Change Team</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerText}>
            Team changes are managed through career progression and job offers. Check your inbox at the end of the season for opportunities.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#e2e8f0', marginBottom: 10 },
  teamName: { fontSize: 18, fontWeight: '900', color: '#38bdf8', marginBottom: 12 },
  teamDivision: { color: '#94a3b8', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 12 },
  statusSummary: { color: '#cbd5e1', fontSize: 12, fontWeight: '700', marginBottom: 12 },
  managerBlock: {
    backgroundColor: '#0f172a',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginBottom: 12,
  },
  managerLabel: { color: '#64748b', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  managerName: { color: '#f8fafc', fontSize: 16, fontWeight: '900', marginTop: 4 },
  managerMeta: { color: '#94a3b8', fontSize: 12, marginTop: 4, lineHeight: 17 },
  primaryBtn: { backgroundColor: '#38bdf8', borderRadius: 0, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#0f172a', fontWeight: '900' },
  infoBanner: {
    backgroundColor: '#0f172a',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    marginTop: 4,
  },
  infoBannerText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
});

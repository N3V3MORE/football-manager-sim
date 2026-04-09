import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Team } from '@/src/models/types';
import { TeamColorBadge } from '@/components/hub/team-color-badge';

type NextFixtureCardProps = {
  homeTeam: Team | null;
  awayTeam: Team | null;
  userTeamId: string | null;
  subLabel: string;
  onPress: () => void;
};

export function NextFixtureCard({ homeTeam, awayTeam, userTeamId, subLabel, onPress }: NextFixtureCardProps) {
  return (
    <TouchableOpacity style={styles.heroMatchCard} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.heroMatchTitle}>NEXT FIXTURE</Text>
      {homeTeam && awayTeam ? (
        <>
          <Text style={styles.heroStadium}>{subLabel}</Text>
          <View style={styles.matchupRow}>
            <View style={styles.matchupTeam}>
              <TeamColorBadge name={homeTeam.name} isUser={homeTeam.id === userTeamId} />
              <View style={[styles.haTag, styles.homeTag]}>
                <Text style={[styles.haTagText, styles.homeTagText]}>HOME</Text>
              </View>
            </View>

            <View style={styles.matchupVsBlock}>
              <Text style={styles.matchupVs}>VS</Text>
            </View>

            <View style={[styles.matchupTeam, styles.awayTeam]}>
              <TeamColorBadge name={awayTeam.name} isUser={awayTeam.id === userTeamId} mirrored />
              <View style={[styles.haTag, styles.haTagAway, styles.awayTag]}>
                <Text style={[styles.haTagText, styles.awayTagText]}>AWAY</Text>
              </View>
            </View>
          </View>
          <View style={styles.playBtnRow}>
            <Text style={styles.heroPlayBtn}>Tap to play match</Text>
          </View>
        </>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.matchupSubtext}>No fixture this week.</Text>
          <Text style={styles.heroPlayBtn}>Tap to advance week</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  heroMatchCard: {
    backgroundColor: '#111827',
    marginHorizontal: 14,
    marginTop: 14,
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    shadowColor: '#38bdf8',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  heroMatchTitle: { fontSize: 10, fontWeight: '900', color: '#38bdf8', letterSpacing: 2.5, marginBottom: 4 },
  heroStadium: { fontSize: 12, color: '#64748b', fontWeight: '600', marginBottom: 16 },
  matchupRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  matchupTeam: { flex: 1, gap: 6 },
  awayTeam: { alignItems: 'flex-end' },
  haTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, alignSelf: 'flex-start' },
  haTagAway: { alignSelf: 'flex-end' },
  homeTag: { backgroundColor: '#1a3a4a' },
  awayTag: { backgroundColor: '#2a1a1a' },
  haTagText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  homeTagText: { color: '#38bdf8' },
  awayTagText: { color: '#f87171' },
  matchupVsBlock: { paddingHorizontal: 16, alignItems: 'center' },
  matchupVs: { fontSize: 22, fontWeight: '900', color: '#334155' },
  matchupSubtext: { fontSize: 14, color: '#64748b', marginBottom: 8 },
  playBtnRow: { borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 12, alignItems: 'center' },
  heroPlayBtn: { fontSize: 11, fontWeight: '900', color: '#38bdf8', letterSpacing: 1.5 },
  emptyState: { paddingVertical: 20, alignItems: 'center' },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getSecondaryKitColor, TeamTheme } from '@/src/constants/teamColors';
import { Team } from '@/src/models/types';

type HubHeaderProps = {
  team: Team;
  theme: TeamTheme;
  position: number;
  record: string;
  currentWeek: number;
  weekLabel: string;
};

const WHITE_HEX = '#FFFFFF';

export function HubHeader({ team, theme, position, record, currentWeek, weekLabel }: HubHeaderProps) {
  return (
    <View style={[styles.header, { borderBottomColor: `${theme.primary}60` }]}>
      <View style={styles.headerTop}>
        <View style={styles.kitStrip}>
          <View style={[styles.kitBlock, { backgroundColor: theme.primary }]} />
          <View style={[styles.kitBlock, { backgroundColor: getSecondaryKitColor(theme.secondary) }]} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={[styles.teamName, { color: theme.primary !== WHITE_HEX ? theme.primary : '#f8fafc' }]}>
            {team.name}
          </Text>
          <Text style={styles.subtitle}>{theme.stadium} | Est. {theme.founded}</Text>
        </View>
      </View>

      <View style={styles.statChipRow}>
        <View style={styles.statChip}>
          <Text style={styles.statChipVal}>#{position}</Text>
          <Text style={styles.statChipLabel}>Position</Text>
        </View>
        <View style={styles.statChipDivider} />
        <View style={styles.statChip}>
          <Text style={styles.statChipVal}>{team.points}</Text>
          <Text style={styles.statChipLabel}>Points</Text>
        </View>
        <View style={styles.statChipDivider} />
        <View style={styles.statChip}>
          <Text style={styles.statChipVal}>{record}</Text>
          <Text style={styles.statChipLabel}>Record</Text>
        </View>
        <View style={styles.statChipDivider} />
        <View style={styles.statChip}>
          <Text style={styles.statChipVal}>Wk {currentWeek}</Text>
          <Text style={styles.statChipLabel}>{weekLabel}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#111827',
    borderBottomWidth: 2,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  titleWrap: { flex: 1 },
  kitStrip: { flexDirection: 'column', width: 8, height: 44, borderRadius: 4, overflow: 'hidden' },
  kitBlock: { flex: 1 },
  teamName: { fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2, fontWeight: '600' },
  statChipRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 10, padding: 10 },
  statChip: { flex: 1, alignItems: 'center' },
  statChipVal: { fontSize: 14, fontWeight: '900', color: '#f8fafc' },
  statChipLabel: { fontSize: 9, color: '#64748b', fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  statChipDivider: { width: 1, height: 28, backgroundColor: '#1e293b' },
});

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Player, StatKey } from '@/src/models/types';
import { getPositionColor } from '@/src/constants/positionColors';
import { formatContractLength, getPlayerAvailabilityStatus, isContractExpiringSoon, isPlayerInjured } from '@/src/core/playerStatusUtils';

type CompactPlayerCardProps = {
  item: Player;
  isBench: boolean;
  isExpanded: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onTrainingFocusChange?: (playerId: string, focus: StatKey | null) => void;
};

const TRAINING_OPTIONS: { label: string; value: StatKey | null }[] = [
  { label: 'BAL', value: null },
  { label: 'PAC', value: 'pace' },
  { label: 'SHO', value: 'shooting' },
  { label: 'PAS', value: 'passing' },
  { label: 'DRI', value: 'dribbling' },
  { label: 'DEF', value: 'defending' },
  { label: 'PHY', value: 'physical' },
];

const STAT_LABELS: Record<StatKey, string> = {
  pace: 'PAC',
  shooting: 'SHO',
  passing: 'PAS',
  dribbling: 'DRI',
  defending: 'DEF',
  physical: 'PHY',
};

export function CompactPlayerCard({
  item,
  isBench,
  isExpanded,
  onPress,
  onLongPress,
  onTrainingFocusChange,
}: CompactPlayerCardProps) {
  const isSuspended = item.matchesSuspended > 0;
  const isInjured = isPlayerInjured(item);
  const isExhausted = item.energy < 70;
  const isExpiring = isContractExpiringSoon(item);
  const warningColor = (isSuspended || isInjured || isExhausted || isExpiring) ? '#ef4444' : undefined;
  const statusLine = `${getPlayerAvailabilityStatus(item)} | ${formatContractLength(item)}`;
  const trainingXp = Math.max(0, Math.min(99, item.trainingXp || 0));
  const trainingGains = Object.entries(item.trainingStatGains || {})
    .filter((entry): entry is [StatKey, number] => Number(entry[1]) > 0);

  return (
    <View>
      <TouchableOpacity
        style={[styles.playerRow, isExpanded && styles.playerRowExpanded, warningColor && { borderColor: warningColor }]}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={400}
        activeOpacity={0.7}
      >
        <View style={[styles.posTag, { backgroundColor: getPositionColor(item.position) }]}>
          <Text style={styles.posText}>{item.subPosition || item.position}</Text>
        </View>
        <View style={styles.playerMeta}>
          <Text style={[styles.playerName, warningColor && { color: warningColor }]} numberOfLines={1}>
            {item.name} {isSuspended && <Text style={styles.suspensionTag}>[SUSP]</Text>}
            {isInjured && <Text style={styles.suspensionTag}>[INJ]</Text>}
            {isExpiring && <Text style={styles.contractTag}>[EXP]</Text>}
          </Text>
          <Text style={styles.nationality}>{item.nationality} | {Math.floor(item.energy)}% Energy</Text>
          <Text style={styles.statusMeta}>{statusLine}</Text>
        </View>
        <View style={styles.playerRowRight}>
          <View style={styles.ratingBox}>
            <Text style={styles.ratingText}>{item.overallRating}</Text>
          </View>
          {isBench && (
            <View style={styles.benchBadge}>
              <Text style={styles.benchBadgeText}>SUB</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.statsExpanded}>
          {item.position === 'GK' ? (
            <View style={styles.statsContainer}>
              {[
                ['DIV', item.stats.gk_diving],
                ['HAN', item.stats.gk_handling],
                ['KIC', item.stats.gk_kicking],
                ['REF', item.stats.gk_reflexes],
                ['SPD', item.stats.gk_speed],
                ['POS', item.stats.gk_positioning],
              ].map(([label, value]) => (
                <View key={label as string} style={styles.statColumn}>
                  <Text style={styles.statTitle}>{label}</Text>
                  <Text style={styles.statValue}>{(value as number) || 50}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.statsContainer}>
              {[
                ['PAC', item.stats.pace],
                ['SHO', item.stats.shooting],
                ['PAS', item.stats.passing],
                ['DRI', item.stats.dribbling],
                ['DEF', item.stats.defending],
                ['PHY', item.stats.physical],
              ].map(([label, value]) => (
                <View key={label as string} style={styles.statColumn}>
                  <Text style={styles.statTitle}>{label}</Text>
                  <Text style={styles.statValue}>{value}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.seasonStatsRow}>
            <Text style={styles.seasonStat}>G {item.goals}</Text>
            <Text style={styles.seasonStat}>A {item.assists}</Text>
            {(item.position === 'GK' || item.position === 'DEF') && <Text style={styles.seasonStat}>CS {item.cleanSheets}</Text>}
            <Text style={[styles.seasonStat, styles.yellowCardStat]}>YC {item.yellowCards}</Text>
            <Text style={[styles.seasonStat, styles.redCardStat]}>RC {item.redCards}</Text>
          </View>
          {onTrainingFocusChange && (
            <View style={styles.trainingPanel}>
              <View style={styles.trainingHeader}>
                <Text style={styles.trainingTitle}>Training</Text>
                <Text style={styles.trainingMeta}>{trainingXp}/100 XP</Text>
              </View>
              <View style={styles.trainingProgressTrack}>
                <View style={[styles.trainingProgressFill, { width: `${trainingXp}%` }]} />
              </View>
              <View style={styles.trainingOptions}>
                {TRAINING_OPTIONS.map(option => {
                  const selected = (item.trainingFocus ?? null) === option.value;
                  return (
                    <TouchableOpacity
                      key={option.label}
                      style={[styles.trainingOption, selected && styles.trainingOptionSelected]}
                      onPress={() => onTrainingFocusChange(item.id, option.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.trainingOptionText, selected && styles.trainingOptionTextSelected]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {trainingGains.length > 0 && (
                <Text style={styles.trainingGains}>
                  {trainingGains.map(([key, value]) => `${STAT_LABELS[key]} +${value}`).join('  ')}
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 0,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: '#334155',
  },
  playerRowExpanded: { borderColor: '#38bdf8', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  posTag: { paddingVertical: 3, paddingHorizontal: 6, borderRadius: 0, marginRight: 10, minWidth: 38, alignItems: 'center' },
  posText: { color: '#fff', fontWeight: '900', fontSize: 10 },
  playerMeta: { flex: 1 },
  playerName: { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  suspensionTag: { fontSize: 10, color: '#ef4444' },
  contractTag: { fontSize: 10, color: '#f59e0b' },
  nationality: { fontSize: 10, color: '#64748b', fontWeight: '600' },
  statusMeta: { fontSize: 10, color: '#94a3b8', fontWeight: '600', marginTop: 2 },
  playerRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingBox: { backgroundColor: '#cbd5e1', width: 30, height: 30, borderRadius: 0, justifyContent: 'center', alignItems: 'center' },
  ratingText: { color: '#0f172a', fontWeight: '900', fontSize: 13 },
  benchBadge: { backgroundColor: '#1e3a5f', paddingVertical: 3, paddingHorizontal: 7, borderRadius: 0, borderWidth: 1, borderColor: '#3B82F6' },
  benchBadgeText: { color: '#93c5fd', fontSize: 10, fontWeight: '900' },
  statsExpanded: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#38bdf8',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    padding: 10,
    marginBottom: 3,
  },
  statsContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  statColumn: { alignItems: 'center' },
  statTitle: { fontSize: 9, color: '#94a3b8', fontWeight: 'bold', marginBottom: 2 },
  statValue: { fontSize: 14, color: '#e2e8f0', fontWeight: '700' },
  seasonStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  seasonStat: { fontSize: 12, color: '#94a3b8', fontWeight: '700' },
  yellowCardStat: { color: '#F59E0B' },
  redCardStat: { color: '#ef4444' },
  trainingPanel: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  trainingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  trainingTitle: { fontSize: 11, color: '#cbd5e1', fontWeight: '900', textTransform: 'uppercase' },
  trainingMeta: { fontSize: 11, color: '#94a3b8', fontWeight: '800' },
  trainingProgressTrack: {
    height: 6,
    backgroundColor: '#1e293b',
    borderRadius: 0,
    overflow: 'hidden',
  },
  trainingProgressFill: {
    height: 6,
    backgroundColor: '#22c55e',
  },
  trainingOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  trainingOption: {
    minWidth: 38,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    paddingHorizontal: 7,
  },
  trainingOptionSelected: {
    borderColor: '#22c55e',
    backgroundColor: '#14532d',
  },
  trainingOptionText: { color: '#94a3b8', fontSize: 10, fontWeight: '900' },
  trainingOptionTextSelected: { color: '#dcfce7' },
  trainingGains: {
    marginTop: 8,
    color: '#86efac',
    fontSize: 11,
    fontWeight: '800',
  },
});

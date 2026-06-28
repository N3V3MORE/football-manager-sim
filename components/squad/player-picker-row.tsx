import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Player } from '@/src/models/types';
import { getPositionColor } from '@/src/constants/positionColors';
import { color } from '@/src/design/tokens';

type PlayerPickerRowProps = {
  item: Player;
  onPress: () => void;
};

export function PlayerPickerRow({ item, onPress }: PlayerPickerRowProps) {
  const isSuspended = item.matchesSuspended > 0;
  const isExhausted = item.energy < 70;
  const warningColor = (isSuspended || isExhausted) ? color.danger.base : undefined;

  return (
    <TouchableOpacity style={[styles.pickerRow, warningColor && { borderColor: warningColor }]} onPress={onPress}>
      <View style={[styles.modalPosPill, { backgroundColor: getPositionColor(item.position) }]}>
        <Text style={styles.modalPosText}>{item.subPosition || item.position}</Text>
      </View>
      <View style={styles.playerMeta}>
        <Text style={[styles.pickerName, warningColor && { color: warningColor }]} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.pickerNat}>{item.nationality} | {Math.floor(item.energy)}% NRG</Text>
      </View>
      <View style={styles.pickerRating}>
        <Text style={styles.pickerRatingText}>{item.overallRating}</Text>
      </View>
      {item.isStarting && <Text style={styles.pickerStarter}>In Selection</Text>}
      {isSuspended && <Text style={styles.suspensionText}> SUSP</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.border.default, gap: 10 },
  modalPosPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 0, minWidth: 36, alignItems: 'center' },
  modalPosText: { color: color.text.primary, fontSize: 10, fontWeight: '900' },
  playerMeta: { flex: 1 },
  pickerName: { flex: 1, fontSize: 14, fontWeight: '700', color: color.text.primary },
  pickerNat: { fontSize: 10, color: color.text.faint, width: 60 },
  pickerRating: { backgroundColor: color.text.secondary, width: 32, height: 32, borderRadius: 0, justifyContent: 'center', alignItems: 'center' },
  pickerRatingText: { color: color.bg.screen, fontWeight: '900', fontSize: 13 },
  pickerStarter: { fontSize: 10, color: color.accent.primary, fontWeight: '900' },
  suspensionText: { fontSize: 10, color: color.danger.base, fontWeight: 'bold' },
});

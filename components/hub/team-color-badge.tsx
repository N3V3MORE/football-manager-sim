import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getSecondaryKitColor, getTeamTheme } from '@/src/constants/teamColors';

type TeamColorBadgeProps = {
  name: string;
  isUser: boolean;
  mirrored?: boolean;
};

export const TeamColorBadge = React.memo(function TeamColorBadge({ name, isUser, mirrored = false }: TeamColorBadgeProps) {
  const theme = getTeamTheme(name);

  return (
    <View style={[styles.row, mirrored && styles.rowMirrored]}>
      {!mirrored && (
        <>
          <View style={[styles.chip, { backgroundColor: theme.primary }]} />
          <View style={[styles.chip, { backgroundColor: getSecondaryKitColor(theme.secondary) }]} />
        </>
      )}
      <Text
        style={[styles.name, mirrored && styles.nameMirrored, isUser && styles.userName]}
        numberOfLines={2}
      >
        {name}
      </Text>
      {mirrored && (
        <>
          <View style={[styles.chip, { backgroundColor: theme.primary }]} />
          <View style={[styles.chip, { backgroundColor: getSecondaryKitColor(theme.secondary) }]} />
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  rowMirrored: { justifyContent: 'flex-end' },
  chip: { width: 10, height: 10, borderRadius: 0 },
  name: { fontSize: 14, fontWeight: '800', color: '#f8fafc' },
  nameMirrored: { textAlign: 'right' },
  userName: { color: '#38bdf8', fontWeight: '900' },
});

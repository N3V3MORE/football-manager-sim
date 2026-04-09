import { StyleSheet, Text, View } from 'react-native';
import {
  getDisplayKitColor,
  getDisplaySecondaryColor,
  getTeamTheme,
} from '@/src/constants/teamColors';

type TeamColorBadgeProps = {
  name: string;
  isUser: boolean;
  mirrored?: boolean;
};

export const TeamColorBadge = ({ name, isUser, mirrored = false }: TeamColorBadgeProps) => {
  const theme = getTeamTheme(name);
  const primary = getDisplayKitColor(theme.primary);
  const secondary = getDisplaySecondaryColor(theme.secondary);

  return (
    <View style={[styles.row, mirrored && styles.rowMirrored]}>
      {!mirrored && (
        <>
          <View style={[styles.chip, { backgroundColor: primary }]} />
          <View style={[styles.chip, { backgroundColor: secondary }]} />
        </>
      )}
      <Text
        style={[styles.name, mirrored && styles.nameMirrored, isUser && styles.userName]}
        numberOfLines={1}
      >
        {name}
      </Text>
      {mirrored && (
        <>
          <View style={[styles.chip, { backgroundColor: primary }]} />
          <View style={[styles.chip, { backgroundColor: secondary }]} />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'nowrap' },
  rowMirrored: { justifyContent: 'flex-end' },
  chip: { width: 10, height: 10, borderRadius: 3, borderWidth: 1, borderColor: '#64748b' },
  name: { fontSize: 14, fontWeight: '800', color: '#f8fafc', flexShrink: 1 },
  nameMirrored: { textAlign: 'right' },
  userName: { color: '#38bdf8', fontWeight: '900' },
});

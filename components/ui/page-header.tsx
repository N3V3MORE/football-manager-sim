import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { color, space, type } from '@/src/design/tokens';

type PageHeaderProps = {
  title: string;
  backLabel: string;
  onBack: () => void;
  subtitle?: string;
};

/**
 * Stack-screen header with a back control. Used by Calendar, League, Inbox,
 * Board, Stats, Match. Back navigates via the caller (prefer `router.back()`
 * over the historical `router.replace('/')`).
 */
export function PageHeader({ title, backLabel, onBack, subtitle }: PageHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={`${backLabel} ${title}`}
        >
          <Text style={styles.backText}>{backLabel}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={styles.spacer} />
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

type TabHeaderProps = {
  title: string;
  subtitle?: string;
  /** Optional right-aligned accessory (e.g. an info button). */
  right?: React.ReactNode;
};

/**
 * Tab-screen header (Hub, Squad, Transfers, Settings). No back control — tab
 * screens are top-level destinations. Shares the title/subtitle typography with
 * `PageHeader` so every screen has one consistent header treatment.
 */
export function TabHeader({ title, subtitle, right }: TabHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.tabRow}>
        <View style={styles.tabTitles}>
          <Text style={styles.tabTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.tabSubtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tabRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tabTitles: { flex: 1 },
  backButton: {
    width: 52,
    paddingVertical: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: color.border.default,
    backgroundColor: color.bg.card,
  },
  backText: { color: color.text.secondary, fontSize: type.caption.fontSize, fontWeight: '900', textAlign: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: type.h2.fontSize, fontWeight: type.h2.fontWeight, color: color.text.primary },
  spacer: { width: 52 },
  subtitle: { color: color.text.faint, fontSize: type.caption.fontSize, marginTop: 2, textAlign: 'center' },
  tabTitle: { fontSize: type.h2.fontSize, fontWeight: type.h2.fontWeight, color: color.text.primary },
  tabSubtitle: { color: color.text.faint, fontSize: type.caption.fontSize, marginTop: 2, fontWeight: '600' },
});

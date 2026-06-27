import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { color, radius, space, type } from '@/src/design/tokens';

type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

type BadgeProps = {
  children: React.ReactNode;
  variant?: BadgeVariant;
  /** Pill (default) or square corners to match the existing aesthetic. */
  shape?: 'pill' | 'square';
  style?: ViewStyle;
};

const VARIANTS: Record<BadgeVariant, { bg: string; fg: string }> = {
  neutral: { bg: color.bg.elevated, fg: color.text.muted },
  accent: { bg: color.accent.primary, fg: color.accent.onPrimary },
  success: { bg: color.success.bg, fg: color.success.fg },
  warning: { bg: color.warning.base, fg: color.accent.onPrimary },
  danger: { bg: color.danger.bg, fg: color.danger.fg },
  info: { bg: color.info.bg, fg: color.info.base },
};

/**
 * Compact status pill. Replaces the per-screen met/pending/failed badge styles
 * (e.g. board objectives) with one consistent shape and the semantic palette.
 */
export function Badge({ children, variant = 'neutral', shape = 'pill', style }: BadgeProps) {
  const v = VARIANTS[variant];
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: v.bg, borderRadius: shape === 'pill' ? radius.pill : radius.none },
        style,
      ]}
    >
      <Text style={[styles.label, { color: v.fg }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: type.caption.fontSize,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});

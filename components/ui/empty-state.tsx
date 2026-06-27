import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { color, space, type } from '@/src/design/tokens';

type EmptyStateProps = {
  title: string;
  message?: string;
  /** Optional emoji/glyph rendered above the title. */
  icon?: string;
  style?: ViewStyle;
  children?: React.ReactNode;
};

/**
 * Centered placeholder for empty lists/screens (transfers, stats, board, inbox).
 * Replaces the ad-hoc `empty/emptyNote/emptyTitle` styles duplicated across screens.
 */
export function EmptyState({ title, message, icon, style, children }: EmptyStateProps) {
  return (
    <View style={[styles.container, style]} accessibilityRole="text">
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  icon: {
    fontSize: 36,
    marginBottom: space.sm,
  },
  title: {
    color: color.text.primary,
    fontSize: type.subtitle.fontSize,
    fontWeight: '900',
    marginBottom: space.xs,
    textAlign: 'center',
  },
  message: {
    color: color.text.secondary,
    fontSize: type.body.fontSize,
    lineHeight: 22,
    textAlign: 'center',
  },
});

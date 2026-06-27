import { StyleSheet, Text, TouchableOpacity, type TextProps, type ViewStyle } from 'react-native';

import { color, radius, space } from '@/src/design/tokens';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  /** Props forwarded to the label (e.g. numberOfLines). */
  labelProps?: TextProps;
};

const VARIANTS = {
  primary: {
    container: { backgroundColor: color.accent.primary },
    label: { color: color.accent.onPrimary, fontWeight: '900' },
  },
  secondary: {
    container: { backgroundColor: color.bg.elevated, borderWidth: 1, borderColor: color.border.default },
    label: { color: color.text.secondary, fontWeight: '800' },
  },
  danger: {
    container: { backgroundColor: color.danger.bg },
    label: { color: color.danger.fg, fontWeight: '900' },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    label: { color: color.accent.primary, fontWeight: '700' },
  },
} as const;

const SIZES: Record<ButtonSize, { container: ViewStyle; fontSize: number }> = {
  sm: { container: { paddingVertical: 6, paddingHorizontal: space.md }, fontSize: 12 },
  md: { container: { paddingVertical: 10, paddingHorizontal: space.lg }, fontSize: 14 },
  lg: { container: { paddingVertical: 14, paddingHorizontal: space.xl }, fontSize: 16 },
};

/**
 * Button primitive. Replaces per-screen `TouchableOpacity` buttons and aligns
 * the active-state color (accent) across the app. Enforces a 44pt min height for
 * touch targets (md/lg); use `sm` only for low-emphasis inline actions.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  fullWidth,
  style,
  labelProps,
}: ButtonProps) {
  const variantStyle = VARIANTS[variant];
  const sizeStyle = SIZES[size];
  const isGhost = variant === 'ghost';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true } : undefined}
      accessibilityLabel={title}
      style={[
        styles.base,
        sizeStyle.container,
        variantStyle.container,
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
        isGhost && styles.ghostHeight,
        style,
      ]}
    >
      <Text
        style={[{ fontSize: sizeStyle.fontSize, color: variantStyle.label.color, fontWeight: variantStyle.label.fontWeight }, styles.label]}
        numberOfLines={1}
        {...labelProps}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.none,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.45 },
  ghostHeight: { minHeight: 36 },
  label: { textAlign: 'center' },
});

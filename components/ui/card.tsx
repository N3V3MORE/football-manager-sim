import { StyleSheet, View, type ViewStyle } from 'react-native';

import { color, radius, space } from '@/src/design/tokens';

type CardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Inner padding. Defaults to `space.lg` (16). Set to 0 for raw surfaces. */
  padded?: boolean | number;
  /** Background tier. `card` (default) sits on the screen; `elevated` sits on a card. */
  surface?: 'card' | 'elevated';
  /** Border radius. Defaults to `radius.none` to match the existing square aesthetic. */
  rounded?: keyof typeof radius;
};

/**
 * Surface container. Replaces the ~15 copy-pasted card variants (`#1e293b` +
 * `#334155` border) scattered across screens. Default radius is intentionally
 * square to preserve the current visual language; pass `rounded="lg"` for soft cards.
 */
export function Card({ children, style, padded = true, surface = 'card', rounded = 'none' }: CardProps) {
  const padding = padded === false ? 0 : padded === true ? space.lg : padded;
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: surface === 'elevated' ? color.bg.elevated : color.bg.card, borderRadius: radius[rounded], padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderColor: color.border.default,
  },
});

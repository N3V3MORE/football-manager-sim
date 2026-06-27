import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { color, radius, space, type } from '@/src/design/tokens';

export type Segment<T extends string> = { label: string; value: T };

type SegmentedControlProps<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Optional accessibility label for the group. */
  label?: string;
};

/**
 * Segmented control. Replaces the 3 duplicate tactic/pane switchers
 * (squad, tactics, match) with one component. Active segment uses the accent
 * surface; inactive segments are transparent with muted labels.
 */
export function SegmentedControl<T extends string>({ segments, value, onChange, label }: SegmentedControlProps<T>) {
  return (
    <View style={styles.container} accessibilityRole="tablist" accessibilityLabel={label}>
      {segments.map(segment => {
        const active = segment.value === value;
        return (
          <TouchableOpacity
            key={segment.value}
            onPress={() => onChange(segment.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={segment.label}
            activeOpacity={0.85}
            style={[styles.option, active && styles.optionActive]}
          >
            <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
              {segment.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: color.bg.card,
    borderRadius: radius.none,
    padding: 4,
    borderWidth: 1,
    borderColor: color.border.default,
  },
  option: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  optionActive: {
    backgroundColor: color.accent.primary,
  },
  optionText: {
    color: color.text.muted,
    fontSize: type.bodyStrong.fontSize,
    fontWeight: '800',
  },
  optionTextActive: {
    color: color.accent.onPrimary,
  },
});

import { useRef, type KeyboardEvent } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { color, radius, space, type } from '@/src/design/tokens';

export type Segment<T extends string> = { label: string; value: T };

type SegmentedControlProps<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Optional accessibility label for the group. */
  label?: string;
  wrapLabels?: boolean;
};

/**
 * Segmented control. Replaces the 3 duplicate tactic/pane switchers
 * (squad, tactics, match) with one component. Active segment uses the accent
 * surface; inactive segments are transparent with muted labels.
 */
export function SegmentedControl<T extends string>({ segments, value, onChange, label, wrapLabels = false }: SegmentedControlProps<T>) {
  const optionRefs = useRef<Record<string, View | null>>({});
  const activeIndex = Math.max(0, segments.findIndex(segment => segment.value === value));
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    let nextIndex = index;
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) onChange(segments[index].value);
        return;
      case 'ArrowLeft': nextIndex = (index - 1 + segments.length) % segments.length; break;
      case 'ArrowRight': nextIndex = (index + 1) % segments.length; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = segments.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    const selected = segments[nextIndex];
    optionRefs.current[selected.value]?.focus();
    onChange(selected.value);
  };
  return (
    <View style={styles.container} accessibilityRole="tablist" accessibilityLabel={label}>
      {segments.map((segment, index) => {
        const active = segment.value === value;
        return (
          <TouchableOpacity
            key={segment.value}
            ref={view => { optionRefs.current[segment.value] = view; }}
            {...(Platform.OS === 'web' ? {
              tabIndex: index === activeIndex ? 0 : -1,
              onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => handleKeyDown(event, index),
            } : {})}
            onPress={() => onChange(segment.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            aria-selected={active}
            accessibilityLabel={segment.label}
            activeOpacity={0.85}
            style={[styles.option, active && styles.optionActive]}
          >
            <Text style={[styles.optionText, wrapLabels && styles.wrappedOptionText, active && styles.optionTextActive]} numberOfLines={wrapLabels ? 3 : 1}>
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
  wrappedOptionText: { fontSize: 12, textAlign: 'center' },
});

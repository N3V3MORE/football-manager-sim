import { StyleSheet, ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { color, space } from '@/src/design/tokens';

type ScreenProps = {
  children?: React.ReactNode;
  /** When true (default), wraps content in a vertical ScrollView. */
  scroll?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  /** Safe-area edges to inset. Defaults to top-only (tab screens). */
  edges?: Edge[];
};

/**
 * App screen shell. Applies the canonical screen background + safe-area insets
 * and optional scroll. Replaces per-screen `<SafeAreaView style={{backgroundColor:'#0f172a'}}>` boilerplate.
 */
export function Screen({ children, scroll = true, style, contentContainerStyle, edges = ['top'] }: ScreenProps) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.container, style]} edges={edges}>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg.screen },
  fill: { flex: 1 },
  scrollContent: { padding: space.lg, paddingBottom: space.xxl + space.lg },
});

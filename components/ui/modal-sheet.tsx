import { StyleSheet, Text, TouchableOpacity, View, Modal, Pressable, ScrollView, type ViewStyle } from 'react-native';

import { color, radius, space, type } from '@/src/design/tokens';

type ModalSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /**
   * `sheet` slides up from the bottom (default); `dialog` is a centered card.
   * The two variants share one API so screens don't reimplement Modal scaffolding.
   */
  variant?: 'sheet' | 'dialog';
  /** Dismiss when the backdrop is tapped. Defaults to true. */
  dismissable?: boolean;
  children?: React.ReactNode;
  /** Optional sticky footer (e.g. confirm/cancel buttons). */
  footer?: React.ReactNode;
  style?: ViewStyle;
};

/**
 * Canonical modal. Replaces the ~7 hand-rolled Modal implementations across
 * screens (league, team-selection-sheet, squad info, etc.) and fixes the
 * rounded-vs-square corner inconsistency by routing everything through one
 * radius source. Backdrop tap, close button, and a11y roles are built in.
 */
export function ModalSheet({
  visible,
  onClose,
  title,
  subtitle,
  variant = 'sheet',
  dismissable = true,
  children,
  footer,
  style,
}: ModalSheetProps) {
  return (
    <Modal visible={visible} transparent animationType={variant === 'sheet' ? 'slide' : 'fade'} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={dismissable ? onClose : undefined} accessibilityRole="button" accessibilityLabel="Close dialog">
        <Pressable
          style={[styles.surface, variant === 'sheet' ? styles.sheet : styles.dialog, style]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="alert"
          accessibilityLabel={title}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={2}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  surface: {
    backgroundColor: color.bg.card,
    borderWidth: 1,
    borderColor: color.border.default,
    maxHeight: '85%',
  },
  sheet: {
    borderTopLeftRadius: radius.none,
    borderTopRightRadius: radius.none,
    borderBottomWidth: 0,
  },
  dialog: {
    margin: space.xl,
    borderRadius: radius.lg,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border.default,
  },
  headerText: { flex: 1, marginRight: space.md },
  title: { color: color.text.primary, fontSize: type.h2.fontSize, fontWeight: '900' },
  subtitle: { color: color.text.faint, fontSize: type.body.fontSize, marginTop: 2 },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bg.elevated,
    borderRadius: radius.none,
  },
  closeText: { color: color.text.muted, fontSize: 16, fontWeight: '900' },
  body: {},
  bodyContent: { padding: space.lg },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    padding: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.border.default,
  },
});

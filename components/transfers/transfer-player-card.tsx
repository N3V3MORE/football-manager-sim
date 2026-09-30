import React from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { color } from '@/src/design/tokens';
import { Player } from '@/src/models/types';

type TransferPlayerCardProps = {
  player: Player;
  subLabel: string;
  actionLabel: string;
  actionVariant?: 'primary' | 'danger';
  onAction: () => void;
  secondaryActionLabel?: string;
  secondaryActionVariant?: 'primary' | 'danger';
  onSecondaryAction?: () => void;
};

export function TransferPlayerCard({
  player,
  subLabel,
  actionLabel,
  actionVariant = 'primary',
  onAction,
  secondaryActionLabel,
  secondaryActionVariant = 'primary',
  onSecondaryAction,
}: TransferPlayerCardProps) {
  const compact = useWindowDimensions().width < 600;
  return (
    <View style={[styles.card, compact && styles.compactCard]}>
      <View style={[styles.cardLeft, compact && styles.compactLeft]}>
        <Text style={styles.pos}>{player.subPosition || player.position}</Text>
        <View style={styles.playerTextBlock}>
          <Text style={styles.name} numberOfLines={compact ? 2 : 1}>{player.name}</Text>
          <Text style={styles.club} numberOfLines={compact ? 2 : 1}>{subLabel}</Text>
        </View>
      </View>
      <View style={[styles.cardRight, compact && styles.compactRight]}>
        <View style={styles.ratingBox}>
          <Text style={styles.rating}>{player.overallRating}</Text>
        </View>
        <TouchableOpacity
          style={[styles.actionBtn, actionVariant === 'danger' && styles.actionBtnDanger]}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} ${player.name}`}
        >
          <Text style={[styles.actionText, actionVariant === 'danger' && styles.actionTextDanger]}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
        {secondaryActionLabel && onSecondaryAction ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.secondaryActionBtn, secondaryActionVariant === 'danger' && styles.actionBtnDanger]}
            onPress={onSecondaryAction}
            accessibilityRole="button"
            accessibilityLabel={`${secondaryActionLabel} ${player.name}`}
          >
            <Text style={[styles.actionText, styles.secondaryActionText, secondaryActionVariant === 'danger' && styles.actionTextDanger]}>
              {secondaryActionLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.bg.card, padding: 12, borderRadius: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  compactCard: { flexDirection: 'column', alignItems: 'stretch' },
  compactLeft: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%' },
  compactRight: { justifyContent: 'space-between', flexWrap: 'wrap' },
  cardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  playerTextBlock: { flex: 1, minWidth: 0 },
  pos: { width: 34, textAlign: 'center', backgroundColor: color.bg.elevated, color: color.text.primary, paddingVertical: 4, borderRadius: 0, fontSize: 10, fontWeight: '900' },
  name: { color: color.text.primary, fontWeight: '700', fontSize: 15 },
  club: { color: color.text.muted, fontSize: 12, marginTop: 2 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ratingBox: { backgroundColor: color.text.secondary, width: 28, height: 28, borderRadius: 0, justifyContent: 'center', alignItems: 'center' },
  rating: { color: color.bg.screen, fontWeight: '900', fontSize: 12 },
  actionBtn: { minHeight: 44, justifyContent: 'center', backgroundColor: color.accent.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 0 },
  actionBtnDanger: { backgroundColor: color.danger.base },
  secondaryActionBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.text.faint },
  actionText: { color: color.accent.onPrimary, fontWeight: '900', fontSize: 12 },
  secondaryActionText: { color: color.text.secondary },
  actionTextDanger: { color: color.text.primary },
});

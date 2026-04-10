import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { InboxMessage } from '@/src/models/types';

type InboxMessageCardProps = {
  message: InboxMessage;
  onMarkRead: (messageId: string) => void;
  onDismiss: (messageId: string) => void;
  onApply: (messageId: string) => void;
};

const SOURCE_LABELS: Record<InboxMessage['source'], string> = {
  assistant: 'Assistant Coach',
  system: 'System',
};

const CATEGORY_LABELS: Record<InboxMessage['category'], string> = {
  system_news: 'League',
  season_update: 'Season',
  board_update: 'Board',
  injury_update: 'Fitness',
  pre_match_energy: 'Energy',
  pre_match_availability: 'Availability',
  lineup_suggestion: 'Lineup',
  tactic_suggestion: 'Tactics',
  post_match_report: 'Report',
  transfer_advice: 'Market',
  squad_warning: 'Squad',
  contract_warning: 'Contract',
  career_sack_warning: 'Career',
  career_job_offer: 'Career',
  career_milestone: 'Career',
};

const getActionLabel = (message: InboxMessage) => {
  if (!message.action) return null;
  if (message.action.type === 'apply_lineup') return 'Apply Lineup Suggestion';
  if (message.action.type === 'accept_job_offer') return 'Accept Job Offer';
  if (message.action.type === 'renew_contract') return 'Renew Contract';
  return 'Apply Tactic Suggestion';
};

export function InboxMessageCard({
  message,
  onMarkRead,
  onDismiss,
  onApply,
}: InboxMessageCardProps) {
  const actionLabel = getActionLabel(message);

  return (
    <View style={[styles.card, !message.isRead && styles.cardUnread]}>
      <View style={styles.headerRow}>
        <View style={styles.metaRow}>
          <View style={[styles.chip, message.source === 'assistant' ? styles.assistantChip : styles.systemChip]}>
            <Text style={styles.chipText}>{SOURCE_LABELS[message.source]}</Text>
          </View>
          <View style={styles.categoryChip}>
            <Text style={styles.categoryText}>{CATEGORY_LABELS[message.category]}</Text>
          </View>
        </View>
        <Text style={styles.weekLabel}>W{message.week}</Text>
      </View>

      <Text style={styles.title}>{message.title}</Text>
      <Text style={styles.body}>{message.body}</Text>

      <View style={styles.actionsRow}>
        {!message.isRead ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onMarkRead(message.id)}>
            <Text style={styles.secondaryText}>Mark Read</Text>
          </TouchableOpacity>
        ) : null}
        {actionLabel ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => onApply(message.id)}>
            <Text style={styles.primaryText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.dismissButton} onPress={() => onDismiss(message.id)}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    gap: 10,
  },
  cardUnread: {
    borderColor: '#38bdf8',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  assistantChip: { backgroundColor: '#082f49' },
  systemChip: { backgroundColor: '#3f3f46' },
  chipText: { color: '#e2e8f0', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  categoryChip: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#475569',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryText: { color: '#cbd5e1', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  weekLabel: { color: '#64748b', fontSize: 11, fontWeight: '900' },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '900' },
  body: { color: '#cbd5e1', fontSize: 14, lineHeight: 22 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: '#38bdf8',
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryText: { color: '#082f49', fontSize: 12, fontWeight: '900' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryText: { color: '#e2e8f0', fontSize: 12, fontWeight: '800' },
  dismissButton: {
    borderWidth: 1,
    borderColor: '#7f1d1d',
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dismissText: { color: '#fca5a5', fontSize: 12, fontWeight: '800' },
});

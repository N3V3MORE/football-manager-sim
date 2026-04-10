import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { InboxMessage } from '@/src/models/types';

type InboxPreviewCardProps = {
  messages: InboxMessage[];
  unreadCount: number;
  onPress: () => void;
};

const getSourceLabel = (source: InboxMessage['source']) => (
  source === 'assistant' ? 'Assistant Coach' : 'System'
);

export function InboxPreviewCard({ messages, unreadCount, onPress }: InboxPreviewCardProps) {
  const items = messages.slice(0, 3);

  return (
    <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.cardTitle}>Inbox</Text>
        {unreadCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount} unread</Text>
          </View>
        ) : null}
      </View>

      {items.length > 0 ? (
        items.map(message => (
          <View key={message.id} style={[styles.item, !message.isRead && styles.itemUnread]}>
            <View style={styles.row}>
              <Text style={styles.source}>{getSourceLabel(message.source)}</Text>
              {!message.isRead ? <Text style={styles.unreadDot}>NEW</Text> : null}
            </View>
            <Text style={styles.title} numberOfLines={1}>{message.title}</Text>
            <Text style={styles.body} numberOfLines={2}>{message.body}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>No inbox items yet. Advance the week to generate reports and advice.</Text>
      )}

      <Text style={styles.footer}>Open full inbox</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#38bdf8', letterSpacing: 0.5 },
  badge: {
    backgroundColor: '#082f49',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: '#7dd3fc', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  item: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 12,
    marginBottom: 10,
  },
  itemUnread: {
    borderColor: '#38bdf8',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  source: { color: '#94a3b8', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  unreadDot: { color: '#38bdf8', fontSize: 11, fontWeight: '900' },
  title: { color: '#f8fafc', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  body: { color: '#cbd5e1', fontSize: 13, lineHeight: 20 },
  empty: { fontSize: 14, color: '#cbd5e1', lineHeight: 22, fontWeight: '600' },
  footer: {
    marginTop: 4,
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
});

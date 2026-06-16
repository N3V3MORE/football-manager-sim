import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { InboxMessage } from '@/src/models/types';

type InboxPreviewCardProps = {
  messages: InboxMessage[];
  unreadCount: number;
  onPress: () => void;
};



export default React.memo(function InboxPreviewCard({ messages, unreadCount, onPress }: InboxPreviewCardProps) {
  const latestMessage = messages[0];

  return (
    <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.cardTitle}>ASSISTANT</Text>
        {unreadCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        {latestMessage ? (
          <>
            <Text style={styles.sourceLabel}>Latest Status:</Text>
            <Text style={styles.title} numberOfLines={2}>{latestMessage.title}</Text>
          </>
        ) : (
          <Text style={styles.empty}>No messages.</Text>
        )}
      </View>

      <Text style={styles.footer}>View Inbox</Text>
    </TouchableOpacity>
  );
}
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    padding: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    flex: 1,
    aspectRatio: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitle: { fontSize: 11, fontWeight: '900', color: '#facc15', letterSpacing: 1.2, textTransform: 'uppercase' },
  badge: {
    backgroundColor: '#ef4444',
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  content: { flex: 1, justifyContent: 'center' },
  sourceLabel: { color: '#64748b', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', marginBottom: 2 },
  title: { color: '#f8fafc', fontSize: 12, fontWeight: '800' },
  empty: { fontSize: 11, color: '#475569', fontWeight: '600' },
  footer: {
    marginTop: 8,
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
});

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { PageHeader } from '@/components/ui/page-header';
import { InboxMessageCard } from '@/components/ui/inbox-message-card';
import { useGameStore } from '@/src/store/gameStore';

export default function InboxScreen() {
  const inboxMessages = useGameStore(state => state.inboxMessages);
  const markInboxMessageRead = useGameStore(state => state.markInboxMessageRead);
  const dismissInboxMessage = useGameStore(state => state.dismissInboxMessage);
  const applyInboxAction = useGameStore(state => state.applyInboxAction);

  const unreadCount = inboxMessages.filter(message => !message.isRead).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHeader
        title="Inbox"
        backLabel="< Hub"
        subtitle={unreadCount > 0 ? `${unreadCount} unread item${unreadCount === 1 ? '' : 's'}` : 'All caught up'}
        onBack={() => router.replace('/')}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {inboxMessages.length > 0 ? (
          inboxMessages.map(message => (
            <InboxMessageCard
              key={message.id}
              message={message}
              onMarkRead={markInboxMessageRead}
              onDismiss={dismissInboxMessage}
              onApply={applyInboxAction}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No inbox items</Text>
            <Text style={styles.emptyText}>
              Match reports, board updates, and assistant coach notes will land here once the season starts moving.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: {
    padding: 16,
    gap: 12,
  },
  emptyCard: {
    backgroundColor: '#1e293b',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 18,
    marginTop: 8,
  },
  emptyTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '900', marginBottom: 6 },
  emptyText: { color: '#cbd5e1', fontSize: 14, lineHeight: 22 },
});

import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { PageHeader } from '@/components/ui/page-header';
import { Screen, EmptyState } from '@/components/ui';
import { InboxMessageCard } from '@/components/ui/inbox-message-card';
import { useGameStore } from '@/src/store/gameStore';
import { space } from '@/src/design/tokens';

export default function InboxScreen() {
  const inboxMessages = useGameStore(state => state.inboxMessages);
  const markInboxMessageRead = useGameStore(state => state.markInboxMessageRead);
  const dismissInboxMessage = useGameStore(state => state.dismissInboxMessage);
  const applyInboxAction = useGameStore(state => state.applyInboxAction);

  const unreadCount = inboxMessages.filter(message => !message.isRead).length;

  return (
    <Screen scroll={false}>
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
          <EmptyState
            title="No inbox items"
            message="Match reports, board updates, and assistant coach notes will land here once the season starts moving."
          />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: space.lg,
    gap: space.md,
  },
});

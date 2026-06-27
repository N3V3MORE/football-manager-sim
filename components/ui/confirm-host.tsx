import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { ModalSheet, Button } from '@/components/ui';
import { color, space } from '@/src/design/tokens';
import { useConfirmStore } from '@/src/store/confirmStore';

/**
 * Single host rendered once in the root layout. Reads the confirm store and
 * surfaces whatever alert/confirm a screen has requested. One host keeps every
 * screen out of the modal-scaffolding business.
 */
export function ConfirmHost() {
  const state = useConfirmStore(s => s.state);
  const dismiss = useConfirmStore(s => s.dismiss);

  const visible = state !== null;
  const title = state?.options.title ?? '';
  const message = state?.options.message;

  return (
    <ModalSheet
      visible={visible}
      onClose={dismiss}
      title={title}
      variant="dialog"
      dismissable={false}
      footer={
        state?.kind === 'confirm' ? (
          <>
            <Button
              title={state.options.cancelText || 'Cancel'}
              variant="secondary"
              onPress={dismiss}
              style={{ flex: 1 }}
            />
            <Button
              title={state.options.confirmText || 'Confirm'}
              variant={state.options.destructive ? 'danger' : 'primary'}
              onPress={() => {
                state.options.onConfirm();
                dismiss();
              }}
              style={{ flex: 1 }}
            />
          </>
        ) : (
          <Button
            title={state?.options.okText || 'OK'}
            variant="primary"
            onPress={dismiss}
            fullWidth
          />
        )
      }
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  message: {
    color: color.text.secondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: space.xs,
  },
});

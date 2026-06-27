import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { ModalSheet, Button } from '@/components/ui';
import { color } from '@/src/design/tokens';

type SquadInfoModalProps = {
  visible: boolean;
  onClose: () => void;
};

export function SquadInfoModal({ visible, onClose }: SquadInfoModalProps) {
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="How to Use"
      variant="dialog"
      dismissable={false}
      footer={<Button title="Got it" variant="primary" onPress={onClose} fullWidth />}
    >
      <Text style={styles.body}>
        {'- Tap a pitch circle to assign a player to that position.\n\n' +
         '- Drag a pitch player to another slot to swap positions.\n\n' +
         '- Tap any non-starting player in Reserves to add them to the Bench.\n\n' +
         '- Long-press a Bench player to move them back to Reserves.\n\n' +
         '- Use the Formation dropdown to switch formations.\n\n' +
         '- Under the Tactics pane, set Mentality (Defensive / Balanced / Attacking) and the other sliders to adjust your team\'s style.'}
      </Text>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  body: { color: color.text.muted, lineHeight: 22, fontSize: 14 },
});

import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type SquadInfoModalProps = {
  visible: boolean;
  onClose: () => void;
};

export function SquadInfoModal({ visible, onClose }: SquadInfoModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>How to Use</Text>
          <Text style={styles.body}>
            {'- Tap a pitch circle to assign a player to that position.\n\n' +
             '- Drag a pitch player to another slot to swap positions.\n\n' +
             '- Tap any non-starting player in Reserves to add them to the Bench.\n\n' +
             '- Long-press a Bench player to move them back to Reserves.\n\n' +
             '- Use the Formation dropdown to switch formations.\n\n' +
             '- Set DEFEND / BALANCED / ATTACK strategy to adjust your team\'s style.'}
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', paddingHorizontal: 30 },
  card: { backgroundColor: '#1e293b', borderRadius: 0, padding: 24, borderWidth: 1, borderColor: '#334155' },
  title: { fontSize: 18, fontWeight: '900', color: '#f8fafc', marginBottom: 16 },
  body: { color: '#94a3b8', lineHeight: 22, fontSize: 14 },
  closeButton: { marginTop: 20, backgroundColor: '#334155', borderRadius: 0, paddingVertical: 12, alignItems: 'center' },
  closeText: { color: '#f8fafc', fontWeight: '900' },
});

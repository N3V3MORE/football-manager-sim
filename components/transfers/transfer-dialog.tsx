import React from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Player } from '@/src/models/types';

export type TransferDialogState =
  | { type: 'buy'; player: Player; fee: string; wage: string }
  | { type: 'sell'; player: Player; price: string }
  | null;

type TransferDialogProps = {
  dialog: TransferDialogState;
  budget: number;
  onClose: () => void;
  onChangeValue: (field: 'fee' | 'wage' | 'price', value: string) => void;
  onSubmit: () => void;
};

export function TransferDialog({
  dialog,
  budget,
  onClose,
  onChangeValue,
  onSubmit,
}: TransferDialogProps) {
  return (
    <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {dialog && (
            <>
              <Text style={styles.modalTitle}>{dialog.type === 'buy' ? 'Make Transfer Offer' : 'List Player'}</Text>
              <Text style={styles.modalSubtitle}>{dialog.player.name}</Text>

              {dialog.type === 'buy' ? (
                <>
                  <Text style={styles.fieldLabel}>Transfer fee (GBP millions)</Text>
                  <TextInput
                    value={dialog.fee}
                    onChangeText={(value) => onChangeValue('fee', value)}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    placeholderTextColor="#64748b"
                  />
                  <Text style={styles.fieldHint}>
                    Asking price: GBP {dialog.player.askingPrice.toFixed(1)}m | Budget: GBP {budget.toFixed(1)}m
                  </Text>

                  <Text style={styles.fieldLabel}>Wage (GBP k/week)</Text>
                  <TextInput
                    value={dialog.wage}
                    onChangeText={(value) => onChangeValue('wage', value)}
                    keyboardType="number-pad"
                    style={styles.input}
                    placeholderTextColor="#64748b"
                  />
                  <Text style={styles.fieldHint}>Current wage: GBP {dialog.player.wage}k/w</Text>
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Asking price (GBP millions)</Text>
                  <TextInput
                    value={dialog.price}
                    onChangeText={(value) => onChangeValue('price', value)}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    placeholderTextColor="#64748b"
                  />
                  <Text style={styles.fieldHint}>Market value: GBP {dialog.player.marketValue}m</Text>
                </>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSubmit} onPress={onSubmit}>
                  <Text style={styles.modalSubmitText}>{dialog.type === 'buy' ? 'Submit Offer' : 'List Player'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1e293b', borderRadius: 0, padding: 18, borderWidth: 1, borderColor: '#334155' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '900' },
  modalSubtitle: { color: '#94a3b8', fontSize: 13, marginTop: 4, marginBottom: 16, fontWeight: '700' },
  fieldLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '900', marginTop: 10, marginBottom: 6 },
  fieldHint: { color: '#64748b', fontSize: 11, marginTop: 6, lineHeight: 16 },
  input: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 0, color: '#f8fafc', fontSize: 16, fontWeight: '800', paddingHorizontal: 12, paddingVertical: 10 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalCancel: { flex: 1, backgroundColor: '#334155', borderRadius: 0, paddingVertical: 12, alignItems: 'center' },
  modalCancelText: { color: '#cbd5e1', fontWeight: '900' },
  modalSubmit: { flex: 1, backgroundColor: '#38bdf8', borderRadius: 0, paddingVertical: 12, alignItems: 'center' },
  modalSubmitText: { color: '#0f172a', fontWeight: '900' },
});

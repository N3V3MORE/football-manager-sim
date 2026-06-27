import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { Player } from '@/src/models/types';
import { ModalSheet, Button } from '@/components/ui';
import { color, space } from '@/src/design/tokens';

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
  const title = dialog ? (dialog.type === 'buy' ? 'Make Transfer Offer' : 'List Player') : '';
  return (
    <ModalSheet
      visible={dialog !== null}
      onClose={onClose}
      title={title}
      subtitle={dialog?.player.name}
      variant="dialog"
      dismissable={false}
      footer={
        <>
          <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button
            title={dialog?.type === 'buy' ? 'Submit Offer' : 'List Player'}
            variant="primary"
            onPress={onSubmit}
            style={{ flex: 1 }}
          />
        </>
      }
    >
      {dialog?.type === 'buy' && (
        <>
          <Text style={styles.fieldLabel}>Transfer fee (GBP millions)</Text>
          <TextInput
            value={dialog.fee}
            onChangeText={(value) => onChangeValue('fee', value)}
            keyboardType="decimal-pad"
            style={styles.input}
            placeholderTextColor={color.text.faint}
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
            placeholderTextColor={color.text.faint}
          />
          <Text style={styles.fieldHint}>Current wage: GBP {dialog.player.wage}k/w</Text>
        </>
      )}

      {dialog?.type === 'sell' && (
        <>
          <Text style={styles.fieldLabel}>Asking price (GBP millions)</Text>
          <TextInput
            value={dialog.price}
            onChangeText={(value) => onChangeValue('price', value)}
            keyboardType="decimal-pad"
            style={styles.input}
            placeholderTextColor={color.text.faint}
          />
          <Text style={styles.fieldHint}>Market value: GBP {dialog.player.marketValue}m</Text>
        </>
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { color: color.text.secondary, fontSize: 12, fontWeight: '900', marginTop: space.md, marginBottom: 6 },
  fieldHint: { color: color.text.faint, fontSize: 11, marginTop: 6, lineHeight: 16 },
  input: {
    backgroundColor: color.bg.screen,
    borderWidth: 1,
    borderColor: color.border.default,
    borderRadius: 0,
    color: color.text.primary,
    fontSize: 16,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});

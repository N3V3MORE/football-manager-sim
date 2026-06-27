import React from 'react';
import { View } from 'react-native';
import { SegmentedControl } from '@/components/ui';
import { space } from '@/src/design/tokens';

type TransferTab = 'market' | 'squad';

type TransferTabsProps = {
  activeTab: TransferTab;
  marketCount: number;
  onChange: (tab: TransferTab) => void;
};

export function TransferTabs({ activeTab, marketCount, onChange }: TransferTabsProps) {
  const segments = [
    { label: `Market (${marketCount})`, value: 'market' as const },
    { label: 'Sell Players', value: 'squad' as const },
  ];
  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs }}>
      <SegmentedControl
        segments={segments}
        value={activeTab}
        onChange={onChange}
        label="Transfer tabs"
      />
    </View>
  );
}

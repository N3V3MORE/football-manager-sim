import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type TransferTab = 'market' | 'squad';

type TransferTabsProps = {
  activeTab: TransferTab;
  marketCount: number;
  onChange: (tab: TransferTab) => void;
};

export default React.memo(function TransferTabs({ activeTab, marketCount, onChange }: TransferTabsProps) {
  return (
    <View style={styles.tabs}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'market' && styles.tabActive]}
        onPress={() => onChange('market')}
      >
        <Text style={[styles.tabText, activeTab === 'market' && styles.tabTextActive]}>
          Market ({marketCount})
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'squad' && styles.tabActive]}
        onPress={() => onChange('squad')}
      >
        <Text style={[styles.tabText, activeTab === 'squad' && styles.tabTextActive]}>
          Sell Players
        </Text>
      </TouchableOpacity>
    </View>
  );
}
);

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#334155' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#38bdf8' },
  tabText: { color: '#64748b', fontWeight: '800' },
  tabTextActive: { color: '#38bdf8' },
});

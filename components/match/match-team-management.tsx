import { Text, View, TouchableOpacity } from 'react-native';
import { Button } from '@/components/ui';
import type { Player } from '@/src/models/types';
import { matchStyles as styles } from './match-styles';

type MatchManagementProps = {
  remainingSubs: number; maxSubs: number; remainingWindows: number; maxWindows: number;
  isManagingHalfTime: boolean; formationLabel: string;
  manageableCurrentPlayers: Player[]; manageableBenchPlayers: Player[];
  selectedOffPlayerId: string | null; selectedOnPlayerId: string | null;
  pendingReplacements: { offPlayerId: string; onPlayerId: string; offName?: string; onName?: string }[];
  canQueueSubstitution: boolean;
  onSelectOff: (playerId: string) => void; onSelectOn: (playerId: string) => void;
  onOpenFormation: () => void; onQueue: () => void; onApply: () => void;
};

export function MatchTeamManagement({ remainingSubs, maxSubs, remainingWindows, maxWindows, isManagingHalfTime,
  formationLabel, manageableCurrentPlayers, manageableBenchPlayers, selectedOffPlayerId, selectedOnPlayerId,
  pendingReplacements, canQueueSubstitution, onSelectOff, onSelectOn, onOpenFormation, onQueue, onApply }: MatchManagementProps) {
  return (
  <View style={styles.liveControlPanel}>
    <View style={styles.liveControlHeader}>
      <View>
        <Text style={styles.liveControlTitle}>Live Team</Text>
        <Text style={styles.liveControlMeta}>
          Subs {remainingSubs} / {maxSubs} · Windows {remainingWindows} / {maxWindows}{isManagingHalfTime ? ' · Half-time window free' : ''}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.shapeButton}
        onPress={onOpenFormation}
        accessibilityRole="button"
        accessibilityLabel="Change live formation"
      >
        <Text style={styles.shapeButtonText}>{formationLabel}</Text>
      </TouchableOpacity>
    </View>

    <View style={styles.subPickerGrid}>
      <View style={styles.subPickerCol}>
        <Text style={styles.subPickerTitle}>Off</Text>
        {manageableCurrentPlayers.map(player => (
          <TouchableOpacity
            key={player.id}
            style={[styles.subPlayerRow, selectedOffPlayerId === player.id && styles.subPlayerSelected]}
            onPress={() => onSelectOff(player.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedOffPlayerId === player.id }}
          >
            <Text style={styles.subPlayerName} numberOfLines={1}>{player.name}</Text>
            <Text style={styles.subPlayerMeta}>{player.subPosition || player.position}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.subPickerCol}>
        <Text style={styles.subPickerTitle}>On</Text>
        {manageableBenchPlayers.map(player => (
          <TouchableOpacity
            key={player.id}
            style={[styles.subPlayerRow, selectedOnPlayerId === player.id && styles.subPlayerSelected]}
            onPress={() => onSelectOn(player.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedOnPlayerId === player.id }}
          >
            <Text style={styles.subPlayerName} numberOfLines={1}>{player.name}</Text>
            <Text style={styles.subPlayerMeta}>{player.subPosition || player.position}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
    <View style={styles.pendingSubsBox}>
      {pendingReplacements.length === 0 ? (
        <Text style={styles.pendingSubText}>No pending substitutions</Text>
      ) : pendingReplacements.map((replacement, index) => (
        <Text key={`${replacement.offPlayerId}-${replacement.onPlayerId}`} style={styles.pendingSubText}>
          {index + 1}. {replacement.offName} {'->'} {replacement.onName}
        </Text>
      ))}
    </View>
    <View style={styles.subActionRow}>
      <Button
        title="Queue Sub"
        variant="secondary"
        onPress={onQueue}
        disabled={!selectedOffPlayerId || !selectedOnPlayerId || !canQueueSubstitution}
      />
      <Button
        title="Apply Subs"
        variant="primary"
        onPress={onApply}
        disabled={pendingReplacements.length === 0}
      />
    </View>
  </View>
  );
}

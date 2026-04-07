import React from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useGameStore } from '@/src/store/gameStore';
import { PageHeader } from '@/components/ui/page-header';

export default function BoardScreen() {
  const userTeamId = useGameStore(s => s.userTeamId);
  const teams = useGameStore(s => s.teams);
  const objectives = useGameStore(s => s.boardObjectives);

  if (!userTeamId) return <View style={styles.container} />;
  const team = teams[userTeamId];
  const approval = team?.boardApproval || 50;

  let statusText = 'Stable';
  let statusColor = '#f59e0b'; // yellow
  if (approval < 15) { statusText = 'Sacking Risk'; statusColor = '#7f1d1d'; }
  else if (approval < 30) { statusText = 'Under Pressure'; statusColor = '#ef4444'; }
  else if (approval >= 80) { statusText = 'Untouchable'; statusColor = '#10B981'; }
  else if (approval >= 65) { statusText = 'Secure'; statusColor = '#34d399'; }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHeader title="Board Room" backLabel="< Hub" onBack={() => router.replace('/')} />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.gaugeCard}>
           <Text style={styles.gaugeLabel}>Manager Approval Rating</Text>
           <Text style={[styles.gaugeValue, { color: statusColor }]}>{Math.round(approval)}%</Text>
           <Text style={styles.gaugeStatus}>{statusText}</Text>
           
           {/* Progress bar visual */}
           <View style={styles.barBg}>
              <View style={[styles.barFill, { width: `${approval}%`, backgroundColor: statusColor }]} />
           </View>
        </View>

        <Text style={styles.sectionTitle}>Season Objectives</Text>
        {objectives && objectives.length > 0 ? objectives.map(obj => (
          <View key={obj.id} style={styles.objCard}>
             <Text style={styles.objDesc}>{obj.description}</Text>
             <View style={[styles.statusBadge, obj.met ? styles.metBadge : styles.pendingBadge]}>
                <Text style={[styles.statusText, obj.met ? styles.metText : styles.pendingText]}>
                   {obj.met ? 'Met' : 'In Progress'}
                </Text>
             </View>
          </View>
        )) : (
          <Text style={styles.empty}>No objectives set.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 16, gap: 16 },
  gaugeCard: { backgroundColor: '#1e293b', padding: 20, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  gaugeLabel: { color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', fontWeight: '900', letterSpacing: 1 },
  gaugeValue: { fontSize: 48, fontWeight: '900', marginTop: 10 },
  gaugeStatus: { color: '#cbd5e1', fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 20 },
  barBg: { height: 8, width: '100%', backgroundColor: '#0f172a', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  sectionTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800', marginTop: 10 },
  objCard: { backgroundColor: '#1e293b', padding: 16, borderRadius: 10, borderWidth: 1, borderColor: '#334155', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  objDesc: { color: '#e2e8f0', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  metBadge: { backgroundColor: '#064e3b' },
  pendingBadge: { backgroundColor: '#1e3a8a' },
  statusText: { fontSize: 11, fontWeight: '900' },
  metText: { color: '#34d399' },
  pendingText: { color: '#60a5fa' },
  empty: { color: '#64748b', fontStyle: 'italic' }
});

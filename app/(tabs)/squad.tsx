import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, Pressable
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState } from 'react';
import { useGameStore } from '@/src/store/gameStore';
import { Formation, Player } from '@/src/models/types';

// ─── Formation slot definitions ──────────────────────────────────────────────
interface Slot { pos: 'GK' | 'DEF' | 'MID' | 'FWD'; label: string; }

const FORMATIONS: Formation[] = ['4-3-3', '4-4-2', '4-2-3-1', '5-2-3', '3-5-2', '4-1-4-1', '4-3-2-1'];

// Base slots for each formation family
const BASE_FORMATION_SLOTS: Record<string, Slot[][]> = {
  '4-3-3': [
    [{ pos: 'FWD', label: 'LW' }, { pos: 'FWD', label: 'CF' }, { pos: 'FWD', label: 'RW' }],
    [{ pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-4-2': [
    [{ pos: 'FWD', label: 'ST' }, { pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'LM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'RM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-2-3-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'AM' }, { pos: 'MID', label: 'AM' }, { pos: 'MID', label: 'AM' }],
    [{ pos: 'MID', label: 'DM' }, { pos: 'MID', label: 'DM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '5-2-3': [
    [{ pos: 'FWD', label: 'LW' }, { pos: 'FWD', label: 'ST' }, { pos: 'FWD', label: 'RW' }],
    [{ pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }],
    [{ pos: 'DEF', label: 'WB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'WB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '3-5-2': [
    [{ pos: 'FWD', label: 'ST' }, { pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'LM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'DM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'RM' }],
    [{ pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-1-4-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'LM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'RM' }],
    [{ pos: 'MID', label: 'DM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-3-2-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'AM' }, { pos: 'MID', label: 'AM' }],
    [{ pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
};

const getSlotsForFormation = (formation: string): Slot[][] => {
  const base = formation.split(' ')[0];
  return BASE_FORMATION_SLOTS[base] || BASE_FORMATION_SLOTS['4-3-3'];
};

export default function SquadScreen() {
  const userTeamId    = useGameStore(s => s.userTeamId);
  const players       = useGameStore(s => s.players);
  const teams         = useGameStore(s => s.teams);
  const setFormation  = useGameStore(s => s.setFormation);
  const setStrategy   = useGameStore(s => s.setStrategy);
  const swapPlayer    = useGameStore(s => s.swapPlayer);
  const markAsSub     = useGameStore(s => s.markAsSub);

  const [expandedCardId, setExpandedCardId]   = useState<string | null>(null);
  const [showFormationDrop, setShowFormationDrop] = useState(false);
  const [activeSlotIndex, setActiveSlotIndex] = useState<{ row: number; col: number } | null>(null);

  if (!userTeamId) return null;
  const myTeam  = teams[userTeamId];
  const mySquad = Object.values(players).filter(p => p.teamId === userTeamId);

  const sortOrder: Record<string, number> = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
  mySquad.sort((a, b) =>
    sortOrder[a.position] !== sortOrder[b.position]
      ? sortOrder[a.position] - sortOrder[b.position]
      : b.overallRating - a.overallRating
  );

  const activeFormation = myTeam?.activeFormation || '4-3-3';
  const baseFormation = activeFormation.split(' ')[0];
  const slots = getSlotsForFormation(activeFormation);

  const starters  = mySquad.filter(p => p.isStarting);
  const bench     = mySquad.filter(p => p.isSub);
  const reserves  = mySquad.filter(p => !p.isStarting && !p.isSub);

  const slotPlayers: (Player | null)[][] = slots.map((row: Slot[]) => {
    return row.map((slot: Slot) => {
      // Find a starter whose subPosition or broad position matches this slot
      return starters.find(p => p.isStarting && (p.subPosition === slot.label || p.position === slot.pos)) || null;
    });
  });

  const handleFormationSelect = (f: string) => {
    if (userTeamId) setFormation(userTeamId, f as Formation);
    setShowFormationDrop(false);
  };

  const getPosColor = (pos: string) => {
    switch (pos) {
      case 'GK':  return '#F59E0B';
      case 'DEF': return '#3B82F6';
      case 'MID': return '#10B981';
      case 'FWD': return '#EF4444';
      default:    return '#6B7280';
    }
  };

  const VARIANTS: Record<string, string[]> = {
    '4-3-3': ['4-3-3', '4-3-3 Attack', '4-3-3 Defend'],
    '4-4-2': ['4-4-2', '4-4-2 Diamond'],
  };

  const SLOT_SUBPOS: Record<string, string[]> = {
    GK: ['GK'],
    LB: ['LB', 'LWB'], RB: ['RB', 'RWB'],
    WB: ['WB', 'LWB', 'RWB', 'LB', 'RB'],
    CB: ['CB'],
    DM: ['CDM', 'CM'], AM: ['CAM', 'LM', 'CM', 'RM'],
    CM: ['CM', 'CDM', 'CAM'],
    LM: ['LM', 'LW'], RM: ['RM', 'RW'],
    LW: ['LW', 'LM', 'LF'], RW: ['RW', 'RM', 'RF'],
    LF: ['LF', 'LW'], RF: ['RF', 'RW'],
    ST: ['ST', 'CF'], CF: ['CF', 'ST'],
  };

  const getPickerSections = (slot: Slot, currentOccupantId: string | null) => {
    const pool = mySquad.filter(p => !p.isStarting || p.id === currentOccupantId)
      .sort((a, b) => b.overallRating - a.overallRating);
    const allowedSubPos = SLOT_SUBPOS[slot.label] || [];

    const recommended = pool.filter(p => allowedSubPos.includes(p.subPosition || p.position));
    const recIds = new Set(recommended.map(p => p.id));
    const alternatives = pool.filter(p => !recIds.has(p.id) && p.position === slot.pos);

    return { recommended, alternatives };
  };

  const handleSlotPress = (rowIdx: number, colIdx: number) => {
    setActiveSlotIndex({ row: rowIdx, col: colIdx });
  };

  const handlePickPlayer = (pickedId: string) => {
    const currentOccupant = activeSlotIndex
      ? slotPlayers[activeSlotIndex.row]?.[activeSlotIndex.col]
      : null;
    swapPlayer(currentOccupant?.id ?? null, pickedId);
    setActiveSlotIndex(null);
  };

  const handleSubToggle = (playerId: string) => {
    if (bench.length >= 7 && !bench.find(p => p.id === playerId)) return;
    markAsSub(playerId);
  };

  const strategy = myTeam?.strategy || 'balanced';

  const renderPlayerInPicker = (item: Player) => (
    <TouchableOpacity key={item.id} style={styles.pickerRow} onPress={() => handlePickPlayer(item.id)}>
      <View style={[styles.modalPosPill, { backgroundColor: getPosColor(item.position) }]}>
        <Text style={styles.modalPosText}>{item.subPosition || item.position}</Text>
      </View>
      <Text style={styles.pickerName} numberOfLines={1}>{item.name}</Text>
      <Text style={styles.pickerNat}>{item.nationality}</Text>
      <View style={styles.pickerRating}>
        <Text style={styles.pickerRatingText}>{item.overallRating}</Text>
      </View>
      {item.isStarting && <Text style={styles.pickerStarter}>★ In Selection</Text>}
    </TouchableOpacity>
  );

  const renderCompactPlayer = (item: Player, _unused1: boolean, _unused2: boolean, isBench: boolean) => {
    const isExpanded = expandedCardId === item.id;
    return (
      <View key={item.id}>
        <TouchableOpacity
          style={[styles.playerRow, isExpanded && styles.playerRowExpanded]}
          onPress={() => setExpandedCardId(isExpanded ? null : item.id)}
          onLongPress={() => handleSubToggle(item.id)}
          delayLongPress={400}
          activeOpacity={0.7}
        >
          <View style={[styles.posTag, { backgroundColor: getPosColor(item.position) }]}>
            <Text style={styles.posText}>{item.subPosition || item.position}</Text>
          </View>
          <View style={styles.playerMeta}>
            <Text style={styles.playerName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.nationality}>{item.nationality}</Text>
          </View>
          <View style={styles.playerRowRight}>
            <View style={styles.ratingBox}>
              <Text style={styles.ratingText}>{item.overallRating}</Text>
            </View>
            {isBench && (
              <View style={styles.benchBadge}>
                <Text style={styles.benchBadgeText}>SUB</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.statsExpanded}>
            {item.position === 'GK' ? (
              <View style={styles.statsContainer}>
                {[['DIV', item.stats.gk_diving], ['HAN', item.stats.gk_handling], ['KIC', item.stats.gk_kicking],
                  ['REF', item.stats.gk_reflexes], ['SPD', item.stats.gk_speed], ['POS', item.stats.gk_positioning]].map(([k, v]) => (
                  <View key={k as string} style={styles.statColumn}>
                    <Text style={styles.statTitle}>{k}</Text>
                    <Text style={styles.statValue}>{(v as number) || 50}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.statsContainer}>
                {[['PAC', item.stats.pace], ['SHO', item.stats.shooting], ['PAS', item.stats.passing],
                  ['DRI', item.stats.dribbling], ['DEF', item.stats.defending], ['PHY', item.stats.physical]].map(([k, v]) => (
                  <View key={k as string} style={styles.statColumn}>
                    <Text style={styles.statTitle}>{k}</Text>
                    <Text style={styles.statValue}>{v}</Text>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.seasonStatsRow}>
              <Text style={styles.seasonStat}>⚽ {item.goals}</Text>
              <Text style={styles.seasonStat}>🅰️ {item.assists}</Text>
              {(item.position === 'GK' || item.position === 'DEF') && <Text style={styles.seasonStat}>🧤 {item.cleanSheets}</Text>}
              <Text style={[styles.seasonStat, { color: '#F59E0B' }]}>🟨 {item.yellowCards}</Text>
              <Text style={[styles.seasonStat, { color: '#ef4444' }]}>🟥 {item.redCards}</Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  const activeSlot = activeSlotIndex !== null ? slots[activeSlotIndex.row]?.[activeSlotIndex.col] : null;
  const currentOccupant = activeSlotIndex !== null ? slotPlayers[activeSlotIndex.row]?.[activeSlotIndex.col] : null;
  const pickerSections = activeSlot ? getPickerSections(activeSlot, currentOccupant?.id ?? null) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.title}>Tactics & Squad</Text>

          <TouchableOpacity style={styles.dropdownBtn} onPress={() => setShowFormationDrop(true)}>
            <Text style={styles.dropdownLabel}>Formation</Text>
            <Text style={styles.dropdownValue}>{activeFormation}</Text>
            <Text style={styles.dropdownCaret}>▾</Text>
          </TouchableOpacity>

          <View style={styles.strategyBar}>
            <TouchableOpacity
              style={[styles.stratBtn, strategy === 'defend' && styles.stratBtnDefend]}
              onPress={() => setStrategy(userTeamId, 'defend')}
            >
              <Text style={styles.stratArrow}>◀</Text>
              <Text style={[styles.stratText, strategy === 'defend' && styles.stratTextActive]}>DEFEND</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stratBtn, strategy === 'balanced' && styles.stratBtnBalanced]}
              onPress={() => setStrategy(userTeamId, 'balanced')}
            >
              <Text style={[styles.stratText, strategy === 'balanced' && styles.stratTextActive]}>BALANCED</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stratBtn, strategy === 'attack' && styles.stratBtnAttack]}
              onPress={() => setStrategy(userTeamId, 'attack')}
            >
              <Text style={[styles.stratText, strategy === 'attack' && styles.stratTextActive]}>ATTACK</Text>
              <Text style={styles.stratArrow}>▶</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.infoText}>Long-press reserve to mark as sub (max 7) • Tap pitch slot to assign player</Text>
        </View>

        <View style={styles.pitchWrapper}>
          <View style={styles.pitch}>
            <View style={styles.pitchHalfLine} />
            <View style={styles.pitchCentreCircle} />
            {slots.map((row: Slot[], rowIdx: number) => (
              <View key={rowIdx} style={styles.pitchRow}>
                {row.map((slot: Slot, colIdx: number) => {
                  const assigned = slotPlayers[rowIdx]?.[colIdx];
                  return (
                    <TouchableOpacity
                      key={colIdx}
                      style={styles.pitchDot}
                      onPress={() => handleSlotPress(rowIdx, colIdx)}
                    >
                      <View style={[
                        styles.pitchDotCircle,
                        { backgroundColor: assigned ? getPosColor(slot.pos) : '#1e3a2f' },
                        !assigned && styles.pitchDotEmpty,
                      ]}>
                        <Text style={styles.pitchDotLabel}>
                          {assigned ? (assigned.subPosition || slot.pos).substring(0, 2) : slot.label}
                        </Text>
                      </View>
                      <Text style={[styles.pitchDotName, !assigned && { color: '#4ade80' }]} numberOfLines={1}>
                        {assigned ? assigned.name.split(' ').pop() : '+'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Substitutes ({bench.length}/7)</Text>
          {bench.length === 0 && <Text style={styles.emptyNote}>Long-press a reserve to designate as sub</Text>}
          {bench.map(p => renderCompactPlayer(p, false, false, true))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reserves ({reserves.length})</Text>
          {reserves.length === 0 && <Text style={styles.emptyNote}>All players assigned to XI or bench</Text>}
          {reserves.map(p => renderCompactPlayer(p, false, false, false))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Formation Selection Modal ── */}
      <Modal visible={showFormationDrop} transparent animationType="fade" onRequestClose={() => setShowFormationDrop(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFormationDrop(false)}>
          <View style={styles.dropdownModal}>
            <Text style={styles.dropdownModalTitle}>Choose Formation</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {FORMATIONS.map(f => {
                const variants = VARIANTS[f] || [f];
                const isSelectedBase = baseFormation === f;
                return (
                  <View key={f}>
                    <TouchableOpacity 
                      style={[styles.dropdownItem, isSelectedBase && styles.dropdownItemActive]}
                      onPress={() => handleFormationSelect(f)}
                    >
                      <Text style={[styles.dropdownItemText, isSelectedBase && styles.dropdownItemTextActive]}>{f}</Text>
                      {isSelectedBase && <Text style={styles.activeCheck}>✓</Text>}
                    </TouchableOpacity>
                    {isSelectedBase && (
                      <View style={styles.variantRow}>
                        {variants.map(v => (
                          <TouchableOpacity 
                            key={v} 
                            style={[styles.variantBtn, activeFormation === v && styles.variantBtnActive]}
                            onPress={() => handleFormationSelect(v)}
                          >
                            <Text style={[styles.variantText, activeFormation === v && styles.variantTextActive]}>
                              {v.includes(' ') ? v.split(' ')[1] : 'Standard'}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* ── Player Picker Modal ── */}
      <Modal visible={activeSlotIndex !== null} transparent animationType="slide" onRequestClose={() => setActiveSlotIndex(null)}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <View style={[styles.modalPosPill, { backgroundColor: getPosColor(activeSlot?.pos || 'MID') }]}>
                <Text style={styles.modalPosText}>{activeSlot?.label || '?'}</Text>
              </View>
              <Text style={styles.pickerTitle}>{activeSlot?.label} — Select Player</Text>
              <TouchableOpacity onPress={() => setActiveSlotIndex(null)} style={styles.pickerClose}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView>
              {pickerSections && (
                <>
                  <Text style={styles.pickerSection}>★ Recommended for {activeSlot?.label}</Text>
                  {pickerSections.recommended.length === 0
                    ? <Text style={styles.emptyNote}>  No exact match — see alternatives below</Text>
                    : pickerSections.recommended.map(renderPlayerInPicker)}

                  {pickerSections.alternatives.length > 0 && (
                    <>
                      <Text style={styles.pickerSection}>◆ Other {activeSlot?.pos}s</Text>
                      {pickerSections.alternatives.map(renderPlayerInPicker)}
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0f172a' },
  header:      { padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  title:       { fontSize: 24, fontWeight: '900', color: '#f8fafc', marginBottom: 12 },

  // Formation dropdown trigger
  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12,
  },
  dropdownLabel: { fontSize: 11, color: '#64748b', fontWeight: '700', marginRight: 6, textTransform: 'uppercase' },
  dropdownValue: { flex: 1, fontSize: 16, fontWeight: '900', color: '#f8fafc' },
  dropdownCaret: { fontSize: 14, color: '#64748b' },

  // Strategy bar
  strategyBar: {
    flexDirection: 'row', borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: '#334155', marginBottom: 10,
  },
  stratBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 9, backgroundColor: '#0f172a', gap: 4,
  },
  stratBtnDefend:    { backgroundColor: '#3B82F6' },
  stratBtnAttack:    { backgroundColor: '#ef4444' },
  stratBtnBalanced:  { backgroundColor: '#10B981' },
  stratText:         { fontSize: 11, fontWeight: '900', color: '#64748b', letterSpacing: 0.5 },
  stratTextActive:   { color: '#fff' },
  stratArrow:        { fontSize: 12, color: '#64748b' },
  infoText:          { fontSize: 10, color: '#475569', fontStyle: 'italic' },

  // Pitch
  pitchWrapper:      { paddingHorizontal: 10, paddingVertical: 10 },
  pitch: {
    backgroundColor: '#14532d', borderRadius: 12,
    paddingVertical: 16, paddingHorizontal: 8,
    borderWidth: 2, borderColor: '#166534', overflow: 'hidden', position: 'relative',
  },
  pitchHalfLine: {
    position: 'absolute', top: '52%', left: 16, right: 16, height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  pitchCentreCircle: {
    position: 'absolute', top: '42%', left: '33%', width: '34%', aspectRatio: 1,
    borderRadius: 1000, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  pitchRow:     { flexDirection: 'row', justifyContent: 'space-evenly', marginVertical: 5 },
  pitchDot:     { alignItems: 'center', width: 54 },
  pitchDotCircle: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
  },
  pitchDotEmpty: { borderStyle: 'dotted', borderColor: '#4ade80' },
  pitchDotLabel: { color: '#fff', fontSize: 9, fontWeight: '900' },
  pitchDotName:  { color: '#fff', fontSize: 9, marginTop: 3, textAlign: 'center', fontWeight: '700' },

  // Player cards
  section:       { paddingHorizontal: 12, paddingTop: 4 },
  sectionTitle:  {
    fontSize: 13, fontWeight: '900', color: '#64748b', marginTop: 14, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  emptyNote:     { fontSize: 11, color: '#475569', fontStyle: 'italic', paddingLeft: 4, marginBottom: 4 },
  playerRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10,
    marginVertical: 3, borderWidth: 1, borderColor: '#334155',
  },
  playerRowExpanded: { borderColor: '#38bdf8', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  posTag:        { paddingVertical: 3, paddingHorizontal: 6, borderRadius: 5, marginRight: 10, minWidth: 38, alignItems: 'center' },
  posText:       { color: '#fff', fontWeight: '900', fontSize: 10 },
  playerMeta:    { flex: 1 },
  playerName:    { fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  nationality:   { fontSize: 10, color: '#64748b', fontWeight: '600' },
  playerRowRight:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingBox:     { backgroundColor: '#cbd5e1', width: 30, height: 30, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  ratingText:    { color: '#0f172a', fontWeight: '900', fontSize: 13 },
  benchBadge:      { backgroundColor: '#1e3a5f', paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: '#3B82F6' },
  benchBadgeText:  { color: '#93c5fd', fontSize: 10, fontWeight: '900' },
  statsExpanded: {
    backgroundColor: '#0f172a', borderWidth: 1, borderTopWidth: 0,
    borderColor: '#38bdf8', borderBottomLeftRadius: 10, borderBottomRightRadius: 10,
    padding: 10, marginBottom: 3,
  },
  statsContainer:  { flexDirection: 'row', justifyContent: 'space-between' },
  statColumn:      { alignItems: 'center' },
  statTitle:       { fontSize: 9, color: '#94a3b8', fontWeight: 'bold', marginBottom: 2 },
  statValue:       { fontSize: 14, color: '#e2e8f0', fontWeight: '700' },
  seasonStatsRow:  {
    flexDirection: 'row', justifyContent: 'space-around',
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1e293b',
  },
  seasonStat:      { fontSize: 12, color: '#94a3b8', fontWeight: '700' },

  // Formation dropdown modal
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 40 },
  dropdownModal: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' },
  dropdownModalTitle: { fontSize: 14, fontWeight: '900', color: '#64748b', textAlign: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#334155', textTransform: 'uppercase', letterSpacing: 1 },
  dropdownItem:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  dropdownItemActive: { backgroundColor: '#0f172a' },
  dropdownItemText: { flex: 1, color: '#cbd5e1', fontSize: 16, fontWeight: '700' },
  dropdownItemTextActive: { color: '#38bdf8' },
  activeCheck:   { color: '#10B981', fontWeight: '900', fontSize: 16 },
  variantRow:    { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 12, gap: 8, flexWrap: 'wrap' },
  variantBtn:    { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a' },
  variantBtnActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
  variantText:   { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  variantTextActive: { color: '#0f172a' },

  // Player picker modal
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickerSheet:   { backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingBottom: 40 },
  pickerHeader:  { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#334155', gap: 10 },
  pickerTitle:   { flex: 1, fontSize: 15, fontWeight: '900', color: '#f8fafc' },
  pickerClose:   { padding: 6 },
  pickerSection: { fontSize: 11, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  pickerRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155', gap: 10 },
  pickerName:    { flex: 1, fontSize: 14, fontWeight: '700', color: '#f1f5f9' },
  pickerNat:     { fontSize: 10, color: '#64748b', width: 60 },
  pickerRating:  { backgroundColor: '#cbd5e1', width: 32, height: 32, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  pickerRatingText: { color: '#0f172a', fontWeight: '900', fontSize: 13 },
  pickerStarter: { fontSize: 10, color: '#38bdf8', fontWeight: '900' },

  modalPosPill:  { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, minWidth: 36, alignItems: 'center' },
  modalPosText:  { color: '#fff', fontSize: 10, fontWeight: '900' },
  modalCloseText:{ color: '#94a3b8', fontSize: 18, fontWeight: '900' },
});

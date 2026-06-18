import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useGameStore } from '@/src/store/gameStore';
import { Formation, Player, TeamTactics } from '@/src/models/types';
import { getSlotsForFormation, Slot } from '@/src/constants/formations';
import { getSlotFitScore, rebuildFormationMap, rebuildFormationSlotPlayers } from '@/src/core/formationMapUtils';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import { CompactPlayerCard } from '@/components/squad/compact-player-card';
import { DraggableDot, getPitchSlotPosition, PITCH_DOT_SIZE, PITCH_SLOT_HEIGHT, PITCH_SLOT_WIDTH } from '@/components/squad/draggable-dot';
import { FormationSelectionModal } from '@/components/squad/formation-selection-modal';
import { PlayerPickerModal } from '@/components/squad/player-picker-modal';
import { SquadInfoModal } from '@/components/squad/squad-info-modal';
import { TacticSection } from '@/components/squad/tactic-section';
import { isPlayerUnavailable } from '@/src/core/playerStatusUtils';

const FORMATIONS: Formation[] = [
  '4-3-3',
  '4-4-2',
  '4-2-3-1',
  '3-4-3',
  '3-4-2-1',
  '4-5-1',
  '4-2-2-2',
  '3-2-4-1',
  '5-2-3',
  '3-5-2',
  '4-1-4-1',
  '4-3-2-1',
];

type SlotBounds = { x: number; y: number; w: number; h: number };
type TacticConfig = {
  key: keyof TeamTactics;
  title: string;
  options: string[];
  descriptions: Record<string, string>;
};

const areFormationMapsEqual = (a: Record<string, string>, b: Record<string, string>) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => a[key] === b[key]);
};

const TACTIC_SECTIONS: TacticConfig[] = [
  {
    key: 'mentality',
    title: 'Mentality',
    options: ['Defensive', 'Balanced', 'Attacking'],
    descriptions: {
      Defensive: 'Focus on shape and discipline. Lower goal threat but 15% better defense.',
      Balanced: 'Standard approach. No specific stat bonuses or penalties.',
      Attacking: 'Push players forward. Increased shooting accuracy but vulnerable to counters.',
    },
  },
  {
    key: 'passingStyle',
    title: 'Passing Style',
    options: ['Short', 'Mixed', 'Direct'],
    descriptions: {
      Short: 'Patient buildup. Higher pass completion but fewer direct balls.',
      Mixed: 'A balanced blend of short and direct passing.',
      Direct: 'Bypass midfield more often. More through-balls, more risk.',
    },
  },
  {
    key: 'tempo',
    title: 'Tempo',
    options: ['Slow', 'Normal', 'Fast'],
    descriptions: {
      Slow: 'Control the game and conserve more energy.',
      Normal: 'Standard rhythm and frequency of play.',
      Fast: 'Higher intensity and chance creation, but burns more energy.',
    },
  },
  {
    key: 'defensiveLine',
    title: 'Defensive Line',
    options: ['Deep', 'Standard', 'High'],
    descriptions: {
      Deep: 'Protect space behind the defense but concede more midfield territory.',
      Standard: 'Balanced defensive positioning.',
      High: 'Compress the pitch, but risk through-balls behind.',
    },
  },
  {
    key: 'pressing',
    title: 'Pressing',
    options: ['None', 'Medium', 'High'],
    descriptions: {
      None: 'Sit off and conserve energy.',
      Medium: 'Press selectively.',
      High: 'Aggressive pressure with higher energy cost.',
    },
  },
];

export default function SquadScreen() {
  const userTeamId    = useGameStore(s => s.userTeamId);
  const players       = useGameStore(s => s.players);
  const teams         = useGameStore(s => s.teams);
  const setFormation  = useGameStore(s => s.setFormation);
  const setTactics    = useGameStore(s => s.setTactics);
  const swapPlayer    = useGameStore(s => s.swapPlayer);
  const markAsSub     = useGameStore(s => s.markAsSub);
  const swapStartingSlots = useGameStore(s => s.swapStartingSlots);

  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [expandedCardId, setExpandedCardId]   = useState<string | null>(null);
  const [showFormationDrop, setShowFormationDrop] = useState(false);
  const [activeSlotIndex, setActiveSlotIndex] = useState<{ row: number; col: number } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [activePane, setActivePane] = useState<'xi' | 'tactics'>('xi');

  const slotRefs = useRef<Record<string, View | null>>({});
  const slotBounds = useRef<Record<string, SlotBounds>>({});

  const myTeam  = userTeamId ? teams[userTeamId] : undefined;
  const mySquad = userTeamId
    ? Object.values(players).filter(p => p.teamId === userTeamId)
    : [];

  const sortedSquad = sortPlayersByPositionGroup(mySquad);

  const activeFormation = myTeam?.activeFormation || '4-3-3';
  const slots = getSlotsForFormation(activeFormation);

  const starters  = sortedSquad.filter(player => player.isStarting && !isPlayerUnavailable(player));
  const bench     = sortedSquad.filter(p => p.isSub);
  const reserves  = sortedSquad.filter(p => !p.isStarting && !p.isSub);

  const formationMap = useMemo(() => myTeam?.formationMap || {}, [myTeam?.formationMap]);
  const hasMap = Object.keys(formationMap).length > 0;
  
  const slotPlayers = useMemo(() => {
    const arr: (Player | null)[][] = slots.map((row: Slot[]) => row.map(() => null));
    if (hasMap) {
      return rebuildFormationSlotPlayers(slots, starters, formationMap);
    } else {
      const available = [...starters];
      arr.forEach((row, r) => {
         row.forEach((_, c) => {
            const slot = slots[r][c];
            let idx = available.findIndex(p => p.subPosition === slot.label);
            if (idx === -1) idx = available.findIndex(p => p.position === slot.pos);
            if (idx !== -1) arr[r][c] = available.splice(idx, 1)[0];
         });
      });
      arr.forEach((row) => {
         row.forEach((_, c) => {
            if (!row[c] && available.length > 0) row[c] = available.shift() || null;
         });
      });
    }
    return arr;
  }, [slots, starters, hasMap, formationMap]);

  const rebuildLockRef = useRef(false);

  useEffect(() => {
    if (!userTeamId || !hasMap || rebuildLockRef.current) return;
    const rebuiltMap = rebuildFormationMap(slots, starters, formationMap);
    if (!areFormationMapsEqual(rebuiltMap, formationMap)) {
      rebuildLockRef.current = true;
      setFormation(userTeamId, activeFormation as Formation);
    }
  }, [activeFormation, formationMap, hasMap, setFormation, slots, starters, userTeamId]);

  if (!userTeamId) return null;

  const measureSlots = () => {
     Object.keys(slotRefs.current).forEach(key => {
        slotRefs.current[key]?.measure((x: number, y: number, w: number, h: number, px: number, py: number) => {
           slotBounds.current[key] = { x: px, y: py, w, h };
        });
     });
  };

  const handleDragEnd = (r: number, c: number, mx: number, my: number) => {
     setScrollEnabled(true);
     let closestKey: string | null = null;
     let minDistance = 50;
     Object.entries(slotBounds.current).forEach(([k, b]) => {
        const centerX = b.x + b.w / 2;
        const centerY = b.y + PITCH_DOT_SIZE / 2;
        const distance = Math.hypot(mx - centerX, my - centerY);

        if (distance < minDistance) {
           minDistance = distance;
           closestKey = k;
        }
     });
     if (closestKey && closestKey !== `${r}-${c}`) {
        swapStartingSlots(userTeamId, `${r}-${c}`, closestKey);
        return true;
     }
     return false;
  };

  const handleFormationSelect = (f: string) => {
    if (userTeamId) setFormation(userTeamId, f as Formation);
    setShowFormationDrop(false);
  };

  const getPickerSections = (slot: Slot) => {
    const pool = mySquad.filter(player => !player.isStarting && !isPlayerUnavailable(player))
      .sort((a, b) => b.overallRating - a.overallRating);

    const recommended = pool.filter(p => getSlotFitScore(p, slot) > -Infinity);
    
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
    const slotKey = activeSlotIndex ? `${activeSlotIndex.row}-${activeSlotIndex.col}` : undefined;
    swapPlayer(currentOccupant?.id ?? null, pickedId, slotKey);
    setActiveSlotIndex(null);
  };

  const handleSubToggle = (playerId: string, isBench: boolean) => {
    if (isBench) {
      // Long-press on bench player removes them from sub designation
      markAsSub(playerId);
    } else {
      // Single tap on reserve adds to subs (if space)
      if (bench.length >= 7) return;
      markAsSub(playerId);
    }
  };

  const handleTacticChange = (key: keyof TeamTactics, value: string) => {
    setTactics(userTeamId, { [key]: value } as Partial<TeamTactics>);
  };

  const activeSlot = activeSlotIndex !== null ? slots[activeSlotIndex.row]?.[activeSlotIndex.col] : null;
  const pickerSections = activeSlot ? getPickerSections(activeSlot) : null;
  const tactics = myTeam?.tactics;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView scrollEnabled={scrollEnabled} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Tactics & Squad</Text>
            <TouchableOpacity style={styles.infoBtn} onPress={() => setShowInfo(true)}>
              <Text style={styles.infoBtnText}>i</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.dropdownBtn} onPress={() => setShowFormationDrop(true)}>
            <Text style={styles.dropdownLabel}>Formation</Text>
            <Text style={styles.dropdownValue}>{activeFormation}</Text>
            <Text style={styles.dropdownCaret}>v</Text>
          </TouchableOpacity>

          <View style={styles.paneSwitch}>
            <TouchableOpacity
              style={[styles.paneSwitchBtn, activePane === 'xi' && styles.paneSwitchBtnActive]}
              onPress={() => setActivePane('xi')}
            >
              <Text style={[styles.paneSwitchText, activePane === 'xi' && styles.paneSwitchTextActive]}>Starting XI</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.paneSwitchBtn, activePane === 'tactics' && styles.paneSwitchBtnActive]}
              onPress={() => setActivePane('tactics')}
            >
              <Text style={[styles.paneSwitchText, activePane === 'tactics' && styles.paneSwitchTextActive]}>Tactics</Text>
            </TouchableOpacity>
          </View>
        </View>

        {activePane === 'xi' ? (
          <>
            <View style={styles.pitchWrapper}>
              {/* Football pitch */}
              <View style={styles.pitch}>
                <View style={styles.pitchOutline} />

                <View style={styles.pitchSlots}>
                  {slots.map((row: Slot[], rowIdx: number) => (
                    row.map((slot: Slot, colIdx: number) => {
                        const assigned = slotPlayers[rowIdx]?.[colIdx];
                        const slotKey = `${rowIdx}-${colIdx}`;
                        const position = getPitchSlotPosition(rowIdx, colIdx, row.length, slots.length);
                        return (
                           <View key={slotKey} style={[styles.pitchSlotAnchor, position]}>
                             <DraggableDot
                                slot={slot}
                                assigned={assigned}
                                onPress={() => handleSlotPress(rowIdx, colIdx)}
                                onDragBegin={() => { setScrollEnabled(false); measureSlots(); }}
                                onDragEnd={(mx: number, my: number) => handleDragEnd(rowIdx, colIdx, mx, my)}
                                setRef={(ref) => { slotRefs.current[slotKey] = ref; }}
                             />
                           </View>
                        );
                      })
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Substitutes ({bench.length}/7)</Text>
              {bench.length === 0 && <Text style={styles.emptyNote}>Long-press a reserve to designate as sub</Text>}
              {bench.map((player) => {
                const isExpanded = expandedCardId === player.id;
                return (
                  <CompactPlayerCard
                    key={player.id}
                    item={player}
                    isBench
                    isExpanded={isExpanded}
                    onPress={() => setExpandedCardId(isExpanded ? null : player.id)}
                    onLongPress={() => handleSubToggle(player.id, true)}
                  />
                );
              })}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reserves ({reserves.length})</Text>
              {reserves.length === 0 && <Text style={styles.emptyNote}>All players assigned to XI or bench</Text>}
              {reserves.map((player) => {
                const isExpanded = expandedCardId === player.id;
                return (
                  <CompactPlayerCard
                    key={player.id}
                    item={player}
                    isBench={false}
                    isExpanded={isExpanded}
                    onPress={() => handleSubToggle(player.id, false)}
                    onLongPress={() => setExpandedCardId(isExpanded ? null : player.id)}
                  />
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.tacticsPane}>
            {tactics && TACTIC_SECTIONS.map((section) => (
              <TacticSection
                key={section.key}
                title={section.title}
                selectedOption={tactics[section.key]}
                options={section.options}
                descriptions={section.descriptions}
                onSelect={(option) => handleTacticChange(section.key, option)}
              />
            ))}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <FormationSelectionModal
        visible={showFormationDrop}
        formations={FORMATIONS}
        selectedFormation={activeFormation}
        onClose={() => setShowFormationDrop(false)}
        onSelect={handleFormationSelect}
      />

      <PlayerPickerModal
        visible={activeSlotIndex !== null}
        slot={activeSlot}
        sections={pickerSections}
        onClose={() => setActiveSlotIndex(null)}
        onPick={handlePickPlayer}
      />

      <SquadInfoModal visible={showInfo} onClose={() => setShowInfo(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0f172a' },
  header:      { padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  headerRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title:       { fontSize: 24, fontWeight: '900', color: '#f8fafc', flex: 1 },
  infoBtn:     { width: 30, height: 30, borderRadius: 0, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  infoBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '900' },

  // Formation dropdown trigger
  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0f172a', borderRadius: 0, borderWidth: 1, borderColor: '#334155',
    paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12,
  },
  dropdownLabel: { fontSize: 11, color: '#64748b', fontWeight: '700', marginRight: 6, textTransform: 'uppercase' },
  dropdownValue: { flex: 1, fontSize: 16, fontWeight: '900', color: '#f8fafc' },
  dropdownCaret: { fontSize: 14, color: '#64748b' },
  paneSwitch: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 4,
  },
  paneSwitchBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 0 },
  paneSwitchBtnActive: { backgroundColor: '#38bdf8' },
  paneSwitchText: { color: '#94a3b8', fontSize: 12, fontWeight: '900' },
  paneSwitchTextActive: { color: '#0f172a' },

  // Pitch
  pitchWrapper:      { paddingHorizontal: 10, paddingVertical: 10 },
  pitch: {
    backgroundColor: '#14532d', borderRadius: 0,
    height: 480,
    borderWidth: 2, borderColor: '#166534', overflow: 'hidden', position: 'relative',
  },
  pitchOutline: {
    position: 'absolute', top: 12, bottom: 12, left: 12, right: 12, 
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', borderRadius: 0
  },
  pitchSlots: {
    position: 'absolute',
    top: 12,
    bottom: 12,
    left: 12,
    right: 12,
    zIndex: 10,
  },
  pitchSlotAnchor: {
    position: 'absolute',
    width: PITCH_SLOT_WIDTH,
    height: PITCH_SLOT_HEIGHT,
    marginLeft: -(PITCH_SLOT_WIDTH / 2),
    marginTop: -(PITCH_DOT_SIZE / 2),
    alignItems: 'center',
  },

  // Player cards
  section:       { paddingHorizontal: 12, paddingTop: 4 },
  sectionTitle:  {
    fontSize: 13, fontWeight: '900', color: '#64748b', marginTop: 14, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  emptyNote:     { fontSize: 11, color: '#475569', fontStyle: 'italic', paddingLeft: 4, marginBottom: 4 },
  tacticsPane: { padding: 16, gap: 18 },
});

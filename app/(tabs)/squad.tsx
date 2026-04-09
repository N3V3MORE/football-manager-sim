import {
  StyleSheet, Text, View, ScrollView, TouchableOpacity, Modal, Pressable
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useGameStore } from '@/src/store/gameStore';
import { Formation, Player, TeamTactics } from '@/src/models/types';

import { getSlotsForFormation, Slot } from '@/src/constants/formations';
import { getSlotFitScore, rebuildFormationMap, rebuildFormationSlotPlayers } from '@/src/core/formationMapUtils';
import { sortPlayersByPositionGroup } from '@/src/core/playerSortUtils';
import {
  DraggableDot,
  getSlotPosition,
  PITCH_DOT_SIZE,
  PITCH_SLOT_HEIGHT,
  PITCH_SLOT_WIDTH,
  SlotBounds,
} from '@/src/features/squad/components/DraggableDot';

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

type SlotFitStatus = 'preferred' | 'alternate' | 'out';

const getPlayerSlotFitStatus = (player: Player, slot: Slot): SlotFitStatus => {
  if (player.subPosition === slot.label) return 'preferred';
  if (player.altPositions?.includes(slot.label)) return 'alternate';
  return 'out';
};

const getFitRatingColor = (fitStatus: SlotFitStatus) => {
  switch (fitStatus) {
    case 'preferred':
    case 'alternate':
      return '#22c55e';
    default:
      return '#ef4444';
  }
};

const getSlotDisplayPosition = (player: Player, slot: Slot, fitStatus: SlotFitStatus) => (
  fitStatus === 'alternate' ? slot.label : (player.subPosition || player.position)
);

type EditableTacticKey = 'mentality' | 'passingStyle' | 'tempo' | 'defensiveLine' | 'pressing';
type EditableTacticOption = TeamTactics[EditableTacticKey];

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
  const [formationBacklineFilter, setFormationBacklineFilter] = useState<'3' | '4' | '5'>('4');
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
  const baseFormation = activeFormation.split(' ')[0];
  const slots = getSlotsForFormation(activeFormation);

  const starters  = sortedSquad.filter(p => p.isStarting);
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

  const starterSlotMeta = useMemo(() => {
    const meta: Record<string, { slot: Slot; fitStatus: SlotFitStatus; displayPosition: string }> = {};
    slots.forEach((row, rowIdx) => {
      row.forEach((slot, colIdx) => {
        const player = slotPlayers[rowIdx]?.[colIdx];
        if (!player) return;
        const fitStatus = getPlayerSlotFitStatus(player, slot);
        meta[player.id] = {
          slot,
          fitStatus,
          displayPosition: getSlotDisplayPosition(player, slot, fitStatus),
        };
      });
    });
    return meta;
  }, [slotPlayers, slots]);

  useEffect(() => {
    if (!userTeamId || !hasMap) return;
    const rebuiltMap = rebuildFormationMap(slots, starters, formationMap);
    if (JSON.stringify(rebuiltMap) !== JSON.stringify(formationMap)) {
      setFormation(userTeamId, activeFormation as Formation);
    }
  }, [activeFormation, formationMap, hasMap, setFormation, slots, starters, userTeamId]);

  if (!userTeamId) return null;

  const measureSlots = () => {
     Object.keys(slotRefs.current).forEach(key => {
        const slotRef = slotRefs.current[key];
        slotRef?.measure((x: number, y: number, w: number, h: number, px: number, py: number) => {
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
    setFormationBacklineFilter((f.charAt(0) as '3' | '4' | '5') || '4');
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


  const getPickerSections = (slot: Slot, _currentOccupantId: string | null) => {
    const pool = mySquad.filter(p => !p.isStarting)
      .sort((a, b) => b.overallRating - a.overallRating);

    const scored = pool
      .map(player => ({
        player,
        score: getSlotFitScore(player, slot),
        fitStatus: getPlayerSlotFitStatus(player, slot),
      }))
      .filter(candidate => candidate.score > -Infinity)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.player.overallRating - a.player.overallRating;
      });

    const recommended = scored
      .filter(candidate => candidate.fitStatus !== 'out')
      .map(candidate => candidate.player);
    const alternatives = scored
      .filter(candidate => candidate.fitStatus === 'out')
      .map(candidate => candidate.player);

    const recIds = new Set(recommended.map(player => player.id));
    const extraAlternatives = pool.filter(player => !recIds.has(player.id) && player.position === slot.pos);
    const mergedAlternatives = [...alternatives, ...extraAlternatives.filter(player => !alternatives.some(item => item.id === player.id))];

    return { recommended, alternatives: mergedAlternatives };
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


  const renderPlayerInPicker = (item: Player) => {
    const isSuspended = item.matchesSuspended > 0;
    const isExhausted = item.energy < 70;
    const warningColor = (isSuspended || isExhausted) ? '#ef4444' : undefined;
    return (
    <TouchableOpacity key={item.id} style={[styles.pickerRow, warningColor && { borderColor: warningColor }]} onPress={() => handlePickPlayer(item.id)}>
      <View style={[styles.modalPosPill, { backgroundColor: getPosColor(item.position) }]}>
        <Text style={styles.modalPosText}>{item.subPosition || item.position}</Text>
      </View>
      <View style={{ flex: 1 }}>
         <Text style={[styles.pickerName, warningColor && { color: warningColor }]} numberOfLines={1}>{item.name}</Text>
         <Text style={styles.pickerNat}>{item.nationality} | {Math.floor(item.energy)}% NRG</Text>
      </View>
      <View style={styles.pickerRating}>
        <Text style={styles.pickerRatingText}>{item.overallRating}</Text>
      </View>
      {item.isStarting && <Text style={styles.pickerStarter}>In Selection</Text>}
      {isSuspended && <Text style={{ fontSize: 10, color: '#ef4444', fontWeight: 'bold' }}> SUSP</Text>}
    </TouchableOpacity>
    );
  };

  const renderCompactPlayer = (item: Player, _unused1: boolean, _unused2: boolean, isBench: boolean) => {
    const isExpanded = expandedCardId === item.id;
    const isSuspended = item.matchesSuspended > 0;
    const isExhausted = item.energy < 70;
    const warningColor = (isSuspended || isExhausted) ? '#ef4444' : undefined;
    const slotMeta = starterSlotMeta[item.id];
    const displayPosition = slotMeta?.displayPosition || item.subPosition || item.position;
    const positionColorKey = slotMeta?.slot.pos || item.position;
    const ratingColor = slotMeta ? getFitRatingColor(slotMeta.fitStatus) : '#0f172a';

    return (
      <View key={item.id}>
        <TouchableOpacity
          style={[styles.playerRow, isExpanded && styles.playerRowExpanded, warningColor && { borderColor: warningColor }]}
          onPress={() => isBench
            ? setExpandedCardId(isExpanded ? null : item.id)
            : handleSubToggle(item.id, false)
          }
          onLongPress={() => isBench ? handleSubToggle(item.id, true) : setExpandedCardId(isExpanded ? null : item.id)}
          delayLongPress={400}
          activeOpacity={0.7}
        >
          <View style={[styles.posTag, { backgroundColor: getPosColor(positionColorKey) }]}>
            <Text style={styles.posText}>{displayPosition}</Text>
          </View>
          <View style={styles.playerMeta}>
            <Text style={[styles.playerName, warningColor && { color: warningColor }]} numberOfLines={1}>
              {item.name} {isSuspended && <Text style={{fontSize: 10, color: '#ef4444'}}>[SUSP]</Text>}
            </Text>
            <Text style={styles.nationality}>{item.nationality} | {Math.floor(item.energy)}% Energy</Text>
          </View>
          <View style={styles.playerRowRight}>
            <View style={[styles.ratingBox, slotMeta && styles.ratingBoxSlotFit, slotMeta && { borderColor: ratingColor }]}>
              <Text style={[styles.ratingText, slotMeta && { color: ratingColor }]}>{item.overallRating}</Text>
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
              <Text style={styles.seasonStat}>G {item.goals}</Text>
              <Text style={styles.seasonStat}>A {item.assists}</Text>
              {(item.position === 'GK' || item.position === 'DEF') && <Text style={styles.seasonStat}>CS {item.cleanSheets}</Text>}
              <Text style={[styles.seasonStat, { color: '#F59E0B' }]}>YC {item.yellowCards}</Text>
              <Text style={[styles.seasonStat, { color: '#ef4444' }]}>RC {item.redCards}</Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  const activeSlot = activeSlotIndex !== null ? slots[activeSlotIndex.row]?.[activeSlotIndex.col] : null;
  const currentOccupant = activeSlotIndex !== null ? slotPlayers[activeSlotIndex.row]?.[activeSlotIndex.col] : null;
  const pickerSections = activeSlot ? getPickerSections(activeSlot, currentOccupant?.id ?? null) : null;
  const tactics = myTeam?.tactics;
  const filteredFormations = FORMATIONS.filter(formation => formation.startsWith(`${formationBacklineFilter}-`));

  const renderTacticSection = (
    title: string,
    key: EditableTacticKey,
    options: EditableTacticOption[]
  ) => {
    if (!tactics) return null;

    return (
      <View style={styles.tacticsSection}>
        <Text style={styles.tacticsSectionTitle}>{title}</Text>
        <View style={styles.tacticsOptionsRow}>
          {options.map(option => {
            const isActive = tactics[key] === option;
            return (
              <TouchableOpacity
                key={option}
                style={[styles.tacticsOptBtn, isActive && styles.tacticsOptBtnActive]}
                onPress={() => setTactics(userTeamId, { [key]: option } as Partial<TeamTactics>)}
              >
                <Text style={[styles.tacticsOptText, isActive && styles.tacticsOptTextActive]}>{option}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

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

          <TouchableOpacity
            style={styles.dropdownBtn}
            onPress={() => {
              setFormationBacklineFilter((activeFormation.charAt(0) as '3' | '4' | '5') || '4');
              setShowFormationDrop(true);
            }}
          >
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

        <View>
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
                          const fitStatus = assigned ? getPlayerSlotFitStatus(assigned, slot) : null;
                          const ratingColor = fitStatus ? getFitRatingColor(fitStatus) : undefined;
                          const displayPosition = assigned && fitStatus
                            ? getSlotDisplayPosition(assigned, slot, fitStatus)
                            : undefined;
                          const slotKey = `${rowIdx}-${colIdx}`;
                          const position = getSlotPosition(rowIdx, colIdx, row.length, slots.length);
                          return (
                            <View key={slotKey} style={[styles.pitchSlotAnchor, position]}>
                              <DraggableDot
                                  slot={slot}
                                  assigned={assigned}
                                  getPosColor={getPosColor}
                                  displayPositionLabel={displayPosition}
                                  ratingTextColor={ratingColor}
                                  onPress={() => handleSlotPress(rowIdx, colIdx)}
                                  onDragBegin={() => { setScrollEnabled(false); measureSlots(); }}
                                  onDragEnd={(mx: number, my: number) => handleDragEnd(rowIdx, colIdx, mx, my)}
                                  setRef={(ref: View | null) => { slotRefs.current[slotKey] = ref; }}
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
                {bench.map(p => renderCompactPlayer(p, false, false, true))}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Reserves ({reserves.length})</Text>
                {reserves.length === 0 && <Text style={styles.emptyNote}>All players assigned to XI or bench</Text>}
                {reserves.map(p => renderCompactPlayer(p, false, false, false))}
              </View>
            </>
          ) : (
            <View style={styles.tacticsPane}>
              {renderTacticSection('Mentality', 'mentality', ['Defensive', 'Balanced', 'Attacking'])}
              {renderTacticSection('Passing Style', 'passingStyle', ['Short', 'Mixed', 'Direct'])}
              {renderTacticSection('Tempo', 'tempo', ['Slow', 'Normal', 'Fast'])}
              {renderTacticSection('Defensive Line', 'defensiveLine', ['Deep', 'Standard', 'High'])}
              {renderTacticSection('Pressing', 'pressing', ['None', 'Medium', 'High'])}
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Formation selection modal */}
      <Modal visible={showFormationDrop} transparent animationType="fade" onRequestClose={() => setShowFormationDrop(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFormationDrop(false)}>
          <View style={styles.dropdownModal}>
            <Text style={styles.dropdownModalTitle}>Choose Formation</Text>
            <View style={styles.variantRow}>
              {(['3', '4', '5'] as const).map(backline => {
                const isActive = formationBacklineFilter === backline;
                return (
                  <TouchableOpacity
                    key={backline}
                    style={[styles.variantBtn, isActive && styles.variantBtnActive]}
                    onPress={() => setFormationBacklineFilter(backline)}
                  >
                    <Text style={[styles.variantText, isActive && styles.variantTextActive]}>{backline} Back</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {filteredFormations.map(f => {
                const isSelectedBase = baseFormation === f;
                return (
                  <View key={f}>
                    <TouchableOpacity 
                      style={[styles.dropdownItem, isSelectedBase && styles.dropdownItemActive]}
                      onPress={() => handleFormationSelect(f)}
                    >
                      <Text style={[styles.dropdownItemText, isSelectedBase && styles.dropdownItemTextActive]}>{f}</Text>
                      {isSelectedBase && <Text style={styles.activeCheck}>Selected</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Player picker modal */}
      <Modal visible={activeSlotIndex !== null} transparent animationType="slide" onRequestClose={() => setActiveSlotIndex(null)}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <View style={[styles.modalPosPill, { backgroundColor: getPosColor(activeSlot?.pos || 'MID') }]}>
                <Text style={styles.modalPosText}>{activeSlot?.label || '?'}</Text>
              </View>
              <Text style={styles.pickerTitle}>{activeSlot?.label} - Select Player</Text>
              <TouchableOpacity onPress={() => setActiveSlotIndex(null)} style={styles.pickerClose}>
                <Text style={styles.modalCloseText}>X</Text>
              </TouchableOpacity>
            </View>

            <ScrollView>
              {pickerSections && (
                <>
                  <Text style={styles.pickerSection}>Recommended for {activeSlot?.label}</Text>
                  {pickerSections.recommended.length === 0
                    ? <Text style={styles.emptyNote}>No exact match - see alternatives below</Text>
                    : pickerSections.recommended.map(renderPlayerInPicker)}

                  {pickerSections.alternatives.length > 0 && (
                    <>
                      <Text style={styles.pickerSection}>Other {activeSlot?.pos}s</Text>
                      {pickerSections.alternatives.map(renderPlayerInPicker)}
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Info modal */}
      <Modal visible={showInfo} transparent animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', paddingHorizontal: 30 }}>
          <View style={{ backgroundColor: '#1e293b', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#334155' }}>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#f8fafc', marginBottom: 16 }}>How to Use</Text>
            <Text style={{ color: '#94a3b8', lineHeight: 22, fontSize: 14 }}>
              {'- Tap a pitch circle to assign a player to that position.\n\n' +
               '- Drag a pitch player to another slot to swap positions.\n\n' +
               '- Tap any non-starting player in Reserves to add them to the Bench.\n\n' +
               '- Long-press a Bench player to move them back to Reserves.\n\n' +
               '- Use the Formation dropdown to switch formations.\n\n' +
               '- Use the Starting XI and Tactics buttons to switch panels.'}
            </Text>
            <TouchableOpacity
              onPress={() => setShowInfo(false)}
              style={{ marginTop: 20, backgroundColor: '#334155', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: '#f8fafc', fontWeight: '900' }}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0f172a' },
  header:      { padding: 16, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  headerRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title:       { fontSize: 24, fontWeight: '900', color: '#f8fafc', flex: 1 },
  infoBtn:     { width: 30, height: 30, borderRadius: 15, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  infoBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '900' },

  // Formation dropdown trigger
  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    paddingVertical: 10, paddingHorizontal: 14, marginBottom: 12,
  },
  dropdownLabel: { fontSize: 11, color: '#64748b', fontWeight: '700', marginRight: 6, textTransform: 'uppercase' },
  dropdownValue: { flex: 1, fontSize: 16, fontWeight: '900', color: '#f8fafc' },
  dropdownCaret: { fontSize: 14, color: '#64748b' },
  paneSwitch: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 4,
  },
  paneSwitchBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 7 },
  paneSwitchBtnActive: { backgroundColor: '#38bdf8' },
  paneSwitchText: { color: '#94a3b8', fontSize: 12, fontWeight: '900' },
  paneSwitchTextActive: { color: '#0f172a' },

  stratTextActive:   { color: '#fff' },
  stratArrow:        { fontSize: 12, color: '#64748b' },
  infoText:          { fontSize: 10, color: '#475569', fontStyle: 'italic' },

  // Pitch
  pitchWrapper:      { paddingHorizontal: 10, paddingVertical: 10 },
  pitch: {
    backgroundColor: '#14532d', borderRadius: 12,
    height: 480,
    borderWidth: 2, borderColor: '#166534', overflow: 'hidden', position: 'relative',
  },
  pitchOutline: {
    position: 'absolute', top: 12, bottom: 12, left: 12, right: 12, 
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', borderRadius: 2
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
  ratingBoxSlotFit: { backgroundColor: '#111827', borderWidth: 1 },
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
  tacticsPane: { padding: 16, gap: 18 },
  tacticsSection: { gap: 10 },
  tacticsSectionTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 },
  tacticsOptionsRow: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 10, padding: 4, borderWidth: 1, borderColor: '#334155' },
  tacticsOptBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  tacticsOptBtnActive: { backgroundColor: '#38bdf8' },
  tacticsOptText: { color: '#94a3b8', fontSize: 13, fontWeight: '800' },
  tacticsOptTextActive: { color: '#0f172a' },

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

import React, { useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, View, type PanResponderGestureState } from 'react-native';
import { Player } from '@/src/models/types';
import { Slot } from '@/src/constants/formations';
import { getPositionColor } from '@/src/constants/positionColors';

export const PITCH_SLOT_WIDTH = 68;
export const PITCH_SLOT_HEIGHT = 78;
export const PITCH_DOT_SIZE = 40;

type DraggableDotProps = {
  slot: Slot;
  assigned: Player | null;
  onPress: () => void;
  onDragBegin: () => void;
  onDragEnd: (moveX: number, moveY: number) => boolean;
  setRef: (ref: View | null) => void;
};

export const getPitchSlotPosition = (rowIdx: number, colIdx: number, rowLength: number, totalRows: number) => {
  const rowPercent = totalRows > 1
    ? 10 + (rowIdx / (totalRows - 1)) * 80
    : 50;

  return {
    left: `${((colIdx + 1) / (rowLength + 1)) * 100}%`,
    top: `${rowPercent}%`,
  } as const;
};

export function DraggableDot({
  slot,
  assigned,
  onPress,
  onDragBegin,
  onDragEnd,
  setRef,
}: DraggableDotProps) {
  const [dragging, setDragging] = useState(false);
  const pan = useRef(new Animated.ValueXY()).current;
  const assignedRef = useRef(assigned);
  assignedRef.current = assigned;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => !!assignedRef.current && (Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10),
      onPanResponderGrant: () => {
        setDragging(true);
        onDragBegin();
        pan.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: (_event, gesture: PanResponderGestureState) => {
        setDragging(false);
        pan.flattenOffset();
        const swapped = onDragEnd(gesture.moveX, gesture.moveY);

        if (swapped) {
          pan.setValue({ x: 0, y: 0 });
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

  return (
    <View ref={setRef} style={[styles.pitchDot, { zIndex: dragging ? 100 : 1, elevation: dragging ? 100 : 0 }]}>
      <Animated.View style={[styles.pitchDotDraggable, { transform: pan.getTranslateTransform() }]} {...panResponder.panHandlers}>
        <TouchableOpacity
          style={styles.pitchDotTouch}
          onPress={onPress}
          activeOpacity={0.8}
          delayPressIn={50}
          disabled={dragging}
        >
          <View
            style={[
              styles.pitchDotCircle,
              { backgroundColor: assigned ? getPositionColor(slot.pos) : '#1e3a2f' },
              !assigned && styles.pitchDotEmpty,
            ]}
          >
            <Text style={styles.pitchDotLabel}>
              {assigned ? (assigned.subPosition || slot.pos).substring(0, 3) : slot.label}
            </Text>
          </View>
          <Text style={[styles.pitchDotName, !assigned && styles.emptyName]} numberOfLines={1}>
            {assigned ? assigned.name.split(' ').pop() : ''}
          </Text>
          {assigned && (
            <View style={styles.pitchRatingBadge}>
              <Text style={styles.pitchRatingText}>{assigned.overallRating}</Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pitchDot: { alignItems: 'center', width: PITCH_SLOT_WIDTH },
  pitchDotDraggable: { alignItems: 'center', width: PITCH_SLOT_WIDTH },
  pitchDotTouch: { alignItems: 'center', width: PITCH_SLOT_WIDTH + 20 },
  pitchDotCircle: {
    width: PITCH_DOT_SIZE,
    height: PITCH_DOT_SIZE,
    borderRadius: PITCH_DOT_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  pitchDotEmpty: { borderStyle: 'dotted', borderColor: '#4ade80' },
  pitchDotLabel: { color: '#fff', fontSize: 9, fontWeight: '900' },
  pitchDotName: {
    color: '#fff',
    fontSize: 9,
    marginTop: 4,
    textAlign: 'center',
    fontWeight: '700',
    width: PITCH_SLOT_WIDTH + 20,
    alignSelf: 'center',
  },
  emptyName: { color: '#4ade80' },
  pitchRatingBadge: { backgroundColor: '#cbd5e1', alignSelf: 'center', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3, marginTop: 3 },
  pitchRatingText: { fontSize: 9, fontWeight: '900', color: '#0f172a' },
});

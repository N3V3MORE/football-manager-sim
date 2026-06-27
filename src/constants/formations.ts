export interface Slot { pos: 'GK' | 'DEF' | 'MID' | 'FWD'; label: string; }

export const BASE_FORMATION_SLOTS: Record<string, Slot[][]> = {
  '4-3-3': [
    [{ pos: 'FWD', label: 'LW' }, { pos: 'FWD', label: 'ST' }, { pos: 'FWD', label: 'RW' }],
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
  '3-4-3': [
    [{ pos: 'FWD', label: 'LW' }, { pos: 'FWD', label: 'ST' }, { pos: 'FWD', label: 'RW' }],
    [{ pos: 'MID', label: 'LM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'RM' }],
    [{ pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '3-4-2-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'CAM' }, { pos: 'MID', label: 'CAM' }],
    [{ pos: 'MID', label: 'LM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'RM' }],
    [{ pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-2-3-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'CAM' }, { pos: 'MID', label: 'CAM' }, { pos: 'MID', label: 'CAM' }],
    [{ pos: 'MID', label: 'CDM' }, { pos: 'MID', label: 'CDM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-2-2-2': [
    [{ pos: 'FWD', label: 'ST' }, { pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'CAM' }, { pos: 'MID', label: 'CAM' }],
    [{ pos: 'MID', label: 'CDM' }, { pos: 'MID', label: 'CDM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-5-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'LM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'RM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '5-2-3': [
    [{ pos: 'FWD', label: 'LW' }, { pos: 'FWD', label: 'ST' }, { pos: 'FWD', label: 'RW' }],
    [{ pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }],
    [{ pos: 'DEF', label: 'LWB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RWB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '3-5-2': [
    [{ pos: 'FWD', label: 'ST' }, { pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'LM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CDM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'RM' }],
    [{ pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-1-4-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'LM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'RM' }],
    [{ pos: 'MID', label: 'CDM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '4-3-2-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'CAM' }, { pos: 'MID', label: 'CAM' }],
    [{ pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }, { pos: 'MID', label: 'CM' }],
    [{ pos: 'DEF', label: 'LB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'RB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
  '3-2-4-1': [
    [{ pos: 'FWD', label: 'ST' }],
    [{ pos: 'MID', label: 'LW' }, { pos: 'MID', label: 'CAM' }, { pos: 'MID', label: 'CAM' }, { pos: 'MID', label: 'RW' }],
    [{ pos: 'MID', label: 'CDM' }, { pos: 'MID', label: 'CDM' }],
    [{ pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }, { pos: 'DEF', label: 'CB' }],
    [{ pos: 'GK', label: 'GK' }],
  ],
};

export const SUPPORTED_FORMATIONS = Object.keys(BASE_FORMATION_SLOTS);

export const getSlotsForFormation = (formation: string): Slot[][] => (
  BASE_FORMATION_SLOTS[formation] || BASE_FORMATION_SLOTS['4-3-3']
);

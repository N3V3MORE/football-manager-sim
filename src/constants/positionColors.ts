import { Position } from '../models/types';

export const getPositionColor = (position: Position | string) => {
  switch (position) {
    case 'GK':
      return '#F59E0B';
    case 'DEF':
      return '#3B82F6';
    case 'MID':
      return '#10B981';
    case 'FWD':
      return '#EF4444';
    default:
      return '#6B7280';
  }
};

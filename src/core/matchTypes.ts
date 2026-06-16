export type PlayerCounterStat = 'goals' | 'assists' | 'cleanSheets' | 'yellowCards' | 'redCards';

export type RoleTag =
  | 'GK'
  | 'CB'
  | 'FB'
  | 'WB'
  | 'DM'
  | 'CM'
  | 'AM'
  | 'WIDE_MID'
  | 'WINGER'
  | 'ST';

export type LaneTag = 'left' | 'center' | 'right';

export type TeamShapeProfile = {
  laneLoad: Record<LaneTag, number>;
  lineLoad: { def: number; mid: number; fwd: number };
  roleLoad: Record<RoleTag, number>;
  widePresence: number;
  centralShield: number;
  finalThirdPresence: number;
  boxTargetPresence: number;
  buildOutSupport: number;
  gkDistribution: number;
};


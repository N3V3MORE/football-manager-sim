import { Slot, getSlotsForFormation } from '../constants/formations';
import { Player, Team } from '../models/types';
import { LaneTag, RoleTag, ShapeAccumulator, TeamShapeProfile } from './matchTypes';
import { inferRoleTag } from './matchUtils';

const createRoleLoad = (): Record<RoleTag, number> => ({
  GK: 0,
  CB: 0,
  FB: 0,
  WB: 0,
  DM: 0,
  CM: 0,
  AM: 0,
  WIDE_MID: 0,
  WINGER: 0,
  ST: 0,
});

const inferLaneFromSlot = (slot: Slot, colIndex: number, rowLength: number): LaneTag => {
  const label = slot.label.toUpperCase();
  if (label.startsWith('L')) return 'left';
  if (label.startsWith('R')) return 'right';
  const ratio = rowLength <= 1 ? 0.5 : colIndex / (rowLength - 1);
  if (ratio < 0.34) return 'left';
  if (ratio > 0.66) return 'right';
  return 'center';
};

const inferLaneFromPlayer = (player: Player): LaneTag => {
  const raw = (player.subPosition || '').toUpperCase();
  if (raw.startsWith('L')) return 'left';
  if (raw.startsWith('R')) return 'right';
  return 'center';
};

const inferLineFromRole = (role: RoleTag): 'def' | 'mid' | 'fwd' => {
  if (role === 'GK' || role === 'CB' || role === 'FB' || role === 'WB') return 'def';
  if (role === 'ST' || role === 'WINGER') return 'fwd';
  return 'mid';
};

const addGkDistributionSample = (accumulator: ShapeAccumulator, role: RoleTag, player: Player) => {
  if (role !== 'GK') return;
  accumulator.gkSamples += 1;
  accumulator.gkDistributionAccumulator += (
    ((player.stats.passing || 50) * 0.35) +
    ((player.stats.gk_kicking || player.stats.gk_reflexes || 50) * 0.4) +
    ((player.stats.gk_positioning || 50) * 0.25)
  );
};

const addLineLoadFromSlot = (lineLoad: { def: number; mid: number; fwd: number }, pos: Slot['pos']) => {
  if (pos === 'MID') lineLoad.mid += 1;
  else if (pos === 'FWD') lineLoad.fwd += 1;
  else lineLoad.def += 1;
};

const finalizeShapeProfile = (
  laneLoad: Record<LaneTag, number>,
  lineLoad: { def: number; mid: number; fwd: number },
  roleLoad: Record<RoleTag, number>,
  gkDistribution: number
): TeamShapeProfile => {
  const widePresence = laneLoad.left + laneLoad.right + roleLoad.WINGER * 0.6 + roleLoad.WB * 0.5 + roleLoad.WIDE_MID * 0.4;
  const centralShield = roleLoad.DM * 1.2 + roleLoad.CM * 0.8 + roleLoad.CB * 0.35;
  const finalThirdPresence = roleLoad.ST * 1.5 + roleLoad.AM * 0.9 + roleLoad.WINGER * 0.8 + lineLoad.fwd * 0.25;
  const boxTargetPresence = roleLoad.ST + roleLoad.AM * 0.35 + roleLoad.WINGER * 0.2;
  const buildOutSupport = roleLoad.DM * 1.0 + roleLoad.CM * 0.8 + roleLoad.FB * 0.35 + roleLoad.WB * 0.45 + (gkDistribution - 50) * 0.03;
  return {
    laneLoad,
    lineLoad,
    roleLoad,
    widePresence,
    centralShield,
    finalThirdPresence,
    boxTargetPresence,
    buildOutSupport,
    gkDistribution,
  };
};

export const buildFallbackShapeProfile = (players: Player[]): TeamShapeProfile => {
  const laneLoad: Record<LaneTag, number> = { left: 0, center: 0, right: 0 };
  const lineLoad = { def: 0, mid: 0, fwd: 0 };
  const roleLoad = createRoleLoad();
  const gkAccumulator: ShapeAccumulator = { gkDistributionAccumulator: 0, gkSamples: 0 };

  players.forEach(player => {
    const role = inferRoleTag(player);
    roleLoad[role] += 1;
    laneLoad[inferLaneFromPlayer(player)] += 1;
    lineLoad[inferLineFromRole(role)] += 1;
    addGkDistributionSample(gkAccumulator, role, player);
  });

  const gkDistribution = gkAccumulator.gkSamples > 0
    ? gkAccumulator.gkDistributionAccumulator / gkAccumulator.gkSamples
    : 50;
  return finalizeShapeProfile(laneLoad, lineLoad, roleLoad, gkDistribution);
};

export const buildTeamShapeProfile = (
  team: Team,
  starters: Player[]
): TeamShapeProfile => {
  const laneLoad: Record<LaneTag, number> = { left: 0, center: 0, right: 0 };
  const lineLoad = { def: 0, mid: 0, fwd: 0 };
  const roleLoad = createRoleLoad();
  const gkAccumulator: ShapeAccumulator = { gkDistributionAccumulator: 0, gkSamples: 0 };

  const uniqueStarters = Array.from(new Map(
    starters.map(player => [player.id, player])
  ).values());
  const available = uniqueStarters
    .filter(player => player.matchesSuspended === 0)
    .sort((a, b) => (b.overallRating + b.energy * 0.1) - (a.overallRating + a.energy * 0.1));
  if (available.length > 11) available.splice(11);
  const takeBy = (predicate: (player: Player) => boolean): Player | undefined => {
    const idx = available.findIndex(predicate);
    if (idx < 0) return undefined;
    const [picked] = available.splice(idx, 1);
    return picked;
  };

  const formationSlots = getSlotsForFormation(team.activeFormation);
  formationSlots.forEach((row, rowIdx) => {
    row.forEach((slot, colIdx) => {
      const slotKey = `${rowIdx}-${colIdx}`;
      const mapPlayerId = team.formationMap?.[slotKey];
      const mapped = mapPlayerId ? takeBy(player => player.id === mapPlayerId) : undefined;
      const exact = mapped || takeBy(player => player.subPosition === slot.label || player.altPositions?.includes(slot.label));
      const positional = exact || takeBy(player => player.position === slot.pos);
      const player = positional || takeBy(player => player.position !== 'GK' || slot.pos === 'GK');
      if (!player) return;

      const role = inferRoleTag(player);
      roleLoad[role] += 1;
      laneLoad[inferLaneFromSlot(slot, colIdx, row.length)] += 1;
      addLineLoadFromSlot(lineLoad, slot.pos);
      addGkDistributionSample(gkAccumulator, role, player);
    });
  });

  available.forEach(player => {
    const role = inferRoleTag(player);
    roleLoad[role] += 1;
    laneLoad[inferLaneFromPlayer(player)] += 1;
    lineLoad[inferLineFromRole(role)] += 1;
    addGkDistributionSample(gkAccumulator, role, player);
  });

  const gkDistribution = gkAccumulator.gkSamples > 0
    ? gkAccumulator.gkDistributionAccumulator / gkAccumulator.gkSamples
    : 50;
  return finalizeShapeProfile(laneLoad, lineLoad, roleLoad, gkDistribution);
};

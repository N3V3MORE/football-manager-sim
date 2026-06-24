import { Player, Team } from '../models/types';
import { RoleTag } from './matchTypes';
import { inferRoleTag } from './matchUtils';
import { RandomGenerator, resolveRandom } from './random';
import { ENGINE_CONFIG } from '../config/engineConfig';

type SubstitutionOptions = {
  maxSubsOverride?: number;
  minuteOverride?: number;
  onSubstitution?: (offPlayer: Player, onPlayer: Player, minute: number) => void;
  playerEntryMinutes?: Record<string, number>;
  substitutionState?: {
    substitutesUsed: number;
    substitutionWindowsUsed: number;
    maxSubstitutes?: number;
    maxWindows?: number;
  };
};

const substitutionEntryMinuteCache = new WeakMap<Record<string, number>, Record<string, number>>();

export const applySubstitutions = (
  starters: Player[],
  bench: Player[],
  sentOffPlayers: Set<string>,
  playerMinutes: Record<string, number>,
  team: Team,
  goalsFor: number,
  goalsAgainst: number,
  rng?: RandomGenerator,
  options?: SubstitutionOptions
) => {
  const random = resolveRandom(rng);
  const playerEntryMinutes = options?.playerEntryMinutes
    || substitutionEntryMinuteCache.get(playerMinutes)
    || {};
  if (!options?.playerEntryMinutes && !substitutionEntryMinuteCache.has(playerMinutes)) {
    substitutionEntryMinuteCache.set(playerMinutes, playerEntryMinutes);
  }
  if (bench.length === 0) return;
  const substitutionState = options?.substitutionState;
  const matchSubLimit = substitutionState?.maxSubstitutes ?? 5;
  const matchWindowLimit = substitutionState?.maxWindows ?? 3;
  if (substitutionState && (
    substitutionState.substitutesUsed >= matchSubLimit ||
    substitutionState.substitutionWindowsUsed >= matchWindowLimit
  )) return;

  const scoreDiff = goalsFor - goalsAgainst;
  const isChasing = scoreDiff < 0;
  const isProtectingLead = scoreDiff > 0;
  let maxSubs = ENGINE_CONFIG.SUBS_BASE_MAX;
  if (isChasing) maxSubs = 3 + Math.floor(random() * ENGINE_CONFIG.SUBS_CHASING_BONUS_RANGE);
  else if (isProtectingLead) maxSubs = 2 + Math.floor(random() * ENGINE_CONFIG.SUBS_LEADING_BONUS_RANGE);
  else if (team.tactics.mentality === 'Attacking') maxSubs = 3 + Math.floor(random() * ENGINE_CONFIG.SUBS_ATTACKING_BONUS_RANGE);
  else if (team.tactics.mentality === 'Defensive') maxSubs = 2 + Math.floor(random() * ENGINE_CONFIG.SUBS_DEFENSIVE_BONUS_RANGE);
  if (options?.maxSubsOverride !== undefined) maxSubs = options.maxSubsOverride;
  if (substitutionState) {
    const minute = options.minuteOverride ?? 60;
    const tiredPlayers = starters.filter(player => {
      const minutes = playerMinutes[player.id] ?? minute;
      const energyPressure = player.energy < 35 || (minute >= 70 && player.energy < 55);
      return !sentOffPlayers.has(player.id) && minutes > 0 && energyPressure;
    });
    const baseChance = isChasing ? 0.78 : isProtectingLead ? 0.62 : 0.48;
    const minutePressure = minute >= 76 ? 0.16 : minute >= 66 ? 0.08 : 0;
    const fatiguePressure = Math.min(0.24, tiredPlayers.length * 0.06);
    const mentalityPressure = team.tactics.mentality === 'Attacking' ? 0.05 : team.tactics.mentality === 'Defensive' ? -0.03 : 0;
    const actChance = Math.max(0.12, Math.min(0.92, baseChance + minutePressure + fatiguePressure + mentalityPressure));
    if (tiredPlayers.length === 0 && random() > actChance) return;
  }

  const remainingMatchSubs = substitutionState ? Math.max(0, matchSubLimit - substitutionState.substitutesUsed) : 5;
  const remainingTacticalSubs = substitutionState ? Math.max(0, maxSubs - substitutionState.substitutesUsed) : maxSubs;
  maxSubs = Math.min(remainingMatchSubs, remainingTacticalSubs, bench.length, maxSubs);
  if (maxSubs <= 0) return;
  const usedBench = new Set<string>();
  const usedOff = new Set<string>();
  let substitutionsMade = 0;

  const attackingRoles: RoleTag[] = ['ST', 'WINGER', 'AM'];
  const defensiveRoles: RoleTag[] = ['CB', 'FB', 'WB', 'DM'];
  const preferredOnRoles: RoleTag[] = isChasing
    ? ['ST', 'WINGER', 'AM', 'CM']
    : (isProtectingLead ? ['DM', 'CB', 'FB', 'WB', 'CM'] : ['CM', 'AM', 'ST', 'DM']);
  const [minMinute, maxMinute] = isChasing
    ? ENGINE_CONFIG.SUBS_CHASING_MINUTE_RANGE
    : (isProtectingLead ? ENGINE_CONFIG.SUBS_LEADING_MINUTE_RANGE : ENGINE_CONFIG.SUBS_BALANCED_MINUTE_RANGE);

  for (let i = 0; i < maxSubs; i++) {
    const isAvailableBenchPlayer = (player: Player) =>
      !usedBench.has(player.id) && !sentOffPlayers.has(player.id);
    const hasBenchGK = bench.some(player =>
      isAvailableBenchPlayer(player) && player.position === 'GK'
    );
    const offPool = starters.filter(player =>
      !usedOff.has(player.id) &&
      !sentOffPlayers.has(player.id) &&
      (playerMinutes[player.id] ?? 90) > 0 &&
      !(player.position === 'GK' && !hasBenchGK)
    );
    if (offPool.length === 0) break;
    const offPlayer = offPool
      .map(player => {
        const role = inferRoleTag(player);
        let priority = (100 - player.energy) + (Math.min(90, playerMinutes[player.id] || 90) / 90) * 20;
        if (isChasing && defensiveRoles.includes(role)) priority += 10;
        if (isProtectingLead && attackingRoles.includes(role)) priority += 10;
        if (isProtectingLead && defensiveRoles.includes(role)) priority -= 8;
        if (isChasing && attackingRoles.includes(role)) priority -= 8;
        return { player, priority };
      })
      .sort((a, b) => b.priority - a.priority)[0].player;

    const onPool = bench.filter(isAvailableBenchPlayer);
    if (onPool.length === 0) break;
    // GK safety: if the off-player is a goalkeeper, the on-player must also be a goalkeeper.
    const effectiveOnPool = offPlayer.position === 'GK'
      ? onPool.filter(player => player.position === 'GK')
      : onPool.filter(player => player.position !== 'GK');
    if (effectiveOnPool.length === 0) break;
    // Prefer positional compatibility over broad role preferences.
    // When a bench player shares the departing player's position, subPosition,
    // or an altPosition matching the departing subPosition, use that pool first.
    const positional = effectiveOnPool.filter(player =>
      player.position === offPlayer.position
      || player.subPosition === offPlayer.subPosition
      || player.altPositions?.includes(offPlayer.subPosition)
    );
    const preferred = effectiveOnPool.filter(player => preferredOnRoles.includes(inferRoleTag(player)));
    const selectedPool = positional.length > 0 ? positional : (preferred.length > 0 ? preferred : effectiveOnPool);
    const onPlayer = selectedPool
      .map(player => {
        const role = inferRoleTag(player);
        let score = player.overallRating + player.energy * 0.25;
        if (isChasing && attackingRoles.includes(role)) score += 8;
        if (isProtectingLead && defensiveRoles.includes(role)) score += 8;
        return { player, score };
      })
      .sort((a, b) => b.score - a.score)[0].player;

    const subMinute = options?.minuteOverride ?? (minMinute + Math.floor(random() * Math.max(1, maxMinute - minMinute + 1)));
    const offPlayerEntryMinute = playerEntryMinutes?.[offPlayer.id];
    const offPlayerMinutes = playerMinutes[offPlayer.id] ?? 90;
    playerMinutes[offPlayer.id] = offPlayerEntryMinute !== undefined
      ? Math.max(0, subMinute - offPlayerEntryMinute)
      : Math.min(offPlayerMinutes, subMinute);
    if (playerEntryMinutes && offPlayerEntryMinute !== undefined) delete playerEntryMinutes[offPlayer.id];
    if (playerEntryMinutes) playerEntryMinutes[onPlayer.id] = subMinute;
    playerMinutes[onPlayer.id] = Math.max(playerMinutes[onPlayer.id] || 0, 90 - subMinute);
    usedOff.add(offPlayer.id);
    usedBench.add(onPlayer.id);
    substitutionsMade += 1;
    options?.onSubstitution?.(offPlayer, onPlayer, subMinute);
  }

  if (substitutionState && substitutionsMade > 0) {
    substitutionState.substitutesUsed += substitutionsMade;
    substitutionState.substitutionWindowsUsed += 1;
  }
};

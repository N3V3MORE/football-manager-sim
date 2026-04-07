import { Player, Team } from '../models/types';
import { RoleTag } from './matchTypes';
import { inferRoleTag } from './matchUtils';

export const applySubstitutions = (
  starters: Player[],
  bench: Player[],
  sentOffPlayers: Set<string>,
  playerMinutes: Record<string, number>,
  team: Team,
  goalsFor: number,
  goalsAgainst: number
) => {
  if (bench.length === 0) return;
  const scoreDiff = goalsFor - goalsAgainst;
  const isChasing = scoreDiff < 0;
  const isProtectingLead = scoreDiff > 0;
  let maxSubs = 2;
  if (isChasing) maxSubs = 3 + Math.floor(Math.random() * 3);
  else if (isProtectingLead) maxSubs = 2 + Math.floor(Math.random() * 3);
  else if (team.tactics.mentality === 'Attacking') maxSubs = 3 + Math.floor(Math.random() * 2);
  else if (team.tactics.mentality === 'Defensive') maxSubs = 2 + Math.floor(Math.random() * 2);
  maxSubs = Math.min(5, bench.length, maxSubs);
  const usedBench = new Set<string>();
  const usedOff = new Set<string>();

  const attackingRoles: RoleTag[] = ['ST', 'WINGER', 'AM'];
  const defensiveRoles: RoleTag[] = ['CB', 'FB', 'WB', 'DM'];
  const preferredOnRoles: RoleTag[] = isChasing
    ? ['ST', 'WINGER', 'AM', 'CM']
    : (isProtectingLead ? ['DM', 'CB', 'FB', 'WB', 'CM'] : ['CM', 'AM', 'ST', 'DM']);
  const minMinute = isChasing ? 50 : (isProtectingLead ? 60 : 55);
  const maxMinute = isChasing ? 78 : (isProtectingLead ? 88 : 84);

  for (let i = 0; i < maxSubs; i++) {
    const offPool = starters.filter(player =>
      !usedOff.has(player.id) &&
      !sentOffPlayers.has(player.id) &&
      (playerMinutes[player.id] ?? 90) > 0
    );
    if (offPool.length === 0) break;
    const offPlayer = offPool
      .map(player => {
        const role = inferRoleTag(player);
        let priority = (100 - player.energy) + ((playerMinutes[player.id] || 90) / 90) * 20;
        if (isChasing && defensiveRoles.includes(role)) priority += 10;
        if (isProtectingLead && attackingRoles.includes(role)) priority += 10;
        if (isProtectingLead && defensiveRoles.includes(role)) priority -= 8;
        if (isChasing && attackingRoles.includes(role)) priority -= 8;
        return { player, priority };
      })
      .sort((a, b) => b.priority - a.priority)[0].player;

    const onPool = bench.filter(player => !usedBench.has(player.id));
    if (onPool.length === 0) break;
    const preferred = onPool.filter(player => preferredOnRoles.includes(inferRoleTag(player)));
    const positional = onPool.filter(player =>
      player.position === offPlayer.position || player.altPositions?.includes(offPlayer.subPosition)
    );
    const selectedPool = preferred.length > 0 ? preferred : (positional.length > 0 ? positional : onPool);
    const onPlayer = selectedPool
      .map(player => {
        const role = inferRoleTag(player);
        let score = player.overallRating + player.energy * 0.25;
        if (isChasing && attackingRoles.includes(role)) score += 8;
        if (isProtectingLead && defensiveRoles.includes(role)) score += 8;
        return { player, score };
      })
      .sort((a, b) => b.score - a.score)[0].player;

    const subMinute = minMinute + Math.floor(Math.random() * Math.max(1, maxMinute - minMinute + 1));
    playerMinutes[offPlayer.id] = Math.min(playerMinutes[offPlayer.id] || 90, subMinute);
    playerMinutes[onPlayer.id] = Math.max(playerMinutes[onPlayer.id] || 0, 90 - subMinute);
    usedOff.add(offPlayer.id);
    usedBench.add(onPlayer.id);
  }
};

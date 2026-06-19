import {
  ContractDecision,
  Player,
  Position,
  SquadNeed,
  SquadNeedSeverity,
  SquadPlan,
  Team,
} from '../models/types';
import { isContractExpiringSoon } from './playerStatusUtils';

const POSITIONS: Position[] = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * Short-term injuries (≤2 weeks) should not trigger permanent squad-depth
 * purchases. Treat those players as available for depth-planning purposes
 * so the AI doesn't overreact to a temporary absence.
 */
const SHORT_TERM_INJURY_THRESHOLD = 2;

const isPlayerUnavailableForPlanning = (player: Player): boolean => {
  if (player.matchesSuspended > 0) return true;
  if ((player.injuryWeeks || 0) > SHORT_TERM_INJURY_THRESHOLD) return true;
  return false;
};

const SEVERITY_VALUE: Record<SquadNeedSeverity, number> = {
  none: 0,
  watch: 1,
  need: 2,
  urgent: 3,
};

const clampPriority = (priority: number) => Math.max(0, Math.min(100, Math.round(priority)));

const average = (values: number[]) => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

const getTeamSquad = (players: Record<string, Player>, teamId: string) => (
  Object.values(players).filter(player => player.teamId === teamId)
);

const getTargetDepth = (team: Team, position: Position) => {
  const isPremierLevel = team.division === 'Premier League' || team.division === 'Continental';
  const baseDepth: Record<Position, number> = isPremierLevel || team.boardProfile.ambition === 'promotion'
    ? { GK: 2, DEF: 6, MID: 6, FWD: 4 }
    : { GK: 2, DEF: 5, MID: 5, FWD: 3 };

  if (team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe') {
    return baseDepth[position] + (position === 'GK' ? 0 : 1);
  }

  return baseDepth[position];
};

const getMoreSevere = (current: SquadNeedSeverity, candidate: SquadNeedSeverity) => (
  SEVERITY_VALUE[candidate] > SEVERITY_VALUE[current] ? candidate : current
);

const getRetainRatingFloor = (team: Team) => {
  if (team.boardProfile.ambition === 'elite') return 80;
  if (team.boardProfile.ambition === 'europe') return 77;
  if (team.boardProfile.ambition === 'promotion') return 72;
  if (team.division === 'Premier League') return team.boardProfile.ambition === 'survival' ? 70 : 73;
  if (team.division === 'Championship') return 67;
  if (team.division === 'League One') return 63;
  return 60;
};

const getPositionWageShareWatchThreshold = (team: Team) => {
  if (team.boardProfile.transferDiscipline === 'strict') return 0.30;
  if (team.boardProfile.transferDiscipline === 'aggressive') return 0.38;
  return 0.34;
};

const getHighWageBackupThreshold = (team: Team) => {
  if (team.boardProfile.transferDiscipline === 'strict') return 1.25;
  if (team.boardProfile.transferDiscipline === 'aggressive') return 1.65;
  return 1.45;
};

const buildDepthReason = (
  position: Position,
  currentDepth: number,
  targetDepth: number,
  averageAge: number,
  wageShare: number,
  wageShareWatchThreshold: number,
  severity: SquadNeedSeverity
) => {
  const deficit = targetDepth - currentDepth;
  if (deficit > 0) {
    return `${position} depth is ${deficit} short of the target after availability.`;
  }
  if (averageAge >= 32) {
    return `${position} depth is old enough to need succession planning.`;
  }
  if (averageAge >= 30.5 && severity !== 'none') {
    return `${position} depth is ageing and should be monitored.`;
  }
  if (wageShare >= wageShareWatchThreshold) {
    return `${position} carries a heavy share of the wage bill.`;
  }
  return `${position} depth is aligned with the current squad plan.`;
};

export const evaluateSquadNeeds = (
  team: Team,
  players: Record<string, Player>
): SquadNeed[] => {
  const squad = getTeamSquad(players, team.id);
  const totalWageBill = squad.reduce((sum, player) => sum + (Number.isFinite(player.wage) ? player.wage : 0), 0);

  return POSITIONS.map(position => {
    const positionPlayers = squad.filter(player => player.position === position);
    const availablePlayers = positionPlayers.filter(player => !isPlayerUnavailableForPlanning(player));
    const currentDepth = availablePlayers.length;
    const targetDepth = getTargetDepth(team, position);
    const averageAge = average(positionPlayers.map(player => player.age));
    const wageLoad = positionPlayers.reduce((sum, player) => sum + (Number.isFinite(player.wage) ? player.wage : 0), 0);
    const wageShare = totalWageBill > 0 ? wageLoad / totalWageBill : 0;
    const wageShareWatchThreshold = getPositionWageShareWatchThreshold(team);
    const deficit = targetDepth - currentDepth;
    let severity: SquadNeedSeverity = 'none';

    if (position === 'GK' && currentDepth === 0) {
      severity = 'urgent';
    } else if (deficit >= 2) {
      severity = 'urgent';
    } else if (deficit === 1) {
      severity = 'need';
    }

    if (
      severity === 'none' &&
      (team.boardProfile.ambition === 'elite' || team.boardProfile.ambition === 'europe' || team.boardProfile.ambition === 'promotion') &&
      averageAge >= 30.5
    ) {
      severity = getMoreSevere(severity, averageAge >= 32 ? 'need' : 'watch');
    }

    if (severity === 'none' && currentDepth >= targetDepth + 2 && wageShare >= wageShareWatchThreshold) {
      severity = 'watch';
    }

    return {
      teamId: team.id,
      position,
      severity,
      reason: buildDepthReason(position, currentDepth, targetDepth, averageAge, wageShare, wageShareWatchThreshold, severity),
      currentDepth,
      targetDepth,
      averageAge,
      wageLoad,
    };
  });
};

export const evaluateContractDecisions = (
  team: Team,
  players: Record<string, Player>,
  needs: SquadNeed[] = evaluateSquadNeeds(team, players)
): ContractDecision[] => {
  const squad = getTeamSquad(players, team.id);
  const averageWage = average(squad.map(player => player.wage));
  const retainRatingFloor = getRetainRatingFloor(team);
  const highWageBackupThreshold = getHighWageBackupThreshold(team);
  const needByPosition = needs.reduce<Record<Position, SquadNeed>>((acc, need) => {
    acc[need.position] = need;
    return acc;
  }, {} as Record<Position, SquadNeed>);

  return squad
    .map(player => {
      const need = needByPosition[player.position];
      const expiring = isContractExpiringSoon(player);
      const isCore = player.isStarting || player.overallRating >= retainRatingFloor + 3;
      const isNeededPosition = need && SEVERITY_VALUE[need.severity] >= SEVERITY_VALUE.need;
      const highWageBackup = averageWage > 0 && player.wage >= averageWage * highWageBackupThreshold && !player.isStarting;
      const ageingBackup = player.age >= 31 && !player.isStarting && player.overallRating < retainRatingFloor;
      const lowFitExpiring = expiring && !isCore && !isNeededPosition;

      if (expiring && player.age >= 33 && ageingBackup) {
        return {
          playerId: player.id,
          decision: 'release' as const,
          priority: clampPriority(82 + Math.max(0, 35 - player.contractLeft * 10)),
          reason: `${player.name} is an ageing backup on an expiring deal and sits below the squad standard.`,
        };
      }

      if (expiring && (isCore || isNeededPosition || (player.age <= 23 && player.overallRating >= retainRatingFloor - 4))) {
        const needBoost = isNeededPosition ? 10 : 0;
        const coreBoost = isCore ? 8 : 0;
        return {
          playerId: player.id,
          decision: 'renew' as const,
          priority: clampPriority(70 + needBoost + coreBoost + Math.max(0, 2 - player.contractLeft) * 5),
          reason: isNeededPosition
            ? `${player.name} should be renewed because ${player.position} is a squad need.`
            : `${player.name} remains important enough to renew before the contract runs down.`,
        };
      }

      if (lowFitExpiring && player.marketValue >= 4 && player.age <= 30) {
        return {
          playerId: player.id,
          decision: 'sell' as const,
          priority: clampPriority(64 + Math.min(18, player.marketValue)),
          reason: `${player.name} has resale value but is not central enough to renew immediately.`,
        };
      }

      if (lowFitExpiring) {
        return {
          playerId: player.id,
          decision: 'release' as const,
          priority: 58,
          reason: `${player.name} is not a clear renewal fit and can be allowed to leave.`,
        };
      }

      if (highWageBackup || ageingBackup) {
        return {
          playerId: player.id,
          decision: 'sell' as const,
          priority: clampPriority(highWageBackup ? 56 + (team.boardProfile.transferDiscipline === 'strict' ? 8 : 0) : 48),
          reason: highWageBackup
            ? `${player.name} is a backup carrying too much wage load for a ${team.boardProfile.transferDiscipline} board.`
            : `${player.name} is an ageing backup who can be moved before value drops further.`,
        };
      }

      return {
        playerId: player.id,
        decision: 'hold' as const,
        priority: isCore ? 24 : 12,
        reason: `${player.name} can stay on the current contract plan.`,
      };
    })
    .sort((a, b) => b.priority - a.priority);
};

export const buildSquadPlan = (
  team: Team,
  players: Record<string, Player>
): SquadPlan => {
  const needs = evaluateSquadNeeds(team, players);
  return {
    teamId: team.id,
    needs,
    contractDecisions: evaluateContractDecisions(team, players, needs),
  };
};

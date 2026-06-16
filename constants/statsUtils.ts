import { Player } from '@/src/models/types';

export type PlayerStatKey = 'goals' | 'assists' | 'cleanSheets' | 'yellowCards' | 'redCards';

export function getStatValue(player: Player, stat: PlayerStatKey): number {
  switch (stat) {
    case 'goals':
      return player.goals;
    case 'assists':
      return player.assists;
    case 'cleanSheets':
      return player.cleanSheets;
    case 'yellowCards':
      return player.yellowCards;
    case 'redCards':
      return player.redCards;
    default:
      return 0;
  }
}

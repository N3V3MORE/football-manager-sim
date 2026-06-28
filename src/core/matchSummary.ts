import { Fixture, MatchSummary, Player, PlayerMatchContribution, Team } from '../models/types';

type BuildMatchSummaryInput = {
  fixture: Fixture;
  homeTeam: Team;
  awayTeam: Team;
  players: Record<string, Player>;
  homeParticipants: Player[];
  awayParticipants: Player[];
  homeStarterIds: Set<string>;
  awayStarterIds: Set<string>;
  homeMinuteMap: Record<string, number>;
  awayMinuteMap: Record<string, number>;
  matchContributions?: Record<string, PlayerMatchContribution>;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homePossessions?: number;
  awayPossessions?: number;
  maxMatchMinutes?: number;
};

const getLatestRating = (player: Player) => (
  player.matchRatingHistory?.[player.matchRatingHistory.length - 1] ?? 6
);

const getContribution = (
  matchContributions: Record<string, PlayerMatchContribution> | undefined,
  playerId: string,
  key: keyof PlayerMatchContribution
) => matchContributions?.[playerId]?.[key] || 0;

const dedupeParticipants = (participants: Player[]) => {
  const seen = new Set<string>();
  return participants.filter(player => {
    if (seen.has(player.id)) return false;
    seen.add(player.id);
    return true;
  });
};

export const buildMatchSummary = ({
  fixture,
  homeTeam,
  awayTeam,
  players,
  homeParticipants,
  awayParticipants,
  homeStarterIds,
  awayStarterIds,
  homeMinuteMap,
  awayMinuteMap,
  matchContributions,
  homeShots,
  awayShots,
  homeShotsOnTarget,
  awayShotsOnTarget,
  homePossessions,
  awayPossessions,
  maxMatchMinutes = 90,
}: BuildMatchSummaryInput): MatchSummary => {
  const buildRows = (
    participants: Player[],
    starterIds: Set<string>,
    minuteMap: Record<string, number>
  ) => dedupeParticipants(participants)
    .map(participant => players[participant.id] || participant)
    .filter(player => (minuteMap[player.id] || 0) > 0 || starterIds.has(player.id))
    .map(player => ({
      playerId: player.id,
      teamId: player.teamId,
      name: player.name,
      position: player.position,
      minutes: Math.max(0, Math.min(maxMatchMinutes, Math.round(minuteMap[player.id] || 0))),
      rating: Number(getLatestRating(player).toFixed(1)),
      goals: getContribution(matchContributions, player.id, 'goals'),
      assists: getContribution(matchContributions, player.id, 'assists'),
      yellowCards: getContribution(matchContributions, player.id, 'yellowCards'),
      redCards: getContribution(matchContributions, player.id, 'redCards'),
      started: starterIds.has(player.id),
    }));

  const playerRows = [
    ...buildRows(homeParticipants, homeStarterIds, homeMinuteMap),
    ...buildRows(awayParticipants, awayStarterIds, awayMinuteMap),
  ];

  const manOfTheMatch = [...playerRows].sort((left, right) => {
    if (right.rating !== left.rating) return right.rating - left.rating;
    if (right.goals !== left.goals) return right.goals - left.goals;
    if (right.assists !== left.assists) return right.assists - left.assists;
    return right.minutes - left.minutes;
  })[0];
  const totalPossessions = (homePossessions || 0) + (awayPossessions || 0);

  return {
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeTeamStats: {
      teamId: homeTeam.id,
      goals: fixture.homeScore || 0,
      shots: Math.max(homeShots, homeShotsOnTarget, fixture.homeScore || 0),
      shotsOnTarget: Math.max(homeShotsOnTarget, fixture.homeScore || 0),
      possessionShare: totalPossessions > 0 ? (homePossessions || 0) / totalPossessions : undefined,
    },
    awayTeamStats: {
      teamId: awayTeam.id,
      goals: fixture.awayScore || 0,
      shots: Math.max(awayShots, awayShotsOnTarget, fixture.awayScore || 0),
      shotsOnTarget: Math.max(awayShotsOnTarget, fixture.awayScore || 0),
      possessionShare: totalPossessions > 0 ? (awayPossessions || 0) / totalPossessions : undefined,
    },
    playerRows,
    manOfTheMatchPlayerId: manOfTheMatch?.playerId,
  };
};

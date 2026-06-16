export const RED_CARD_EVENT_PATTERN = /red card|sent off|straight red|reaches for red/i;

export const buildTacticalSetupKey = (team: any) =>
  ([team.activeFormation, team.tactics.mentality, team.tactics.passingStyle, team.tactics.tempo, team.tactics.defensiveLine, team.tactics.pressing].join("|"));

import fs from 'fs';
import readline from 'readline';

const csvFilePath = './FC26_20250921.csv';
const outputFilePath = './src/data/premier_league_players.json';

const TARGET_TEAMS = {
  'Arsenal': 'Arsenal',
  'Aston Villa': 'Aston Villa',
  'AFC Bournemouth': 'Bournemouth',
  'Brentford': 'Brentford',
  'Brighton & Hove Albion': 'Brighton',
  'Burnley': 'Burnley',
  'Chelsea': 'Chelsea',
  'Crystal Palace': 'Crystal Palace',
  'Everton': 'Everton',
  'Fulham FC': 'Fulham',
  'Leeds United': 'Leeds United',
  'Liverpool': 'Liverpool',
  'Manchester City': 'Manchester City',
  'Manchester United': 'Manchester Utd',
  'Newcastle United': 'Newcastle Utd',
  'Nottingham Forest': 'Nottingham Forest',
  'Sunderland': 'Sunderland',
  'Tottenham Hotspur': 'Tottenham Hotspur',
  'West Ham United': 'West Ham Utd',
  'Wolverhampton Wanderers': 'Wolves'
};

const BROAD_POS_MAP = {
  'GK': 'GK',
  'CB': 'DEF', 'LB': 'DEF', 'RB': 'DEF', 'LWB': 'DEF', 'RWB': 'DEF',
  'CDM': 'MID', 'CM': 'MID', 'CAM': 'MID', 'LM': 'MID', 'RM': 'MID',
  'LW': 'FWD', 'RW': 'FWD', 'ST': 'FWD', 'CF': 'FWD', 'LF': 'FWD', 'RF': 'FWD',
};

/**
 * Map a single FIFA sub-position to a broad Position category.
 */
const toBroadPos = (pos) => BROAD_POS_MAP[pos] || 'MID';

/**
 * Parse all positions from a player_positions string like '"CAM, CM, RB"'.
 * Returns a deduped array e.g. ['CAM', 'CM', 'RB'].
 */
const parseAllPositions = (fifaPosStr) => {
  return fifaPosStr
    .replace(/"/g, '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
};

const processCSV = async () => {
  const fileStream = fs.createReadStream(csvFilePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const parsedPlayers = [];
  let headers = null;

  for await (const line of rl) {
    const matchArr = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

    if (!headers) {
      headers = matchArr.map(h => h.trim());
      continue;
    }

    const clubNameIdx = headers.indexOf('club_name');
    if (clubNameIdx === -1) continue;

    const clubName = matchArr[clubNameIdx]?.replace(/"/g, '').trim();
    if (!TARGET_TEAMS[clubName]) continue;

    const shortName = matchArr[headers.indexOf('short_name')]?.replace(/"/g, '').trim();
    const longName = matchArr[headers.indexOf('long_name')]?.replace(/"/g, '').trim();
    const clubJerseyNumber = parseInt(matchArr[headers.indexOf('club_jersey_number')], 10) || null;
    const playerTraits = matchArr[headers.indexOf('player_traits')]?.replace(/"/g, '').trim() || '';

    const fifaPositions = matchArr[headers.indexOf('player_positions')] || '';
    const overall = parseInt(matchArr[headers.indexOf('overall')], 10);
    const age = parseInt(matchArr[headers.indexOf('age')], 10);
    const valueEur = parseInt((matchArr[headers.indexOf('value_eur')] || '0').replace(/"/g, ''), 10);

    const getStat = (key) => parseInt(matchArr[headers.indexOf(key)] || '50', 10);

    const pace       = getStat('pace');
    const shooting   = getStat('shooting');
    const passing    = getStat('passing');
    const dribbling  = getStat('dribbling');
    const defending  = getStat('defending');
    const physic     = getStat('physic');
    const nationality = matchArr[headers.indexOf('nationality_name')]?.replace(/"/g, '').trim() || 'Unknown';

    const gk_diving      = parseInt(matchArr[headers.indexOf('goalkeeping_diving')]       || '5', 10);
    const gk_handling    = parseInt(matchArr[headers.indexOf('goalkeeping_handling')]     || '5', 10);
    const gk_kicking     = parseInt(matchArr[headers.indexOf('goalkeeping_kicking')]      || '5', 10);
    const gk_reflexes    = parseInt(matchArr[headers.indexOf('goalkeeping_reflexes')]     || '5', 10);
    const gk_speed       = parseInt(matchArr[headers.indexOf('goalkeeping_speed')]        || '5', 10);
    const gk_positioning = parseInt(matchArr[headers.indexOf('goalkeeping_positioning')] || '5', 10);

    const allPositions = parseAllPositions(fifaPositions);
    const primaryPos   = allPositions[0] || 'CM';
    const broadPos     = toBroadPos(primaryPos);

    const marketValueM = valueEur > 0
      ? Math.round(valueEur / 100000) / 10  // euros to £m (1 decimal)
      : Math.round(Math.pow(overall, 2.5) / 50000 * 10) / 10;

    const detailedStats = {
      attacking_crossing: getStat('attacking_crossing'),
      attacking_finishing: getStat('attacking_finishing'),
      attacking_heading_accuracy: getStat('attacking_heading_accuracy'),
      attacking_short_passing: getStat('attacking_short_passing'),
      attacking_volleys: getStat('attacking_volleys'),
      skill_dribbling: getStat('skill_dribbling'),
      skill_curve: getStat('skill_curve'),
      skill_fk_accuracy: getStat('skill_fk_accuracy'),
      skill_long_passing: getStat('skill_long_passing'),
      skill_ball_control: getStat('skill_ball_control'),
      movement_acceleration: getStat('movement_acceleration'),
      movement_sprint_speed: getStat('movement_sprint_speed'),
      movement_agility: getStat('movement_agility'),
      movement_reactions: getStat('movement_reactions'),
      movement_balance: getStat('movement_balance'),
      power_shot_power: getStat('power_shot_power'),
      power_jumping: getStat('power_jumping'),
      power_stamina: getStat('power_stamina'),
      power_strength: getStat('power_strength'),
      power_long_shots: getStat('power_long_shots'),
      mentality_aggression: getStat('mentality_aggression'),
      mentality_interceptions: getStat('mentality_interceptions'),
      mentality_positioning: getStat('mentality_positioning'),
      mentality_vision: getStat('mentality_vision'),
      mentality_penalties: getStat('mentality_penalties'),
      mentality_composure: getStat('mentality_composure'),
      defending_marking_awareness: getStat('defending_marking_awareness'),
      defending_standing_tackle: getStat('defending_standing_tackle'),
      defending_sliding_tackle: getStat('defending_sliding_tackle'),
    };

    parsedPlayers.push({
      name: shortName,
      longName,
      fifaTeam: clubName,
      gameTeamTitle: TARGET_TEAMS[clubName],
      position: broadPos,
      subPosition: primaryPos,
      altPositions: allPositions,  // ALL FIFA positions
      overallRating: overall,
      marketValue: marketValueM,
      age,
      nationality,
      clubJerseyNumber,
      playerTraits,
      stats: {
        pace, shooting, passing, dribbling, defending, physic,
        gk_diving, gk_handling, gk_kicking, gk_reflexes, gk_speed, gk_positioning,
        ...detailedStats
      },
      id: parsedPlayers.length.toString(),
    });
  }

  if (!fs.existsSync('./src/data')) {
    fs.mkdirSync('./src/data', { recursive: true });
  }

  fs.writeFileSync(outputFilePath, JSON.stringify(parsedPlayers, null, 2));
  console.log(`Parsed ${parsedPlayers.length} players → ${outputFilePath}`);
  console.log('Sample altPositions:', parsedPlayers.slice(0, 3).map(p => `${p.name}: ${p.altPositions.join(', ')}`));
};

processCSV().catch(console.error);

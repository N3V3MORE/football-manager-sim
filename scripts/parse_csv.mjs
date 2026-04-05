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
    const fifaPositions = matchArr[headers.indexOf('player_positions')] || '';
    const overall = parseInt(matchArr[headers.indexOf('overall')], 10);
    const age = parseInt(matchArr[headers.indexOf('age')], 10);
    const valueEur = parseInt((matchArr[headers.indexOf('value_eur')] || '0').replace(/"/g, ''), 10);

    const pace       = parseInt(matchArr[headers.indexOf('pace')]     || '50', 10);
    const shooting   = parseInt(matchArr[headers.indexOf('shooting')] || '50', 10);
    const passing    = parseInt(matchArr[headers.indexOf('passing')]   || '50', 10);
    const dribbling  = parseInt(matchArr[headers.indexOf('dribbling')]|| '50', 10);
    const defending  = parseInt(matchArr[headers.indexOf('defending')] || '50', 10);
    const physic     = parseInt(matchArr[headers.indexOf('physic')]    || '50', 10);
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

    // Market value: use FIFA value_eur if available, else estimate
    const marketValueM = valueEur > 0
      ? Math.round(valueEur / 100000) / 10  // euros to £m (1 decimal)
      : Math.round(Math.pow(overall, 2.5) / 50000 * 10) / 10;

    parsedPlayers.push({
      name: shortName,
      fifaTeam: clubName,
      gameTeamTitle: TARGET_TEAMS[clubName],
      position: broadPos,
      subPosition: primaryPos,
      altPositions: allPositions,  // ALL FIFA positions
      overallRating: overall,
      marketValue: marketValueM,
      age,
      nationality,
      stats: {
        pace, shooting, passing, dribbling, defending, physic,
        gk_diving, gk_handling, gk_kicking, gk_reflexes, gk_speed, gk_positioning,
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

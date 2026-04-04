import fs from 'fs';
import readline from 'readline';

const csvFilePath = './FC26_20250921.csv';
const outputFilePath = './src/data/premier_league_players.json';

const TARGET_TEAMS = {
  'Arsenal': 'Arsenal',
  'Aston Villa': 'Aston Villa',
  'Bournemouth': 'Bournemouth',
  'Brentford': 'Brentford',
  'Brighton & Hove Albion': 'Brighton',
  'Chelsea': 'Chelsea',
  'Crystal Palace': 'Crystal Palace',
  'Everton': 'Everton',
  'Fulham': 'Fulham',
  'Liverpool': 'Liverpool',
  'Luton Town': 'Luton Town', // Might not be there, but will see
  'Manchester City': 'Manchester City',
  'Manchester United': 'Manchester Utd',
  'Newcastle United': 'Newcastle Utd',
  'Nottingham Forest': 'Nottingham Forest',
  'Sheffield United': 'Sheffield Utd',
  'Tottenham Hotspur': 'Tottenham Hotspur',
  'West Ham United': 'West Ham Utd',
  'Wolverhampton Wanderers': 'Wolves',
  'Leicester City': 'Leicester City'
};

const mapPosition = (fifaPosStr) => {
  // Take first matched position as primary
  const posArray = fifaPosStr.replace(/"/g, '').split(',').map(p => p.trim());
  const primaryPos = posArray[0];
  
  if (['GK'].includes(primaryPos)) return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(primaryPos)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(primaryPos)) return 'MID';
  if (['LW', 'RW', 'ST', 'CF', 'LF', 'RF'].includes(primaryPos)) return 'FWD';
  
  return 'MID'; // Fallback
};

const getSubPosition = (fifaPosStr) => {
  const posArray = fifaPosStr.replace(/"/g, '').split(',').map(p => p.trim());
  return posArray[0] || 'MID'; // Return the raw FIFA position
};

const processCSV = async () => {
    const fileStream = fs.createReadStream(csvFilePath);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const parsedPlayers = [];
    let headers = null;

    for await (const line of rl) {
        // Regex to split by comma but ignore commas inside quotes
        const matchArr = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        
        if (!headers) {
            headers = matchArr.map(h => h.trim());
            continue;
        }

        const clubNameIdx = headers.indexOf('club_name');
        if (clubNameIdx === -1) continue;

        const clubName = matchArr[clubNameIdx]?.replace(/"/g, '').trim();

        if (TARGET_TEAMS[clubName]) {
            const shortName = matchArr[headers.indexOf('short_name')]?.replace(/"/g, '').trim();
            const fifaPositions = matchArr[headers.indexOf('player_positions')];
            const overall = parseInt(matchArr[headers.indexOf('overall')], 10);
            const age = parseInt(matchArr[headers.indexOf('age')], 10);
            const pace = parseInt(matchArr[headers.indexOf('pace')] || "50", 10);
            const shooting = parseInt(matchArr[headers.indexOf('shooting')] || "50", 10);
            const passing = parseInt(matchArr[headers.indexOf('passing')] || "50", 10);
            const dribbling = parseInt(matchArr[headers.indexOf('dribbling')] || "50", 10);
            const defending = parseInt(matchArr[headers.indexOf('defending')] || "50", 10);
            const physic = parseInt(matchArr[headers.indexOf('physic')] || "50", 10);
            const nationality = matchArr[headers.indexOf('nationality_name')]?.replace(/"/g, '').trim() || 'Unknown';
            
            const gk_diving = parseInt(matchArr[headers.indexOf('goalkeeping_diving')] || "50", 10);
            const gk_handling = parseInt(matchArr[headers.indexOf('goalkeeping_handling')] || "50", 10);
            const gk_kicking = parseInt(matchArr[headers.indexOf('goalkeeping_kicking')] || "50", 10);
            const gk_reflexes = parseInt(matchArr[headers.indexOf('goalkeeping_reflexes')] || "50", 10);
            const gk_speed = parseInt(matchArr[headers.indexOf('goalkeeping_speed')] || "50", 10);
            const gk_positioning = parseInt(matchArr[headers.indexOf('goalkeeping_positioning')] || "50", 10);
            
            parsedPlayers.push({
                name: shortName,
                fifaTeam: clubName,
                gameTeamTitle: TARGET_TEAMS[clubName],
                position: mapPosition(fifaPositions),
                subPosition: getSubPosition(fifaPositions),
                overallRating: overall,
                age: age,
                nationality: nationality,
                stats: {
                    pace,
                    shooting,
                    passing,
                    dribbling,
                    defending,
                    physic,
                    gk_diving,
                    gk_handling,
                    gk_kicking,
                    gk_reflexes,
                    gk_speed,
                    gk_positioning
                },
                // additional safety fields
                id: parsedPlayers.length.toString() // temporary, will be assigned uuid in game
            });
        }
    }
    
    // Create folder if it doesn't exist
    if (!fs.existsSync('./src/data')){
        fs.mkdirSync('./src/data', { recursive: true });
    }

    fs.writeFileSync(outputFilePath, JSON.stringify(parsedPlayers, null, 2));
    console.log(`Parsed ${parsedPlayers.length} players into premier_league_players.json`);
};

processCSV().catch(console.error);

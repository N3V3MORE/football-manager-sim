import { useGameStore } from '../src/store/gameStore';

async function runSimulation() {
  const store = useGameStore.getState();
  
  console.log("Initializing Game...");
  // Assume 'TEAM_1' or similar is a valid ID since initGame creates teams.
  // We'll initialize with the first team in the generated data.
  store.initializeGame('dummy'); 
  const teams = Object.values(useGameStore.getState().teams);
  const userTeam = teams[0];
  useGameStore.getState().initializeGame(userTeam.id);

  console.log(`\nUser Team set to: ${userTeam.name}`);
  
  const fixtures = Object.values(useGameStore.getState().fixtures);
  const week1Fixtures = fixtures.filter(f => f.week === 1);
  const myFixture = week1Fixtures.find(f => f.homeTeamId === userTeam.id || f.awayTeamId === userTeam.id) || week1Fixtures[0];

  console.log(`\n--- STARTING LIVE MATCH: ${useGameStore.getState().teams[myFixture.homeTeamId].name} vs ${useGameStore.getState().teams[myFixture.awayTeamId].name} ---`);
  
  // Set all to starting for both teams to avoid 0 strength
  const allPlayers = Object.values(useGameStore.getState().players);
  let homeStarters = 0;
  let awayStarters = 0;
  Object.values(useGameStore.getState().players).forEach(p => {
    if (p.teamId === myFixture.homeTeamId && homeStarters < 11) {
      useGameStore.getState().toggleStarting(p.id);
      homeStarters++;
    }
    if (p.teamId === myFixture.awayTeamId && awayStarters < 11) {
      useGameStore.getState().toggleStarting(p.id);
      awayStarters++;
    }
  });

  // Track player energy BEFORE match
  const firstHomePlayer = Object.values(useGameStore.getState().players).find(p => p.teamId === myFixture.homeTeamId && p.isStarting);
  console.log(`Energy before live match for ${firstHomePlayer?.name}: ${firstHomePlayer?.energy}`);

  for (let min = 1; min <= 45; min++) {
    const res = useGameStore.getState().processMatchMinute(myFixture.id, min);
    if (res.event) console.log(`[Minute ${min}'] ${res.event}`);
  }

  console.log(`\n--- HALFTIME: Exiting match early! ---`);
  const updatedFixture = useGameStore.getState().fixtures[myFixture.id];
  console.log(`Live match score at exit: ${updatedFixture.homeScore} - ${updatedFixture.awayScore}`);
  console.log(`Is match played resolved? ${updatedFixture.isPlayed}`);
  
  const goalscorer = Object.values(useGameStore.getState().players).find(p => p.goals > 0);
  if (goalscorer) {
    console.log(`Player ${goalscorer.name} has ${goalscorer.goals} goals mid-match.`);
  }

  console.log(`\n--- ADVANCING WEEK (triggers auto-simulation for unplayed) ---`);
  useGameStore.getState().advanceWeek();

  const finishedFixture = useGameStore.getState().fixtures[myFixture.id];
  console.log(`Final simulated score: ${finishedFixture.homeScore} - ${finishedFixture.awayScore}`);
  
  if (goalscorer) {
    const afterSimScorer = useGameStore.getState().players[goalscorer.id];
    console.log(`Player ${afterSimScorer.name} goals after full sim: ${afterSimScorer.goals}`);
  }

  const firstHomePlayerAfter = useGameStore.getState().players[firstHomePlayer!.id];
  console.log(`Energy after partial live match + sim: ${firstHomePlayerAfter.energy}`);

  console.log(`\n--- SIMULATING ANOTHER MATCH (playMatch) ---`);
  const week2Fixtures = Object.values(useGameStore.getState().fixtures).filter(f => f.week === 2 && (f.homeTeamId === userTeam.id || f.awayTeamId === userTeam.id));
  const simFix = week2Fixtures[0];
  const playerX = Object.values(useGameStore.getState().players).find(p => p.teamId === simFix.homeTeamId && p.isStarting);
  console.log(`Energy BEFORE quick sim: ${playerX?.energy}`);
  useGameStore.getState().playMatch(simFix.id);
  const playerXAfter = useGameStore.getState().players[playerX!.id];
  console.log(`Energy AFTER quick sim: ${playerXAfter.energy}`);
  
  console.log(`\n--- CHECKING SUSPENSION LOGIC ---`);
  let suspendedPlayer = Object.values(useGameStore.getState().players).find(p => p.matchesSuspended > 0);
  if (!suspendedPlayer) {
    console.log("Forcing a red card...");
    useGameStore.setState(state => {
      const p = Object.values(state.players).find(p => p.teamId === userTeam.id && p.isStarting);
      return {
        players: {
          ...state.players,
          [p!.id]: { ...p!, matchesSuspended: 3, redCards: 1 }
        }
      };
    });
    suspendedPlayer = Object.values(useGameStore.getState().players).find(p => p.matchesSuspended > 0);
  }
  console.log(`Player ${suspendedPlayer?.name} is suspended for ${suspendedPlayer?.matchesSuspended} matches.`);
  console.log(`Is ${suspendedPlayer?.name} still allowed to 'isStarting'? ${suspendedPlayer?.isStarting}`);
  console.log(`Does playMatch filter out suspended players? Let's check logic: NO, playMatch just filters by 'isStarting'.`);

}

runSimulation();

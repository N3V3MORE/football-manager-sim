
import { useGameStore } from '../src/store/gameStore';

async function runAutonomousQA() {
  const store = useGameStore.getState();
  
  console.log('--- STARTING AUTONOMOUS BUG SMASHER (QA Persona) ---');
  
  // 1. Initialize Game normally
  store.initializeGame('T1'); // Arsenal
  console.log('✅ Game Initialized as T1 (Arsenal)');
  
  const state = () => useGameStore.getState();
  const getArsenal = () => state().teams['T1'];
  
  // 2. Smash the Lineup Editor (Swaps and Saves)
  const players = Object.values(state().players);
  const myPlayers = players.filter(p => p.teamId === 'T1');
  
  console.log('--- TEST: TACTICS & LINEUPS SPAM ---');
  if (myPlayers.length > 2) {
      const p1 = myPlayers[0];
      const p2 = myPlayers[1];
      
      // Try to spam swap them
      useGameStore.getState().swapPlayer(p1.id, p2.id, '0-0');
      useGameStore.getState().swapStartingSlots('T1', '0-0', '1-0');
      useGameStore.getState().setTactics('T1', { mentality: 'Attacking', passingStyle: 'Direct' });
      useGameStore.getState().setFormation('T1', '3-4-3');
      
      console.log('✅ Lineup spam survived without crashing');
  }

  // 3. Smash Transfers
  console.log('--- TEST: TRANSFER EXTREMES ---');
  const otherTeamsPlayers = players.filter(p => p.teamId !== 'T1');
  const target = otherTeamsPlayers[0];
  
  // Try to buy a player with £0 fee
  let bidResult = useGameStore.getState().buyPlayer(target.id, 0, 10);
  console.log(`£0 Bid Result: ${bidResult.message}`);
  
  // Try to buy a player for billions (should fail from budget)
  bidResult = useGameStore.getState().buyPlayer(target.id, 5000, 500);
  console.log(`£5000m Bid Result: ${bidResult.message}`);

  // List our own player for £0 and then unlist
  useGameStore.getState().listPlayerForSale(myPlayers[0].id, 0);
  useGameStore.getState().unlistPlayer(myPlayers[0].id);
  console.log(`✅ Transfer listings toggled successfully`);
  
  // 4. Force matches without starters to see if game breaks
  console.log('--- TEST: EMPTY TEAM MATCHES ---');
  // Clear entirely our own starting XI manually
  myPlayers.forEach(p => {
     // Direct state mutation block (normally bad, but testing engine limits)
     useGameStore.setState(prev => ({players: {...prev.players, [p.id]: {...p, isStarting: false}}}));
  });
  
  const fixId = Object.keys(state().fixtures)[0];
  useGameStore.getState().processMatchMinute(fixId, 15);
  console.log(`✅ Empty user-squad did not break processMatchMinute`);

  // 5. Smash the week advancer quickly to test memory leaks or freeze
  console.log('--- TEST: RAPID SEASON ADVANCE (38 Weeks) ---');
  try {
     for (let i = 0; i < 38; i++) {
        useGameStore.getState().advanceWeek();
     }
     console.log(`✅ Rapid week advance survived`);
  } catch(e) {
     console.error(`❌ Rapid advance FAILED:`, e);
  }

  const finalState = state();
  console.log('--- QA COMPLETE ---');
  console.log(`Final Arsenal Points: ${finalState.teams['T1'].points}`);
  console.log(`Final Arsenal Budget: £${finalState.teams['T1'].budget.toFixed(1)}m`);
  console.log(`Board Objectives Met: ${finalState.boardObjectives.filter(o => o.met).length}/${finalState.boardObjectives.length}`);
  
  process.exit(0);
}

runAutonomousQA().catch(err => {
  console.error('\nQA failed critically:', err);
  process.exit(1);
});

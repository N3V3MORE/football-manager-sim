import { useGameStore } from '../src/store/gameStore';
import { getSeasonWeekLimit } from '../src/core/leagueUtils';

async function runAutonomousQA() {
  const store = useGameStore.getState();

  console.log('--- STARTING AUTONOMOUS QA ---');

  store.initializeGame('T1');
  console.log('[OK] Game initialized as T1 (Arsenal)');

  const state = () => useGameStore.getState();
  const players = Object.values(state().players);
  const myPlayers = players.filter(player => player.teamId === 'T1');

  console.log('--- TEST: TACTICS AND LINEUP SPAM ---');
  if (myPlayers.length > 2) {
    const p1 = myPlayers[0]!;
    const p2 = myPlayers[1]!;

    useGameStore.getState().swapPlayer(p1.id, p2.id, '0-0');
    useGameStore.getState().swapStartingSlots('T1', '0-0', '1-0');
    useGameStore.getState().setTactics('T1', { mentality: 'Attacking', passingStyle: 'Direct' });
    useGameStore.getState().setFormation('T1', '3-4-3');

    console.log('[OK] Lineup spam survived without crashing');
  }

  console.log('--- TEST: TRANSFER EXTREMES ---');
  const otherTeamsPlayers = players.filter(player => player.teamId !== 'T1');
  const target = otherTeamsPlayers[0]!;

  let bidResult = useGameStore.getState().buyPlayer(target.id, 0, 10);
  console.log(`GBP 0 bid result: ${bidResult.message}`);

  bidResult = useGameStore.getState().buyPlayer(target.id, 5000, 500);
  console.log(`GBP 5000m bid result: ${bidResult.message}`);

  useGameStore.getState().listPlayerForSale(myPlayers[0]!.id, 0);
  useGameStore.getState().unlistPlayer(myPlayers[0]!.id);
  console.log('[OK] Transfer listings toggled successfully');

  console.log('--- TEST: EMPTY TEAM MATCHES ---');
  myPlayers.forEach(player => {
    useGameStore.setState(prev => ({
      players: { ...prev.players, [player.id]: { ...player, isStarting: false } },
    }));
  });

  const fixtureId = Object.keys(state().fixtures)[0]!;
  useGameStore.getState().processMatchMinute(fixtureId, 15);
  console.log('[OK] Empty user squad did not break processMatchMinute');

  const seasonWeeks = getSeasonWeekLimit(useGameStore.getState().fixtures);
  console.log(`--- TEST: RAPID SEASON ADVANCE (${seasonWeeks} WEEKS) ---`);
  try {
    for (let i = 0; i < seasonWeeks; i++) {
      try {
        useGameStore.getState().advanceWeek();
      } catch (error) {
        console.error(`[FAIL] Rapid advance failed at week ${i + 1}/${seasonWeeks}:`, error);
        throw error;
      }
    }
    console.log('[OK] Rapid week advance survived');
  } catch (error) {
    console.error('[FAIL] Rapid advance failed:', error);
    process.exit(1);
  }

  const finalState = state();
  console.log('--- QA COMPLETE ---');
  console.log(`Final Arsenal points: ${finalState.teams['T1']!.points}`);
  console.log(`Final Arsenal budget: GBP ${finalState.teams['T1']!.budget.toFixed(1)}m`);
  console.log(`Board objectives met: ${finalState.boardObjectives.filter(objective => objective.met).length}/${finalState.boardObjectives.length}`);

  // Reset state after QA run
  useGameStore.getState().initializeGame('T1');
  process.exit(0);
}

runAutonomousQA().catch(error => {
  console.error('\nQA failed critically:', error);
  process.exit(1);
});

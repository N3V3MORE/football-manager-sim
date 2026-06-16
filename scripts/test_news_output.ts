import { useGameStore } from '../src/store/gameStore';
import { initGameData } from '../src/utils/initGame';

const testNews = () => {
  console.log('--- GENERATING TEST NEWS & INBOX MESSAGES ---\n');
  const data = initGameData();
  const firstTeamId = Object.keys(data.teams)[0];
  
  useGameStore.getState().initializeGame(firstTeamId!);
  console.log('Advance Week 1...');
  useGameStore.getState().advanceWeek();

  const state = useGameStore.getState();

  console.log('\n📰 NEWS BOARD:');
  if (state.news.length === 0) {
    console.log('No news generated for this division yet.');
  } else {
    state.news.forEach((newsItem, i) => console.log(` ${i + 1}. ${newsItem}`));
  }

  console.log('\n📥 INBOX MESSAGES (Assistant Manager & System):');
  if (state.inboxMessages.length === 0) {
    console.log('No inbox messages pending.');
  } else {
    state.inboxMessages.forEach((msg) => {
      console.log(`\n[${msg.category.toUpperCase()} - ${msg.source.toUpperCase()}] ${msg.title}`);
      console.log(`> ${msg.body}`);
      if (msg.action) {
        console.log(`> Action Required: ${msg.action.type}`);
      }
      if (msg.isRead) {
        console.log(`> Status: Read`);
      } else {
        console.log(`> Status: Unread`);
      }
    });
  }
  
  console.log('\n--- END OF LOGS ---');
};

testNews();

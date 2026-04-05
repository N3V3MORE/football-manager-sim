import { initGameData } from '../src/utils/initGame';
import { useGameStore } from '../src/store/gameStore';
import * as fs from 'fs';

console.log("Starting simulation...");
useGameStore.getState().initializeGame('T1');

for (let i = 0; i < 38; i++) {
  useGameStore.getState().advanceWeek();
}

const state = useGameStore.getState();
const teams = Object.values(state.teams).sort((a,b) => b.points - a.points);
const players = Object.values(state.players);

let md = `# Season Simulation Results\n\n`;

md += `## League Table\n\n`;
md += `| Pos | Team | PTS | W | D | L | GF | GA | GD |\n`;
md += `|-----|------|-----|---|---|---|----|----|----|\n`;

teams.forEach((t, i) => {
  const gd = t.goalsFor - t.goalsAgainst;
  md += `| ${i+1} | ${t.name} | **${t.points}** | ${t.wins} | ${t.draws} | ${t.losses} | ${t.goalsFor} | ${t.goalsAgainst} | ${gd > 0 ? '+'+gd : gd} |\n`;
});

const topScorers = [...players].sort((a,b) => (b.goals || 0) - (a.goals || 0)).slice(0, 10);
md += `\n## Top Scorers\n\n`;
md += `| Player | Team | Goals |\n`;
md += `|--------|------|-------|\n`;
topScorers.forEach(p => {
  md += `| ${p.name} | ${state.teams[p.teamId]?.name} | **${p.goals}** |\n`;
});

const topAssists = [...players].sort((a,b) => (b.assists || 0) - (a.assists || 0)).slice(0, 10);
md += `\n## Top Assists\n\n`;
md += `| Player | Team | Assists |\n`;
md += `|--------|------|---------|\n`;
topAssists.forEach(p => {
  md += `| ${p.name} | ${state.teams[p.teamId]?.name} | **${p.assists}** |\n`;
});

const topCS = [...players].filter(p => p.position === 'GK').sort((a,b) => (b.cleanSheets || 0) - (a.cleanSheets || 0)).slice(0, 10);
md += `\n## Most Clean Sheets (GK)\n\n`;
md += `| Player | Team | Clean Sheets |\n`;
md += `|--------|------|--------------|\n`;
topCS.forEach(p => {
  md += `| ${p.name} | ${state.teams[p.teamId]?.name} | **${p.cleanSheets}** |\n`;
});

fs.writeFileSync('./scripts/season_results.md', md);
console.log("Results written to artifact!");

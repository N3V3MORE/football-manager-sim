import { initGameData } from '../src/utils/initGame';
import { quickSimMatch } from '../src/core/matchEngine';
import { computeWeeklyProgression, computeWeeklyTransfers } from '../src/core/progressionEngine';
import { Player, Team, Fixture } from '../src/models/types';
import * as fs from 'fs';

/**
 * DETAILED SEASON SIMULATOR
 * Runs 1 season and logs every single match result and scorer details.
 */

async function runDetailedSim() {
    const data = initGameData();
    let state = {
        players: data.players,
        teams: data.teams,
        fixtures: data.fixtures,
        currentWeek: 1,
        news: [] as string[]
    };

    const outputLog: string[] = [];
    outputLog.push(`=== DETAILED SEASON SIMULATION START ===\n`);

    let totalGoals = 0;
    let cleanSheets = 0;
    let redCards = 0;
    let yellowCards = 0;

    for (let w = 1; w <= 38; w++) {
        outputLog.push(`\n--- WEEK ${w} ---`);
        const weekFixtures = Object.values(state.fixtures).filter(f => f.week === w);

        for (const fix of weekFixtures) {
            const home = state.teams[fix.homeTeamId];
            const away = state.teams[fix.awayTeamId];

            // Snapshot player stats before match to find who scored/was carded
            const preMatchPlayers = JSON.parse(JSON.stringify(state.players));

            const result = quickSimMatch(fix.id, state.players, state.teams, state.fixtures);
            state.players = result.players;
            state.teams = result.teams;
            state.fixtures[fix.id] = result.fixture;

            const f = result.fixture;
            totalGoals += (f.homeScore || 0) + (f.awayScore || 0);
            if (f.homeScore === 0 || f.awayScore === 0) cleanSheets++;

            let matchNote = `[MATCH] ${home.name} ${f.homeScore} - ${f.awayScore} ${away.name}`;
            outputLog.push(matchNote);

            // Find Scorers in this match
            const matchScorers: string[] = [];
            const matchCards: string[] = [];

            Object.keys(state.players).forEach(pId => {
                const pNow = state.players[pId];
                const pBefore = preMatchPlayers[pId];

                // Goals
                if (pNow.goals > pBefore.goals) {
                    for(let g=0; g < (pNow.goals - pBefore.goals); g++) matchScorers.push(`   ⚽ Goal: ${pNow.name} (${pNow.position})`);
                }
                // Cards
                if (pNow.yellowCards > pBefore.yellowCards) {
                    yellowCards++;
                    matchCards.push(`   🟨 Yellow: ${pNow.name}`);
                }
                if (pNow.redCards > pBefore.redCards) {
                    redCards++;
                    matchCards.push(`   🟥 RED: ${pNow.name}`);
                }
            });

            if (matchScorers.length > 0) outputLog.push(matchScorers.join('\n'));
            if (matchCards.length > 0) outputLog.push(matchCards.join('\n'));
        }

        // Progression & Transfers
        const prog = computeWeeklyProgression(state.currentWeek, state.players, state.teams, state.fixtures, state.news);
        state.players = prog.players;
        state.teams = prog.teams;
        state.currentWeek = prog.currentWeek;
        state.news = prog.news;

        const trans = computeWeeklyTransfers(state.players, state.teams, null);
        state.players = trans.players;
        state.teams = trans.teams;
    }

    // Final Table
    outputLog.push(`\n=== FINAL PREMIER LEAGUE TABLE ===`);
    const sortedTeams = Object.values(state.teams).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const gdA = a.goalsFor - a.goalsAgainst;
        const gdB = b.goalsFor - b.goalsAgainst;
        if (gdB !== gdA) return gdB - gdA;
        return b.goalsFor - a.goalsFor;
    });

    outputLog.push(`Pos | Team | Pld | W | D | L | GF | GA | GD | Pts`);
    sortedTeams.forEach((t, i) => {
        const gd = t.goalsFor - t.goalsAgainst;
        outputLog.push(`${(i + 1).toString().padStart(2)} | ${t.name.padEnd(12)} | ${t.played} | ${t.wins} | ${t.draws} | ${t.losses} | ${t.goalsFor} | ${t.goalsAgainst} | ${gd.toString().padStart(2)} | ${t.points}`);
    });

    // Season Analysis
    const avgGoals = totalGoals / 380;
    outputLog.push(`\n=== SEASON ANALYSIS ===`);
    outputLog.push(`Total Goals: ${totalGoals}`);
    outputLog.push(`Average Goals per Match: ${avgGoals.toFixed(2)} (Target: 2.7 - 2.8)`);
    outputLog.push(`Clean Sheets: ${cleanSheets}`);
    outputLog.push(`Yellow Cards: ${yellowCards}`);
    outputLog.push(`Red Cards: ${redCards}`);

    fs.writeFileSync('./detailed_season_results.txt', outputLog.join('\n'));
    console.log(`✅ Detailed Simulation Complete. Analysis written to detailed_season_results.txt`);
}

runDetailedSim().catch(console.error);

# Changelog - v2.0.0

## Features
- **Impact-Based Match Engine**: Overhauled the match simulator with a new Impact Coefficient system. Elite players (87+ OVR) now trigger rare, role-specific "Hero Moments" (like 30-yard screamers or triple-saves), giving stars genuine match-winning gravity.
- **Data Restoration**: Patched the CSV parser to handle exact club name matching. The league is now restored to its full 20-team roster (welcome back, Bournemouth and Fulham).
- **Squad Fallback Generator**: Built a procedural roster filler. Even if our source data has gaps, every 2025/26 club is now guaranteed a playable 15-man minimum squad.
- **Awards Dashboard**: Updated the League Stats terminology to "Golden Boot", "Playmaker of the Season", and "Golden Glove". Added a strict filter so only actual goalkeepers qualify for the Golden Glove.
- **Tactical Pitch Overhaul**: Scrapped the old offset grid. Formation nodes now utilize a perfectly synchronized flex grid layout and display clean 3-letter position acronyms along with the player's overall rating (OVR) directly on the pitch.

## Bug Fixes
- **The Assist Hoarding Bug**: Fixed a probability flaw where top playmakers were racking up 70+ assists per season. Flushed the mathematical weights so normal buildup play is fairly distributed across the squad.
- **League Table Wrapping**: Solved a UI bug where large Goal Differences (e.g., +102) would wrap vertically off the screen.
- **ID Normalization**: Stripped legacy UUIDs and migrated the player database down to lightweight sequential numeric IDs for cleaner tracking.

---

# Changelog - v1.0.0

## Features
- **Manual Squad Management**: Teams now start with all players in Reserves. Managers must manually assign the Starting XI via the pitch interface.
- **Pitch-Based Lineup Picker**: Tactically assign players to specific slots (e.g., LB, CB, AM) with eligibility filtering.
- **7-Substitute System**: Designate up to 7 substitutes per match with clear visual badges.
- **Match Engine Tuning**: Stabilized scoring using a tuned Poisson distribution (targeting realistic seasonal goal totals of 80-110 for elite teams).
- **AI Lineup Logic**: Automated best-11 assignment for non-player teams to ensure competitive match simulations.
- **Modernized Position Labels**: Shortened all 3-letter codes to modern 2-letter standards (e.g., DM, AM, WB) for UI clarity.
- **Strategic Visualization**: Color-coded tactical strategies (Defend/Blue, Balanced/Green, Attack/Red).

## Bug Fixes
- **AI Blowouts**: Fixed an issue where AI teams played with empty squads, leading to unrealistic scoring.
- **Goalie Discipline**: Reduced excessive yellow card frequency for goalkeepers.
- **Position Alignment**: Corrected the LW/RW swap on the pitch.

## Technical Updates
- Migrated state management to Atomic Swapping in `gameStore.ts`.
- Implemented `initGameData` parameter for user-specific initialization.
- Fully overhauled `squad.tsx` for premium dark-themed aesthetics and better performance.

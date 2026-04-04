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

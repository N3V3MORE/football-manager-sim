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
- **Manual Squad Management**: I locked down the team rosters so everyone starts in the Reserves now. You have to actively jump into the pitch UI to select and drag your Starting XI.
- **Pitch-Based Lineup Picker**: Added a drag-and-drop tactical board to snap players into positions (LB, CB, AM, etc.). Put some basic filtering in so you know who actually plays where.
- **7-Substitute System**: Got a proper bench working! You can designate 7 subs per match now, and they show up with nice little badges.
- **Match Engine Tuning**: Spent a bunch of time tweaking the Poisson distribution math to stop crazy scorelines. Elite teams are finally hitting realistic seasonal goal totals (around 80-110).
- **AI Lineup Logic**: Wrote an auto-fill routine for the AI managers so they actually pick their best 11, otherwise simming the league was just beating up on ghost squads.
- **Clean Position Labels**: Shaved down the UI clutter by swapping out 3-letter codes for standard 2-letter ones (DM, AM, WB).
- **Strategic Visualization**: Hooked up some color-coded strategy buttons (Defend = Blue, Balanced = Green, Attack = Red) to switch up playstyles on the fly.

## Bug Fixes
- **AI Blowouts**: Prevented the engine from simulating games where AI teams had empty sides (this was breaking the goals-scored logic entirely).
- **Goalie Discipline**: Tuned down the referee logic because keepers were picking up way too many random yellow cards.
- **Position Alignment**: Finally fixed the annoying visual bug where LW and RW were mapped backwards on the pitch!

## Technical Updates
- Moved state management over to Atomic Swapping in `gameStore.ts`.
- Added the `initGameData` param so I can spin up fresh saves based on who the user controls.
- Totally rebuilt `squad.tsx` from scratch for a darker, sleeker aesthetic. Runs way smoother now too.

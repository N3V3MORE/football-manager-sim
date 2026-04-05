# Changelog - v2.0.0

## What's New
- **Better Match Engine**: Tweaked the match simulator so elite players (87+ rating) can actually pull off rare, match-winning plays like screamers or triple-saves. Finally, the big names feel like big names.
- **Data Fixed**: Fixed a bug where teams like Bournemouth and Fulham were just completely missing from the CSV. The Premier League is back to 20 teams now, as it should be.
- **Squad Fallback**: Threw in a quick script to auto-generate missing players. Even if the data is a bit thin, every team will at least have 15 players so the game doesn't break.
- **Awards Dashboard**: Updated the stats screen names to "Golden Boot", "Playmaker of the Season", and "Golden Glove". Oh, and I added a filter so only actual goalkeepers can win the Golden Glove (sorry, left-backs).
- **Pitch UI Fixed**: Rewrote the pitch grid math. The positions are perfectly aligned now, using 3-letter acronyms, and you can see player ratings right on the pitch.

## Bug Fixes
- **Assist Hoarding Bug**: Fixed a funny issue where top playmakers were racking up like 70 assists a season. Adjusted the math so normal players actually pass the ball too.
- **League Table UI**: Fixed a bug where a massive goal difference (like +102) would wrap weirdly on small screens.
- **ID Cleanup**: Cleaned up the player database by moving from bulky UUIDs to simple numbers. 

---

# Changelog - v1.0.0

## What's New
- **Manual Squads**: You actually have to pick your team now. Everyone starts on the bench, and you drag them onto the pitch to set your starting 11.
- **Substitutes**: You can designate up to 7 subs per match now, complete with little badges.
- **Match Tuning**: Tweaked the scoring logic so elite teams score around 80-110 goals a season instead of random numbers.
- **AI Auto-fill**: Set up a basic routine so AI teams pick their best 11. Simming against ghost squads gets boring quickly.
- **Clean Position Labels**: Swapped out the clunky 3-letter positions for standard 2-letter ones (DM, AM, etc.) to keep things tidy.
- **Strategy Buttons**: Added simple color-coded buttons (Defend, Balanced, Attack) just to easily switch up how your team plays.

## Bug Fixes
- **AI Blowouts**: Stopped the simulator from playing games where the AI had no players.
- **Goalie Discipline**: Told the referees to chill out; goalkeepers were getting way too many yellow cards.
- **Position Alignment**: Finally fixed the visual glitch where LW and RW were mapped backwards on the pitch.

## Technical Stuff
- Moved the state management to work a bit better under the hood.
- Added a param so I can spin up fresh saves based on who is playing.
- Redesigned the squad page for a nice dark theme. Looks much better at 2 AM.

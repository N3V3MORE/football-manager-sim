# SideQuest Football Manager Simulator ⚽

A custom-built, data-driven football management experience built with **React Native (Expo)** and **Zustand**. 

I built SideQuest FM to put you right in the manager's seat. It requires tactical precision, squad-building expertise, and strategic gameplay to lead your squad to Premier League glory.

---

## 🚀 Key Features

### 1. Active Squad Management
Unlike rigid simulators, you have total control. All players start in the **Reserves**. You have to manually select and assign your **Starting XI** to position-specific pitch slots.
- **7-Substitute Rule**: Strategy matters—choose your bench wisely to change the game.
- **Mathematical Pitch UI**: The formation board uses a perfectly synchronized flex grid, showing clean 3-letter UI positions along with live OVR ratings directly on the pitch.

### 2. Impact-Based Match Engine (v2)
I threw out the basic event simulator and built a custom **Impact Coefficient** engine. 
- **Hero Moments**: Elite lineup members (87+ OVR) can trigger rare, match-winning plays (like 30-yard screamers or triple-saves). Stars genuinely feel like stars.
- **Fair Playmaking**: The mathematical weights for assists are flattened, ensuring normal buildup play is fairly distributed across your squad instead of one player hoarding 70 assists a season.
- **Full 20-Team Restoration**: Patched the CSV ingestion to ensure exact club matching. Teams that were completely missing before (Bournemouth, Fulham) are back, and I wrote a procedural roster script to ensure every squad has a playable 15-man minimum.

### 3. Modern Tactical Interface
- **Premium Dark Mode**: A sleek, high-contrast aesthetic designed for late-night management sessions.
- **Awards Dashboard**: Track dynamic seasonal stats like the Golden Boot, Playmaker of the Season, and Golden Glove directly in the app.

---

## 🛠️ Getting Started

### Prerequisites
- Node.js (v18+)
- Expo Go (on iOS/Android) or an Emulator

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/N3V3MORE/side-quest.git
   ```
2. Install dependencies:
   ```bash
   cd side-quest
   npm install
   ```
3. Start up the simulator:
   ```bash
   npx expo start
   ```

---

## 📈 Version Notes

I keep a detailed history of features, bug fixes, and technical updates in the **[CHANGELOG.md](./CHANGELOG.md)**.

**Current Version**: `v2.0.0`
- Impact-Based Match Engine integration.
- Procedural missing-squad generation.
- Full 20-team Premier League restoration.
- Tactical Pitch grid overhaul.

---

## 🤝 Contributing

This is a side-quest project of mine. Feel free to fork, submit PRs, or open issues if you have cool feature ideas!

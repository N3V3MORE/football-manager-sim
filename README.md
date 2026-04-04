# SideQuest Football Manager Simulator ⚽

A high-fidelity, data-driven football management experience built with **React Native (Expo)** and **Zustand**. 

SideQuest FM puts you in the manager's seat, requiring tactical precision, squad-building expertise, and strategic gameplay to lead your team to Premier League glory.

---

## 🚀 Key Features

### 1. Manual Squad Management
Unlink traditional simulators, you have total control. All players start in the **Reserves**. You must manually assign your **Starting XI** to position-specific pitch slots.
- **Atomic Swapping**: Seamlessly move players between the pitch, bench, and reserves.
- **7-Substitute Rule**: Strategy matters—choose your bench wisely to change the game.

### 2. Tuned Match Engine
Experience realistic match outcomes powered by a **Poisson-distributed simulation**.
- **Data-Driven**: Team performance is calculated from player ratings, formation synergy, and home advantage.
- **Realistic Scoring**: Top teams compete for high totals (80-110 goals/season) without the "hundred-goal blowout" bugs.
- **Strategic Influence**: Switch between **Defend**, **Balanced**, and **Attack** strategies in real-time to influence the simulation.

### 3. Modern Tactical Interface
- **2-Letter Labels**: Clean, modern pitch layout using standard football shorthand (DM, AM, CB).
- **Premium Dark Mode**: A sleek, high-contrast aesthetic designed for long management sessions.
- **Dynamic Stats**: Track goals, assists, clean sheets, and card counts across the entire league.

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
3. Start the simulator:
   ```bash
   npx expo start
   ```

---

## 📈 Version Notes

We maintain a detailed history of features, bug fixes, and technical updates in our **[CHANGELOG.md](./CHANGELOG.md)**.

**Current Version**: `v1.0.0`
- Manual Lineup building enabled.
- AI Starters restoration.
- Match engine scoring calibration.

---

## 🤝 Contributing

This is a side-quest project. Feel free to fork, submit PRs, or open issues for feature requests (like "In-game substitutions" or "Transfer Market")!

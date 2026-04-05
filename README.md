# Simple Football Sim ⚽

Just a custom-built football sim made with **React Native** and **Zustand**. 

I built this over the weekends because I wanted a straightforward manager game where I could just pick a team, drag players around a pitch, and see what happens over a 38-game season. No microtransactions or overly complicated mechanics.

---

## 🚀 The Basics

### 1. Hands-on Squad Selection
You actually have to set up your team. Every player defaults to the reserves, and you just drag and drop them onto the pitch grid to build your starting 11. It won't let you put 11 strikers on the pitch, but you can try.
- **7-Man Bench**: Pick your subs wisely. (Or don't. It's your club).
- **Pitch Grid**: The UI uses a flexible grid system, so your 3-man midfield won't look weirdly stacked on top of your forwards anymore.

### 2. Match Engine (v2 Updates)
I recently threw out the old math and added a bit more chaos into the engine:
- **Big Moments**: Good players (87+ overall) occasionally do cool stuff. You might get a 30-yard screamer from De Bruyne or a crazy triple-save from Alisson. 
- **Pass the Ball**: Fixed a hilarious math error where one player would just hoard 70 assists a season. Now, the rest of the midfield actually remembers how to pass.
- **20 Teams**: Fixed a data bug so Bournemouth and Fulham are actually in the game now. I also wrote a script to auto-generate some backup players just in case the real-world data was missing someone.

### 3. UI and Stats
- **Dark Mode**: Because looking at glaring white screens at 2 AM is awful.
- **Awards Tab**: Check out who's winning the Golden Boot, Playmaker of the Season, and the Golden Glove. (I finally filtered the Golden Glove so a left-back can't accidentally win it).

---

## 🛠️ How to run it

### What you need
- Node.js (v18+)
- Expo Go on your phone or a simulator

### Setup
1. Download the code:
   ```bash
   git clone https://github.com/N3V3MORE/side-quest.git
   ```
2. Install the stuff:
   ```bash
   cd side-quest
   npm install
   ```
3. Run it:
   ```bash
   npx expo start
   ```

---

## 📈 Updates

I keep a log of changes in the **[CHANGELOG.md](./CHANGELOG.md)** if you want to read what broke and what got fixed.

**Current Version**: `v2.0.0`

---

## 🤝 Contributing

This is just a weekend project. Feel free to mess around with the code, add stuff, or open a pull request!

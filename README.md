# Raahi – plan every day of your trip, then get guided live

Free. No card. Works for India and abroad.

## What it does

- **Plan a trip.** Tell Raahi where, when, how long, where you're staying, your pace, what you like, food, people and budget. It makes a day-by-day plan in the shortest order. The plan fits around opening hours and closed days, includes a lunch break, and respects your start and leaving times. Every place shows its ticket price, highlights, best time, ideal time to spend, a rating out of 10, and how much time you save if you skip it.
- **Not decided yet?** Raahi suggests the best time to go and how many days you need.
- **Live mode (on the trip).** Tap "I'm here" and "Done" at each place. "What's still possible today?" checks the roads and closing times from where you are. Example: "It's 4:30, Guna Caves closes at 5:30, you'd arrive at 5:05 with 25 minutes: too tight." Then it re-plans the rest of your day.
- **Crowds & news.** A live web search of the past week (news, Reddit, reviews) gives each place a "go now" score out of 10, with any alerts.
- **Food.** Real restaurants near your lunch stop and your hotel (pure-veg ones first if you're vegetarian), plus local dishes to try.
- **Where can I go?** "I live in Agra, 6 days, ₹30,000." Get trip ideas with real road distance from home, then plan one in a tap.
- **🧵 Thread trips.** "9 days from Agra, include Isha, Palani and Meenakshi Temple" (or "5 days in Thailand"). Raahi designs one loop through many places and back home: first reach Bengaluru by flight, then Coimbatore → Palani → Kodaikanal → Madurai, with how to travel each leg, when to leave and arrive, ritual timings ("start at 5, before the crowds"), official fees, scam warnings ("pay only at the counter"), where to stay and what to eat. TinyFish checks the named places' timings live, real road distances are measured, and Raahi suggests a shorter order if there is one. One tap turns it into a full day-by-day plan.
- **Ask Raahi.** A chat box on every page that knows your trip.
- **No decision fatigue.** Every question has a "✨ Let Raahi decide" option: pace, start time, dates, number of days, where to stay, even the destination. Can't choose between Agra Fort and the Taj Mahal? Tap ⚖️ Compare on both and Raahi picks one, with a reason. "Let Raahi decide the rest" skips the remaining questions.
- **Famous food & souvenirs.** "Malaiyyo at Blue Lassi Shop, ₹80. Tip: ask for extra malai. Want to have it?" Tap yes and Raahi fits it in at the right time of day. A food tip for every place, plus what to bring back (seashells from Dhanushkodi, a Banarasi saree from Varanasi…).
- **Hands-free on the trip.** GPS checks you in and out automatically (while Raahi is open on your phone). A next-step card always says what to do now. Open **#/now** and "Add to Home screen" to keep it one tap away, like a widget. Leave-by alerts warn you before a place closes.
- **Rain plan** moves outdoor stops to the dry hours. **SOS** button: call 112, send your location on WhatsApp, nearest hospital and police. **Family live share** shows which stop you've reached (check-ins only, never live GPS). **Split expenses** works out who owes whom. **Day recap** every evening.
- **Live checks with TinyFish.** A real browser opens each place on Google Maps: is it open, today's hours, "busier than usual", and the average stars from the last 5 days of reviews. Live mode then uses today's real closing time.
- **Route optimiser (Thread).** Paste any Google Maps route, **including Share links**, or type stops. Get the shortest order.
- Also: print or PDF, share link, budget tracker, packing checklist, emergency numbers, offline copy of your trips, dark mode.
- **Sign in:** Google, email or phone number with a password, or as a guest. Phone sign-in uses a password, not SMS codes, because sending SMS costs money.

## Start it (5 minutes)

1. Install **Node.js** version 22 or newer: go to https://nodejs.org, download the **LTS** version, and click Next through the installer.
2. Unzip this folder, for example onto your Desktop.
3. **Get your free AI key** (recommended, no card):
   1. Open https://aistudio.google.com/apikey and sign in with your Google account.
   2. Click **Create API key**, then copy it.
   3. In the Raahi folder, make a copy of `.env.example` and name it `.env`.
   4. Open `.env` in Notepad, paste your key after `GEMINI_API_KEY=`, and save.
4. Open a terminal **in the Raahi folder**:
   - Windows: open the folder, click the address bar, type `cmd`, press Enter.
   - Mac: right-click the folder → **New Terminal at Folder**.
   5. Optional: put your TinyFish key after `TINYFISH_API_KEY=` (sign up at tinyfish.ai; steps at https://docs.tinyfish.ai/authentication).
5. Type `node server.js` and press Enter.
6. Open **http://localhost:3000** in Chrome.

Keep the terminal window open while you use Raahi. Press Ctrl + C to stop it. Your trips are saved in the `data` folder.

Without the AI key everything still runs. Places then come from OpenStreetMap, but there are no ticket prices, tips, chat, trip ideas or live checks.

## Turn on Google sign-in (optional, free)

1. Go to https://console.cloud.google.com and sign in. Create a project, for example "Raahi". No billing is needed.
2. Open **APIs & Services → OAuth consent screen**. Choose **External**, fill in the app name and your email, and save.
3. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorised JavaScript origins: `http://localhost:3000`
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`), paste it after `GOOGLE_CLIENT_ID=` in `.env`, then restart the server.

## Put Raahi online for everyone (free, Render + Turso)

1. **Database (2 min):** sign up at https://turso.tech (no card), create a database (pick a region in India or close to it).
   Copy its **URL** (starts with `libsql://`) and create a **token**.
2. **Code:** create a **private** GitHub repo and upload this folder (the `.env` file stays out; `.gitignore` handles it).
3. **Render:** sign up at https://render.com → **New → Blueprint** → choose your repo. Render reads `render.yaml`.
4. When it asks for the secret values, paste: `GEMINI_API_KEY`, `TINYFISH_API_KEY`, `GOOGLE_CLIENT_ID`, `TURSO_URL`, `TURSO_TOKEN`. Click **Apply**.
5. After a few minutes you get a link like `https://raahi.onrender.com`. Share it with anyone.
6. **Google sign-in:** in Google Cloud Console → Credentials → your OAuth client, add that link under **Authorised JavaScript origins**.

**No waiting:** Render's free plan normally sleeps after 15 minutes without visitors. Raahi stops that by visiting its own address every 10 minutes (one app awake all month uses about 744 of Render's 750 free hours, so don't run a second free app in the same Render account). The app screens and your saved trips also load straight from the phone, so Raahi opens instantly.
Extra safety (optional): add a free monitor at uptimerobot.com that checks `https://YOUR-LINK/api/config` every 5 minutes. It wakes Raahi again if Render ever restarts it.

## Use it on your phone

- **Same Wi-Fi:** find your computer's IP address (Windows: type `ipconfig` in the terminal, look for "IPv4"). On your phone, open `http://THAT-IP:3000`. Location and installing as an app work best over HTTPS, so for real trips put Raahi online.
- **Put it online for free:** Raahi is one small Node.js app with no build step, so free hosts that run Node work. Ask Claude to walk you through it.

## Honest limits

- Opening hours come from OpenStreetMap when it has them. Otherwise they're AI estimates, and the app labels which is which. Check before a long trip out.
- Road times come from the free OSRM demo server: driving only, no live traffic. Raahi adds 15% for traffic plus 10 minutes per stop for parking and tickets.
- The live "go now" score is the AI's summary of what a web search found in the past week. It's a guide, not a guarantee.
- Gemini's free tier has daily limits, and live web searches are capped at about 500 a day. That's plenty for personal use. Google may use free-tier requests to improve its products.
- Claude's API isn't free, so the default AI is Gemini. You can switch to Claude in `.env` if you ever want to.

## For developers

- `server.js` – web server and API (no packages needed)
- `lib/trips.js` – planning pipeline · `lib/scheduler.js` – day planner (opening hours, lunch, pace) · `lib/solver.js` – shortest order
- `lib/places.js` – Photon, Nominatim, OSRM, Overpass, Open-Meteo (all free, cached) · `lib/ai.js` – Gemini / Claude / OpenAI-style
- `lib/auth.js` – sign-in · `lib/db.js` – SQLite built into Node
- `public/` – the website (plain JavaScript, no build)
- Tests: `npm test` (API, with fake services) · `node test/ui.mjs` (full browser walkthrough, needs Playwright)

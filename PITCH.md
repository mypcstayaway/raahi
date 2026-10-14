# Raahi: a travel companion that removes every decision except "go"

**Problem.** Indian travellers juggle Google Maps, blogs, Reddit and WhatsApp forwards to plan a day. On the trip, plans break: a monument closes early, a place is mobbed, lunch eats an hour. Every one of these moments is a decision, and decision fatigue ruins holidays.

**Raahi** plans every day of a trip in the shortest road order. It fits around real opening hours, closed days, lunch, your pace and your leaving time. Then it guides you live. Every choice has a **"✨ Let Raahi decide"** option, down to "Taj Mahal or Agra Fort? I only have time for one."

## How Raahi uses TinyFish

| TinyFish API | What Raahi does with it | Where you see it |
|---|---|---|
| **Search** | 3 searches per place (news, Reddit, web) limited to the **past 7 days**, used as evidence for an AI "go now" score out of 10 | 🔥 Check crowds & news |
| **Web Agent** | A real browser opens each place on **Google Maps** and reads open/closed status, **today's hours**, live "Popular times" (e.g. "Busier than usual") and the entry fee. It then **sorts reviews by Newest** and reads them, so Raahi shows the **average stars from the last 5 days** | 🔎 Check live on Google Maps |
| **Fetch** | Reads the monument's **official website** for current ticket prices and closure notices | Inside the live check |

TinyFish's results change the plan, not just the display. Live mode uses the **real closing time read today** to answer "It's 4:30, can I still make Guna Caves?" and re-plans the rest of the day.

## The rest of the stack (all free)
- Gemini 2.5 Flash (free key): place ideas, ticket prices, tips, famous food with prices and insider tips, souvenirs, chat
- OpenStreetMap (Photon, Nominatim, Overpass for real opening hours and veg restaurants), OSRM road times, Open-Meteo weather
- Own scheduler: insertion plus local search with time windows, lunch break, pace learning from check-ins; exact shortest-route solver up to 16 stops
- Node.js with built-in SQLite and no dependencies; plain-JS installable web app that works offline

## Demo flow (3 minutes)
1. Sign up and answer 5 taps, or tap "Let Raahi decide for me".
2. "2 days in Agra" → Raahi ticks the best places. ⚖️ Compare Taj vs Agra Fort → "Let Raahi pick".
3. Plan: the Taj Mahal moves to Saturday because it's closed Fridays. Lunch near the fort, pure-veg restaurants first. "Bedai & jalebi at Deviram Sweets, ₹60–100. Want it?" → added at breakfast time.
4. 🔎 Check live (TinyFish): "Busier than usual · last 5 days 3.5★ from 2 reviews".
5. Live mode at 4:30 pm: "Too late: closes 5:00, you'd arrive 4:55." → "Let Raahi decide: use this plan".

// Baby mode: when a traveller is with a baby, every plan, idea, loop and chat answer adapts.
const BABY_TEXT = months => `TRAVELLING WITH A BABY${months ? ` (about ${months} months old)` : " (under 2 years)"}. Plan for the baby first:
- NEVER include places that are risky or frightening for a baby: treks, steep climbs or long stair climbs (unless a ropeway/lift exists), cliffs and unfenced edges, adventure sports (rafting, paragliding, zipline, bungee, scuba), haunted/horror attractions, nightclubs/bars, firecrackers, very loud or very crowded events with crush risk, places above about 2,500 m, or long exposure to strong sun.
- PREFER baby-friendly stops: parks and gardens, lakesides, easy museums, aquariums, calm temples with short queues, places with shade, clean toilets, feeding and changing space, stroller-friendly paths.
- Shorter days: start no earlier than 9:30, finish by 18:00, a long lunch and a nap break around 13:00–15:00, at most 3 main stops a day.
- Travel legs ideally under 4 hours, with breaks every 2 hours; avoid overnight buses.
- Food: clean places with simple, fresh options; mention where hot water / mashed food is easy to get.
- For each place say in "babyNote" what a parent should know (stroller ok? feeding room? queue length? noise?).`;

// Safety net after the AI: drop places that are clearly unsafe for a baby.
const UNSAFE = /\b(trek|trekking|hike|hiking|summit|rafting|paraglid|zip ?line|bungee|scuba|snorkel|rock climb|rappel|cliff jump|haunted|horror|night ?club|pub|bar|casino|fireworks|bullfight|safari jeep|dune bash)/i;
const unsafeForBaby = p => p.category === "adventure" || UNSAFE.test(`${p.name || ""} ${p.why || ""} ${(p.highlights || []).join(" ")}`);

function babyOf(input, prefs) {
  const b = (input && input.baby) || (prefs && prefs.baby);
  return b && b.on ? { on: true, months: b.months ? Math.max(0, Math.min(36, Math.round(+b.months))) : null } : null;
}

module.exports = { BABY_TEXT, unsafeForBaby, babyOf };

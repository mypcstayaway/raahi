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

// A practical note for parents at each kind of place (used when the AI didn't give one).
const TIPS = [
  [/temple|mosque|church|gurudwara|shrine/, "Carry the baby in a sling: queues and crowds can be long, so go early. Shoes come off at the gate."],
  [/museum|gallery|science/, "Stroller is usually fine and the quiet halls are good for a nap. Ask for the lift."],
  [/park|garden|lake|beach|zoo|aquarium/, "Shady and calm: spread a mat and let the baby stretch. Carry a sun hat and water."],
  [/market|bazaar|food street/, "Very crowded lanes: use a carrier, not a stroller, and keep the visit short."],
  [/fort|palace|monument|tomb|heritage|ramparts|mansion/, "Lots of steps and uneven stone: use a carrier. Go before noon to avoid the sun."],
  [/viewpoint|sunset|waterfront|promenade|ghat/, "Keep the baby away from unfenced edges; it gets windy at sunset, so bring a layer."],
  [/show|light|night/, "Loud music and dark seating: bring baby ear muffs, sit near the exit."],
  [/food|cafe|restaurant|sweet|dhaba/, "Ask for fresh, hot, less spicy food; carry your own spoon and bib."],
];
const tipFor = p => { const s = `${p.category || ""} ${p.name || ""}`.toLowerCase(); const t = TIPS.find(([re]) => re.test(s)); return t ? t[1] : "Keep it short; check for shade and a clean toilet nearby."; };
const PACKING = ["👶 Diapers (one every 2–3 hours) and wipes", "👶 Baby carrier or sling: stairs are everywhere", "👶 Light stroller for flat places", "👶 Sun hat, baby sunscreen and a muslin cloth", "👶 Bottle, formula or snacks and a flask of hot water", "👶 ORS, thermometer and the baby's usual medicines", "👶 Spare clothes and a waterproof changing mat"];

// Turn baby mode on or off for a trip that already exists: hide risky places, add notes and packing.
function applyBaby(d, on) {
  let hidden = 0, back = 0;
  for (const p of Object.values(d.places || {})) {
    if (on) {
      if (unsafeForBaby(p) && p.selected) { p.selected = false; p.must = false; p.babyOff = true; hidden++; }
      if (!p.babyNote) { p.babyNote = tipFor(p); p.babyAuto = true; }
    } else {
      if (p.babyOff) { p.selected = true; delete p.babyOff; back++; }
      if (p.babyAuto) { delete p.babyNote; delete p.babyAuto; }
    }
  }
  for (const i of Object.values(d.info || {})) {
    if (!i) continue;
    const rest = (i.packing || []).filter(x => !PACKING.includes(x));
    i.packing = on ? [...PACKING, ...rest] : rest;
  }
  return { hidden, back };
}

function babyOf(input, prefs) {
  const b = (input && input.baby) || (prefs && prefs.baby);
  return b && b.on ? { on: true, months: b.months ? Math.max(0, Math.min(36, Math.round(+b.months))) : null } : null;
}

module.exports = { BABY_TEXT, unsafeForBaby, babyOf, applyBaby, tipFor, PACKING };

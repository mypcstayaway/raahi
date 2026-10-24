// "Why we built Raahi": five illustrative stories, shown one after another.
// These are fictional scenes that show the problem. They are labelled as such on every slide
// and must never be presented as real reviews or testimonials.
import { $, $$, esc } from "./core.js";

const STORIES = [
  {
    em: "🪔", title: "Papa's Ganga Aarti", where: "Lucknow → Varanasi",
    story: "Sharma-ji is 71. He had told the whole family this trip was for the Ganga Aarti he'd dreamed of since he was a boy. The museum queue ran an hour long, the auto got stuck in traffic, and they reached the ghat as the last diyas floated away. He sat on the steps and said quietly, “Koi baat nahi, beta. Agli baar.”",
    raahi: "At 4:10 pm: “You're 50 minutes behind. Skip the museum, leave by 5:40, and you'll get a front spot for the Aarti.”",
  },
  {
    em: "🌘", title: "Alone, after dark", where: "Delhi → Jaipur",
    story: "Riya, 22, saved for months for her first solo trip. Her plan ended at a hilltop fort for the sunset. Nobody told her the last shared jeeps leave early. At 7:30 pm she was alone on a dark road with 9% battery, typing “I'm fine” to her mother while her hands shook.",
    raahi: "At 5:15 pm: “Leave by 5:45, transport thins out after sunset.” Her mother sees each stop on family live share, and SOS is one tap away.",
  },
  {
    em: "🙏", title: "The ₹2,000 “special darshan”", where: "Kanpur → Madurai",
    story: "A young couple on their first trip south, with a 10-month-old baby. At the temple gate a man promised to skip the four-hour queue for ₹2,000. They paid. The official ticket was ₹100, sold at a counter ten steps away. The baby cried through the whole crowded detour.",
    raahi: "Baby mode on: “Official fee ₹100, pay only at the counter. Go at 10:30 am when the queue is short. Feeding room near the east gate.”",
  },
  {
    em: "🕌", title: "Four hours to a locked gate", where: "Meerut → Agra",
    story: "Three generations piled into one car before dawn, the grandchildren asleep on Nani's lap. After four hours on the road they reached the Taj Mahal, and found the gates shut. It was Friday. The children asked why everyone was so quiet on the drive back.",
    raahi: "While planning: “The Taj Mahal is closed on Fridays. Moved to Saturday; Friday becomes Agra Fort and Mehtab Bagh at sunset.”",
  },
  {
    em: "🌧️", title: "The honeymoon washout", where: "Chandigarh → Shimla",
    story: "Aman and Neha booked their honeymoon a year ahead. On day two the rain came at noon, exactly when the walk to the ridge and the toy-train ride were planned. They spent the afternoon in a lobby, scrolling photos of the trip they'd imagined.",
    raahi: "Rain plan at 9 am: “Rain likely 12–4 pm. Ridge walk moved to the morning, toy train to 4:30, museum and café in between.”",
  },
];

export function storiesHTML() {
  return `<section class="stories" aria-roledescription="carousel" aria-label="Why we built Raahi">
    <div class="between" style="margin-bottom:10px"><div><h2 style="margin:0">Why we built Raahi</h2><p class="help" style="margin:2px 0 0">Illustrative stories: the people are fictional, the problems are not.</p></div>
      <div class="row" style="gap:6px"><button type="button" class="icon-btn st-prev" aria-label="Previous story">‹</button><button type="button" class="icon-btn st-next" aria-label="Next story">›</button></div></div>
    <div class="st-view"><div class="st-track">${STORIES.map((s, i) => `
      <article class="st-slide card" role="group" aria-roledescription="slide" aria-label="Story ${i + 1} of ${STORIES.length}">
        <div class="st-top"><span class="st-em" aria-hidden="true">${s.em}</span><div><h3 style="margin:0">${esc(s.title)}</h3><small class="mute">${esc(s.where)}</small></div><span class="tag st-label">Illustrative story</span></div>
        <p class="st-story">${esc(s.story)}</p>
        <div class="st-raahi"><b>With Raahi:</b> ${esc(s.raahi)}</div>
      </article>`).join("")}</div></div>
    <div class="st-dots" role="tablist">${STORIES.map((_, i) => `<button type="button" role="tab" aria-label="Story ${i + 1}" data-i="${i}"></button>`).join("")}</div>
  </section>`;
}

// Slides change every 8 s; pause on hover/focus; swipe on phones; arrows and dots to jump.
export function wireStories(root) {
  const el = $(".stories", root); if (!el) return () => {};
  const track = $(".st-track", el), dots = $$(".st-dots button", el), n = dots.length;
  let i = 0, timer = null, paused = false, x0 = null;
  const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const go = k => {
    i = (k + n) % n;
    track.style.transform = `translateX(-${i * 100}%)`;
    dots.forEach((d, j) => d.setAttribute("aria-selected", j === i));
    $$(".st-slide", el).forEach((s, j) => s.setAttribute("aria-hidden", j !== i));
  };
  const loop = () => { clearInterval(timer); if (!still) timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); if (!paused && document.visibilityState === "visible") go(i + 1); }, 8000); };
  $(".st-prev", el).onclick = () => { go(i - 1); loop(); };
  $(".st-next", el).onclick = () => { go(i + 1); loop(); };
  dots.forEach(d => (d.onclick = () => { go(+d.dataset.i); loop(); }));
  el.addEventListener("mouseenter", () => (paused = true)); el.addEventListener("mouseleave", () => (paused = false));
  el.addEventListener("focusin", () => (paused = true)); el.addEventListener("focusout", () => (paused = false));
  el.addEventListener("touchstart", e => (x0 = e.touches[0].clientX), { passive: true });
  el.addEventListener("touchend", e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { go(i + (dx < 0 ? 1 : -1)); loop(); } x0 = null; });
  go(0); loop();
  return () => clearInterval(timer);
}

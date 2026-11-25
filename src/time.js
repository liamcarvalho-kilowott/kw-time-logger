// Durations are whole minutes; dates are local "YYYY-MM-DD" strings.

const pad = (n) => String(n).padStart(2, "0");

export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

/** Zoho's v1 time log API wants MM-DD-YYYY. */
export function toZohoDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${m}-${d}-${y}`;
}

/** Zoho wants hours as "hh:mm". */
export function toHHMM(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function humanDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function humanDate(iso, today = isoDate()) {
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Reads a duration typed into the hours box: "2", "2.5", "2:30", "2h30", "2h 30m", "90m", "1 hr 15 min".
 * Returns minutes, or null when it can't tell.
 */
export function parseDuration(input) {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m) return clamp(+m[1] * 60 + +m[2]);
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return clamp(Math.round(parseFloat(m[1]) * 60));
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const mins = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  const bare = s.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?\s*(\d+)\s*(?:m|min|mins)?$/);
  if (h || mins) return clamp(Math.round((h ? parseFloat(h[1]) * 60 : 0) + (mins ? +mins[1] : 0)));
  if (bare) return clamp(Math.round(parseFloat(bare[1]) * 60 + +bare[2]));
  return null;
}

function clamp(minutes) {
  return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Finds "today", "yesterday", a weekday ("monday" = the most recent one) or an ISO date in free text. */
export function findDate(text, today = isoDate()) {
  const s = text.toLowerCase();
  const iso = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  if (/\byesterday\b/.test(s)) return addDays(today, -1);
  if (/\btoday\b/.test(s)) return today;
  const [y, mo, d] = today.split("-").map(Number);
  const todayIdx = new Date(y, mo - 1, d).getDay();
  for (let i = 0; i < 7; i++) {
    const name = WEEKDAYS[i];
    // Short forms only on weekdays: "sat" and "sun" are ordinary words too.
    const short = i >= 1 && i <= 5 ? `|${name.slice(0, 3)}` : "";
    if (new RegExp(`\\b(${name}${short})\\b`).test(s)) {
      return addDays(today, -((todayIdx - i + 7) % 7));
    }
  }
  return null;
}

/** Splits `total` minutes over weights, in `step` chunks, so the parts add up exactly. */
export function split(total, weights, step = 15) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum / step) * step);
  let left = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % parts.length, left -= step) parts[i] += step;
  return parts;
}

/**
 * Fits one day's entries into `budget` minutes (what's left of the 8h day).
 * Stated times are kept unless together they overflow the day, then they shrink proportionally.
 * Unstated entries share what's left, weighted by their estimate (`minutes`, default 1h).
 * Never returns more than `budget` in total.
 */
export function fitToDay(entries, budget, step = 15) {
  budget = Math.floor(Math.max(0, budget) / step) * step;
  const out = entries.map(() => 0);
  const fixed = [], free = [];
  entries.forEach((e, i) => (e.stated && e.minutes ? fixed : free).push(i));
  const fixedSum = fixed.reduce((s, i) => s + entries[i].minutes, 0);
  if (fixedSum > budget) {
    split(budget, fixed.map((i) => entries[i].minutes), step).forEach((m, k) => (out[fixed[k]] = m));
    return out;
  }
  for (const i of fixed) out[i] = entries[i].minutes;
  const pool = Math.floor((budget - fixedSum) / step) * step;
  if (free.length && pool) split(pool, free.map((i) => entries[i].minutes || 60), step).forEach((m, k) => (out[free[k]] = m));
  return out;
}

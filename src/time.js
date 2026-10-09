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

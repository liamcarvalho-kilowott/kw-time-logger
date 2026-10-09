// On-device "type it" parser. No network, no API key: finds hours, date, notes,
// and the best-matching task by word overlap. Gemini (src/ai.js) does this better when a key is set.

import { findDate } from "./time.js";

const STOP = new Set(
  ("a an the on for to in of and with at by from into about it its my me i im did do was were " +
    "hrs hr hours hour h min mins minute minutes m log logged logging spent spend worked working work " +
    "today yesterday task tasks project billable non nonbillable").split(" "),
);

export function words(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w) && !/^\d+(\.\d+)?$/.test(w));
}

/** Minutes mentioned anywhere in a sentence ("2h", "1.5 hours", "2:30", "45 min", "half an hour"). */
export function findMinutes(text) {
  const s = text.toLowerCase();
  const colon = s.match(/\b(\d{1,2}):([0-5]\d)\b/);
  if (colon) return +colon[1] * 60 + +colon[2];
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\b/);
  const m = s.match(/(\d+)\s*(?:m|mins?|minutes?)\b/);
  if (h || m) return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? +m[1] : 0)) || null;
  if (/\bhalf (an )?hour\b/.test(s)) return 30;
  if (/\b(an|one) hour\b/.test(s)) return 60;
  return null;
}

function findNotes(text) {
  const quoted = text.match(/["“]([^"”]+)["”]/);
  if (quoted) return quoted[1].trim();
  const after = text.match(/(?:\s[-–—]\s|:\s|\bnotes?:\s*|\bcomments?:\s*)(.+)$/i);
  return after ? after[1].trim() : "";
}

function findBillable(text) {
  if (/\bnon[\s-]?billable\b/i.test(text)) return false;
  if (/\bbillable\b/i.test(text)) return true;
  return null;
}

function scoreTask(task, text, qWords) {
  if (task.key && new RegExp(`\\b${task.key.replace(/[^\w-]/g, "")}\\b`, "i").test(text)) return 100;
  const fields = [
    [words(task.name), 3],
    [words(task.projectName), 2],
    [words(task.tasklist), 1],
  ];
  let score = 0;
  for (const q of new Set(qWords)) {
    let best = 0;
    for (const [list, weight] of fields) {
      for (const w of list) {
        if (w === q) best = Math.max(best, weight);
        else if (q.length >= 4 && w.length >= 4 && (w.startsWith(q) || q.startsWith(w))) best = Math.max(best, weight * 0.6);
      }
    }
    score += best;
  }
  return score;
}

/** "2h on X and 1h on Y" / one per line / separated by ";" → separate entries. */
function splitEntries(text) {
  return text
    .split(/\n|;|,?\s+and\s+(?=(?:\d|half|an hour|one hour))|,\s+(?=\d+(?:\.\d+)?\s*(?:h|hr|m)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function localParse(text, tasks, today) {
  return splitEntries(text).map((piece) => {
    const notes = findNotes(piece);
    const about = notes ? piece.replace(notes, " ") : piece;
    const qWords = words(about);
    const ranked = tasks
      .map((t) => ({ t, score: scoreTask(t, about, qWords) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const clearWinner = top && (top.score >= 100 || !ranked[1] || top.score >= ranked[1].score * 1.5);
    return {
      taskId: top?.t.id ?? "",
      minutes: findMinutes(piece),
      date: findDate(piece, today) ?? today,
      notes,
      billable: findBillable(piece),
      confident: Boolean(top && clearWinner),
      candidates: ranked.slice(0, 5).map((r) => r.t.id),
    };
  });
}

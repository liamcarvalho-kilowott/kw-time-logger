// The day's queue and the history of what was sent. Sending happens in the background worker
// so it finishes even if the popup closes.

import { get, set } from "./storage.js";
import { logTime, NotSignedIn } from "./zoho.js";
import { humanDuration } from "./time.js";

const HISTORY_LIMIT = 300;

/** entry: { taskId, projectId, taskName, projectName, taskKey, date, minutes, billable, notes } */
export async function enqueue(entries) {
  const queue = await get("queue");
  const now = Date.now();
  queue.push(...entries.map((e, i) => ({ ...e, id: `${now}-${i}-${Math.random().toString(36).slice(2, 7)}`, queuedAt: now, error: "" })));
  await set("queue", queue);
}

export async function updateQueued(id, patch) {
  const queue = await get("queue");
  await set("queue", queue.map((e) => (e.id === id ? { ...e, ...patch, error: "" } : e)));
}

export async function removeQueued(id) {
  const queue = await get("queue");
  await set("queue", queue.filter((e) => e.id !== id));
}

async function remember(entry, zohoLogId) {
  const history = await get("history");
  history.unshift({ ...entry, error: "", zohoLogId, sentAt: Date.now() });
  await set("history", history.slice(0, HISTORY_LIMIT));
}

/** Logs one entry right away (not via the queue). */
export async function sendNow(entry) {
  const zohoLogId = await logTime(entry);
  await remember({ ...entry, id: entry.id ?? `now-${Date.now()}` }, zohoLogId);
  return zohoLogId;
}

let sending = null;

/** Sends queued entries (all, or just the given ids). Failures stay in the queue with the error. */
export function sendQueue(ids) {
  sending ??= (async () => {
    const sent = [];
    const failed = [];
    try {
      const queue = await get("queue");
      for (const entry of queue) {
        if (ids && !ids.includes(entry.id)) continue;
        try {
          const zohoLogId = await logTime(entry);
          await remember(entry, zohoLogId);
          await removeQueued(entry.id);
          sent.push(entry);
        } catch (err) {
          failed.push({ ...entry, error: err.message });
          const current = await get("queue");
          await set("queue", current.map((e) => (e.id === entry.id ? { ...e, error: err.message } : e)));
          if (err instanceof NotSignedIn) break;
        }
      }
    } finally {
      sending = null;
    }
    return { sent, failed };
  })();
  return sending;
}

export function summarize(entries) {
  const minutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  return `${entries.length} ${entries.length === 1 ? "entry" : "entries"} (${humanDuration(minutes)})`;
}

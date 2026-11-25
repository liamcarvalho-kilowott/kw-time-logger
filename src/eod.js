// Drafts the day's timesheet at the evening time: what you did (done todos, Notes text) plus a top-up from your
// assigned tasks, up to the daily target. Drafts go into the Queue marked `draft`, and nothing is sent until approved.

import { get, set, getSettings } from "./storage.js";
import { getMyTasks } from "./zoho.js";
import { enqueue } from "./logbook.js";
import { aiParse, aiExpand } from "./ai.js";
import { localParse } from "./match.js";
import { isoDate, humanDuration, split } from "./time.js";

const STEP = 15; // minutes; entries are rounded to quarter hours

/** Builds and queues the draft. Returns { already, entries } (entries is empty when there is nothing to draft). */
export async function generateDraft() {
  const settings = await getSettings();
  const today = isoDate();
  const tasks = await getMyTasks();
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Re-running replaces today's earlier draft instead of duplicating it.
  const kept = (await get("queue")).filter((e) => !(e.draft && e.date === today));
  await set("queue", kept);
  const already = [...(await get("history")), ...kept].filter((e) => e.date === today).reduce((s, e) => s + e.minutes, 0);
  const target = Math.floor((settings.dailyMinutes - already) / STEP) * STEP;
  if (target < STEP) return { already, entries: [] };

  // Evidence: todos ticked off today and your Notes text. Each becomes a candidate for one task.
  const cand = new Map(); // taskId -> { weight, fixed, notes: [], estimated }
  const add = (taskId, weight, note, fixed = 0, estimated = false) => {
    const c = cand.get(taskId) ?? { weight: 0, fixed: 0, notes: [], estimated: true };
    c.weight += weight;
    c.fixed += fixed;
    if (note) c.notes.push(note);
    c.estimated = c.estimated && estimated;
    cand.set(taskId, c);
  };
  for (const t of await get("todos")) {
    if (t.done && byId.has(t.taskId) && isoDate(new Date(t.doneAt)) === today) add(t.taskId, 3, t.text);
  }
  const noteText = ((await get("notes")).add ?? "").trim();
  if (noteText) {
    let parsed;
    try {
      parsed = settings.geminiKey ? await aiParse(noteText, tasks, today, settings.geminiKey) : localParse(noteText, tasks, today);
    } catch {
      parsed = localParse(noteText, tasks, today);
    }
    for (const d of parsed) if (byId.has(d.taskId)) add(d.taskId, 3, d.notes, d.minutes ?? 0);
  }

  // Top-up: with no evidence, spread the day over assigned tasks by hours still to do; with some evidence,
  // add a small share for the biggest assigned tasks. These are guesses, so they are marked estimated.
  const toDo = (t) => (t.assigned ?? 0) - toMinutes(t.logged);
  const open = tasks.filter((t) => !cand.has(t.id) && toDo(t) > 0).sort((a, b) => toDo(b) - toDo(a)).slice(0, cand.size ? 3 : 6);
  for (const t of open) add(t.id, cand.size ? 1 : Math.max(1, toDo(t) / 60), "", 0, true);
  if (!cand.size) return { already, entries: [] };

  // Hours the user wrote down explicitly are honoured; the rest is shared by weight.
  const ids = [...cand.keys()];
  const fixedTotal = ids.reduce((s, id) => s + cand.get(id).fixed, 0);
  const free = ids.filter((id) => !cand.get(id).fixed);
  const pool = Math.max(0, Math.floor((target - fixedTotal) / STEP) * STEP);
  const shares = free.length && pool ? split(pool, free.map((id) => cand.get(id).weight)) : [];
  const minutesFor = new Map(ids.map((id) => [id, cand.get(id).fixed || shares[free.indexOf(id)] || 0]));

  const entries = [];
  const asks = [];
  for (const id of ids) {
    const minutes = minutesFor.get(id);
    if (!minutes) continue;
    const task = byId.get(id);
    const c = cand.get(id);
    // Real work on a task whose assigned time is used up (or too small): ask whoever created the task for more.
    const left = task.assigned == null ? Infinity : task.assigned - toMinutes(task.logged);
    if (!c.estimated && left < minutes) asks.push({ taskName: task.name, projectName: task.projectName, creator: task.creator, minutes: minutes - Math.max(0, left) });
    let notes = c.notes.join("; ") || `Worked on ${task.name}.`;
    if (settings.geminiKey) {
      try {
        notes = await aiExpand(notes, task, settings.geminiKey);
      } catch {} // keep the plain note
    }
    entries.push({
      taskId: id, projectId: task.projectId, taskName: task.name, projectName: task.projectName, taskKey: task.key,
      date: today, minutes, billable: task.billable, notes, draft: true, estimated: c.estimated,
    });
  }
  await enqueue(entries);
  return { already, entries, asks };
}

function toMinutes(v) {
  const m = String(v ?? "").match(/^(\d+):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : 0;
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L} ]+/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Groups the asks by task creator and finds each creator among the saved Slack contacts (by name).
 * Returns { items: [{ name, id, text }], unmatched: [creator names with no saved contact] }.
 */
export function slackAsks(asks, contacts) {
  const find = (creator) => {
    const who = norm(creator);
    return who && contacts.find((c) => c.id && [norm(c.name), norm(c.name).split(" ")[0]].some((n) => n && (who.includes(n) || n.includes(who))));
  };
  const byContact = new Map(); // so two spellings of one person still get a single message
  const unmatched = new Set();
  for (const a of asks) {
    const contact = find(a.creator);
    if (!contact) unmatched.add(a.creator || "the task creator");
    else byContact.set(contact, [...(byContact.get(contact) ?? []), a]);
  }
  const items = [...byContact].map(([contact, list]) => {
    const lines = list.map((a) => `- ${a.taskName} (${a.projectName}): about ${humanDuration(a.minutes)} more`).join("\n");
    return { name: contact.name, id: contact.id, text: `Hi ${contact.name}! I've been working on these tasks, but the assigned hours are used up:\n\n${lines}\n\nCould you please add the hours so I can log them? Thanks!` };
  });
  return { items, unmatched: [...unmatched] };
}

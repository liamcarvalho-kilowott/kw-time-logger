// Background worker: end-of-day sending, reminders, the toolbar badge, and sending on the popup's behalf.

import { get, set, getSettings, onChange } from "./src/storage.js";
import { sendQueue, sendNow, summarize } from "./src/logbook.js";
import { isoDate } from "./src/time.js";

const ALARM = "end-of-day";
const NOTE_REVIEW = "review-queue";
const NOTE_RESULT = "send-result";

function todaysCutoff() {
  return getSettings().then(({ endOfDay }) => {
    const [h, m] = endOfDay.split(":").map(Number);
    const at = new Date();
    at.setHours(h, m, 0, 0);
    return at;
  });
}

async function scheduleEndOfDay() {
  const at = await todaysCutoff();
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  await chrome.alarms.clear(ALARM);
  // One-shot, re-armed after each run, so it stays on the wall-clock time across DST changes.
  await chrome.alarms.create(ALARM, { when: at.getTime() });
}

async function runEndOfDay() {
  const today = isoDate();
  await set("lastEndOfDay", today);
  const due = (await get("queue")).filter((e) => e.date <= today);
  if (!due.length) return;

  const { autoSubmit } = await getSettings();
  if (!autoSubmit) {
    notify(NOTE_REVIEW, "⚡ Time to send your hours", `${summarize(due)} ready for Zoho.`, [{ title: "Send now" }, { title: "Review" }]);
    return;
  }
  const { sent, failed } = await sendQueue(due.map((e) => e.id));
  reportResult(sent, failed);
}

function reportResult(sent, failed) {
  if (failed.length) {
    notify(NOTE_RESULT, "⚡ Some hours didn't reach Zoho", `${sent.length} sent, ${failed.length} failed: ${failed[0].error}`, [{ title: "Review" }]);
  } else if (sent.length) {
    notify(NOTE_RESULT, "⚡ Hours logged in Zoho", `${summarize(sent)} sent.`);
  }
}

/** If Chrome was closed or asleep at the cut-off, catch up the next time it starts. */
async function catchUp() {
  const today = isoDate();
  const missedToday = Date.now() >= (await todaysCutoff()).getTime() && (await get("lastEndOfDay")) !== today;
  const olderEntries = (await get("queue")).some((e) => e.date < today);
  if (missedToday || olderEntries) await runEndOfDay();
}

function notify(id, title, message, buttons) {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    buttons,
    priority: 2,
    requireInteraction: Boolean(buttons),
  });
}

async function openQueue() {
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=queue&page=1") });
  }
}

async function updateBadge() {
  const queue = await get("queue");
  const failed = queue.some((e) => e.error);
  await chrome.action.setBadgeText({ text: queue.length ? String(queue.length) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: failed ? "#dc2626" : "#2563eb" });
}

// ---------- wiring ----------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await scheduleEndOfDay();
  await updateBadge();
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleEndOfDay();
  await updateBadge();
  await catchUp();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await runEndOfDay();
  await scheduleEndOfDay();
});

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  chrome.notifications.clear(id);
  if (id === NOTE_REVIEW && index === 0) {
    const today = isoDate();
    const due = (await get("queue")).filter((e) => e.date <= today);
    const { sent, failed } = await sendQueue(due.map((e) => e.id));
    reportResult(sent, failed);
  } else {
    await openQueue();
  }
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  openQueue();
});

onChange(["queue"], updateBadge);
onChange(["settings"], scheduleEndOfDay);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = {
    "send-queue": () => sendQueue(msg.ids),
    "send-now": () => sendNow(msg.entry).then((zohoLogId) => ({ zohoLogId })),
  }[msg?.type];
  if (!run) return false;
  run()
    .then((result) => reply({ ok: true, ...result }))
    .catch((err) => reply({ ok: false, error: err.message }));
  return true; // keep the channel open for the async reply
});

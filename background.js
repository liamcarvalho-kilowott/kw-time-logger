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

// Funny notifications. {s} is replaced with a summary like "3 entries, 5h 30m".
const JOKES = {
  empty: [
    ["⚡ Zero hours logged?", "Either you napped all day or the timesheet fairy works nights. Log something!"],
    ["🦗 It's quiet in here…", "Your queue is emptier than the office at 6:31 PM on a Friday. What did you do today?"],
    ["🕵️ Zoho is watching", "…and it sees no hours from you today. Just kidding. Mostly. Go log your time!"],
    ["📉 Today's logged hours: none", "Future you will thank present you. Log it now, before you forget what you did."],
  ],
  review: [
    ["⚡ Your hours are getting restless", "{s} waiting for Zoho. Don't leave them on read!"],
    ["⏰ Clock-out o'clock", "{s} ready to send. One click and you're a timesheet legend."],
    ["🧾 Friendly nudge from your timesheet", "{s} ready for Zoho. It's been waiting patiently. Mostly."],
  ],
  sent: [
    ["🎉 Hours delivered!", "{s} landed in Zoho. Your manager just smiled somewhere."],
    ["✅ Timesheet: handled", "{s} sent. Go touch some grass."],
    ["🚀 Zoho received your hours", "{s} sent. You're basically a productivity influencer."],
  ],
  failed: [
    ["💥 Zoho said no", "{n} sent, {f} bounced: {e}. Open the queue and give them another go."],
    ["🙈 Some hours got lost on the way", "{n} sent, {f} failed: {e}. Open the queue to retry."],
  ],
};

const joke = (kind, vars = {}) => {
  const [title, text] = JOKES[kind][Math.floor(Math.random() * JOKES[kind].length)];
  return [title, text.replace(/\{(\w)\}/g, (_, k) => vars[k] ?? "")];
};

async function runEndOfDay() {
  const today = isoDate();
  await set("lastEndOfDay", today);
  const due = (await get("queue")).filter((e) => e.date <= today);
  if (!due.length) {
    notify(NOTE_RESULT, ...joke("empty")); // always say something, even when there's nothing to send
    return;
  }

  const { autoSubmit } = await getSettings();
  if (!autoSubmit) {
    notify(NOTE_REVIEW, ...joke("review", { s: summarize(due) }), [{ title: "Send now" }, { title: "Review" }]);
    return;
  }
  const { sent, failed } = await sendQueue(due.map((e) => e.id));
  reportResult(sent, failed);
}

function reportResult(sent, failed) {
  if (failed.length) {
    notify(NOTE_RESULT, ...joke("failed", { n: sent.length, f: failed.length, e: failed[0].error }), [{ title: "Review" }]);
  } else if (sent.length) {
    notify(NOTE_RESULT, ...joke("sent", { s: summarize(sent) }));
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
  const plain = { type: "basic", iconUrl: "icons/icon128.png", title, message };
  const full = { ...plain, buttons, priority: 2, requireInteraction: Boolean(buttons) };
  // Firefox rejects buttons/priority/requireInteraction, so fall back to a plain notification.
  try {
    Promise.resolve(chrome.notifications.create(id, full)).catch(() => chrome.notifications.create(id, plain));
  } catch {
    chrome.notifications.create(id, plain);
  }
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

/** Opens a Slack chat and types the message into its composer (you press Enter to send). */
async function typeIntoSlack(url, text) {
  const tab = await chrome.tabs.create({ url });
  // The composer is a contenteditable box; Slack's page is a slow single-page app, so wait for it.
  const type = (message) => {
    const box = document.querySelector('[data-qa="message_input"] [contenteditable="true"]') || document.querySelector('.ql-editor[contenteditable="true"]');
    if (!box) return false;
    box.focus();
    message.split("\n").forEach((line, i) => {
      if (i) document.execCommand("insertLineBreak");
      if (line) document.execCommand("insertText", false, line);
    });
    return true;
  };
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 750));
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: type, args: [text] });
      if (res?.result) break;
    } catch {} // page not ready yet
    if (i === 39) return; // never found the composer; the message is still on the clipboard
  }
  // Give the editor a moment to register the text, then press Send.
  await new Promise((r) => setTimeout(r, 500));
  const send = () => {
    const button = document.querySelector('[data-qa="texty_send_button"]');
    if (button && !button.disabled) return button.click();
    const box = document.querySelector('[data-qa="message_input"] [contenteditable="true"]') || document.querySelector('.ql-editor[contenteditable="true"]');
    box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  };
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: send }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "slack-ping") {
    typeIntoSlack(msg.url, msg.text);
    return false;
  }
  if (msg?.type === "test-notification") {
    notify("test", ...joke("empty"));
    return false;
  }
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

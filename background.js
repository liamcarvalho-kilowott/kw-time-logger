// Background worker: end-of-day sending, reminders, the toolbar badge, and sending on the popup's behalf.

import { get, set, getSettings, onChange } from "./src/storage.js";
import { sendQueue, sendNow, summarize } from "./src/logbook.js";
import { isoDate, humanDuration } from "./src/time.js";
import { generateDraft, slackAsks } from "./src/eod.js";
import { isSignedIn } from "./src/zoho.js";

const ALARM = "end-of-day";
const NOTE_REVIEW = "review-queue";
const NOTE_RESULT = "send-result";
const ALARM_DRAFT = "eod-draft";
const NOTE_DRAFT = "draft-ready";

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
  draft: [
    ["⚡ Your timesheet wrote itself", "{s}. Approve and it goes to Zoho."],
    ["📝 Today's hours, pre-filled", "{s}. One click to approve."],
    ["🧾 EOD drafted while you weren't looking", "{s}. Check it and approve."],
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

async function scheduleDraft() {
  const { eodDraftTime } = await getSettings();
  const [h, m] = eodDraftTime.split(":").map(Number);
  const at = new Date();
  at.setHours(h, m, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  await chrome.alarms.clear(ALARM_DRAFT);
  await chrome.alarms.create(ALARM_DRAFT, { when: at.getTime() });
}

/** Drafts today's timesheet and asks for approval on the notification, so the extension never has to be opened. */
async function runDraft(force = false) {
  const today = isoDate();
  await set("lastDraft", today);
  const { eodDraft } = await getSettings();
  const weekend = [0, 6].includes(new Date().getDay());
  if (!force && (!eodDraft || weekend) || !(await isSignedIn())) return;
  try {
    const { entries, asks } = await generateDraft();
    if (!entries.length) return;
    const lines = entries.slice(0, 3).map((e) => `${e.taskName} ${humanDuration(e.minutes)}`).join(", ");
    // Tasks with no hours left: draft a Slack ask to each task creator, sent only when the user approves.
    const { slackContacts } = await getSettings();
    const { items, unmatched } = slackAsks(asks, slackContacts);
    await set("pendingAsks", { date: today, items });
    let extra = "";
    if (items.length) extra += ` Also asks ${items.map((i) => i.name).join(", ")} on Slack for more hours.`;
    if (unmatched.length) extra += ` No Slack contact saved for ${unmatched.join(", ")}.`;
    notify(NOTE_DRAFT, ...joke("draft", { s: `${summarize(entries)}: ${lines}${entries.length > 3 ? "…" : ""}${extra}` }), [{ title: "Approve and send" }, { title: "Review" }]);
  } catch (err) {
    notify(NOTE_RESULT, "⚡ Couldn't draft your timesheet", err.message);
  }
}

async function approveDrafts() {
  const today = isoDate();
  const queue = await get("queue");
  const ids = queue.filter((e) => e.draft && e.date === today).map((e) => e.id);
  await set("queue", queue.map((e) => (ids.includes(e.id) ? { ...e, draft: false } : e)));
  const { sent, failed } = await sendQueue(ids);
  reportResult(sent, failed);
  // The drafted Slack asks go out with the same approval.
  const { slackTeamId } = await getSettings();
  const pending = await get("pendingAsks");
  if (pending?.date === today && slackTeamId) {
    await set("pendingAsks", null);
    for (const a of pending.items) await typeIntoSlack(`https://app.slack.com/client/${encodeURIComponent(slackTeamId)}/${encodeURIComponent(a.id)}`, a.text);
  }
}

async function runEndOfDay() {
  const today = isoDate();
  await set("lastEndOfDay", today);
  const due = (await get("queue")).filter((e) => e.date <= today && !e.draft);
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
  const olderEntries = (await get("queue")).some((e) => e.date < today && !e.draft);
  if (missedToday || olderEntries) await runEndOfDay();
  const { eodDraftTime } = await getSettings();
  const [h, m] = eodDraftTime.split(":").map(Number);
  const draftAt = new Date().setHours(h, m, 0, 0);
  if (Date.now() >= draftAt && (await get("lastDraft")) !== today) await runDraft();
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
  await scheduleDraft();
  await updateBadge();
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleEndOfDay();
  await scheduleDraft();
  await updateBadge();
  await catchUp();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_DRAFT) {
    await runDraft();
    await scheduleDraft();
    return;
  }
  if (alarm.name !== ALARM) return;
  await runEndOfDay();
  await scheduleEndOfDay();
});

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  chrome.notifications.clear(id);
  if (id === NOTE_DRAFT && index === 0) {
    await approveDrafts();
  } else if (id === NOTE_REVIEW && index === 0) {
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
onChange(["settings"], () => Promise.all([scheduleEndOfDay(), scheduleDraft()]));

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
  if (msg?.type === "run-draft") {
    runDraft(true);
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

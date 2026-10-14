// The Notes tab: two free-text boxes, saved as you type.

import { get, set, getSettings } from "./storage.js";

export async function initNotes() {
  const boxes = { add: document.getElementById("notesAdd"), ask: document.getElementById("notesAsk") };
  const saved = await get("notes");
  for (const [key, box] of Object.entries(boxes)) {
    box.value = saved[key] ?? "";
    let timer;
    box.addEventListener("input", () => {
      clearTimeout(timer);
      // Re-read so editing one box never overwrites the other.
      timer = setTimeout(async () => set("notes", { ...(await get("notes")), [key]: box.value }), 300);
    });
  }
}

/** Copies a message built from the "Ask for" box and opens Slack on the chosen person or channel. */
export async function initSlackPing() {
  const to = document.getElementById("slackTo");
  const say = (text) => (document.getElementById("slackMsg").textContent = text);
  const { slackContacts } = await getSettings();
  const contacts = slackContacts.filter((c) => c.id);
  to.replaceChildren(...(contacts.length ? contacts : [{ name: "Add people in Settings", id: "" }]).map((c) => new Option(c.name || c.id, c.id)));

  document.getElementById("slackBtn").onclick = async () => {
    const { slackTeamId } = await getSettings();
    const id = to.value;
    const ask = document.getElementById("notesAsk").value.trim();
    if (!slackTeamId || !id) return say("Add your workspace ID and people in Settings first.");
    if (!ask) return say("Write what to ask for first.");
    const isChannel = /^[CG]/i.test(id);
    const hello = isChannel ? "Hi!" : `Hi ${to.selectedOptions[0].textContent}!`;
    const text = `${hello} Could you please assign me hours or tasks for the following?

${ask}

Thanks!`;
    navigator.clipboard.writeText(text).catch(() => {}); // backup in case typing into Slack fails
    // The background worker does the typing, because this popup closes as soon as Slack opens.
    chrome.runtime.sendMessage({ type: "slack-ping", text, url: `https://app.slack.com/client/${encodeURIComponent(slackTeamId)}/${encodeURIComponent(id)}` });
    say("Opening Slack. The message will be typed in; press Enter to send.");
  };
}

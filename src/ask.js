// The Ask tab: ask a manager for hours or tasks on Slack. The background worker opens the chat, types and sends it.

import { getSettings } from "./storage.js";
import { searchableSelect } from "./searchselect.js";

const $ = (id) => document.getElementById(id);

export async function initAsk() {
  const to = $("askTo");
  const say = (text) => ($("askMsg").textContent = text);
  const { slackContacts } = await getSettings();
  const contacts = slackContacts.filter((c) => c.id);
  to.replaceChildren(...(contacts.length ? contacts : [{ name: "Add people in Settings", id: "" }]).map((c) => new Option(c.name || c.id, c.id)));
  searchableSelect(to);

  // Handy: reuse what you jotted down in the Notes tab.
  $("askFromNotes").onclick = () => {
    $("askDetails").value = $("notesAsk").value.trim();
  };

  $("askBtn").onclick = async () => {
    const { slackTeamId } = await getSettings();
    const id = to.value;
    const hours = $("askHours").value.trim();
    const forWhat = $("askFor").value.trim();
    const details = $("askDetails").value.trim();
    if (!slackTeamId || !id) return say("Add your workspace ID and people in Settings first.");
    if (!hours && !forWhat && !details) return say("Fill in the hours, what they're for, or some details.");

    const isChannel = /^[CG]/i.test(id);
    const hello = isChannel ? "Hi!" : `Hi ${to.selectedOptions[0].textContent}!`;
    const request = `${hours || "hours or tasks"}${forWhat ? ` for ${forWhat}` : ""}`;
    const text = `${hello} Could you please assign me ${request}?${details ? `\n\n${details}` : ""}\n\nThanks!`;
    navigator.clipboard.writeText(text).catch(() => {}); // backup in case typing into Slack fails
    chrome.runtime.sendMessage({
      type: "slack-ping",
      text,
      url: `https://app.slack.com/client/${encodeURIComponent(slackTeamId)}/${encodeURIComponent(id)}`,
    });
    say("Opening Slack. The message will be typed in and sent.");
  };
}

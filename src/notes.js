// The Notes tab: two free-text boxes, saved as you type.

import { get, set } from "./storage.js";

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

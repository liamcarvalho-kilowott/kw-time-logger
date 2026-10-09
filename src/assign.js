// The Assign tab: a manager creates a Zoho task and assigns it to a project member.

import { listProjects, listProjectUsers, listTasklists, createTask } from "./zoho.js";
import { attachDatePicker } from "./datepicker.js";
import { isoDate, parseDuration } from "./time.js";

const $ = (id) => document.getElementById(id);

function fill(select, items, empty) {
  select.replaceChildren(...[{ id: "", name: empty }, ...items].map((i) => Object.assign(document.createElement("option"), { value: i.id, textContent: i.name })));
  select.disabled = false;
}

function msg(kind, text) {
  const box = $("aMsg");
  box.className = `banner ${kind}`;
  box.textContent = text;
}

export function initAssign() {
  let loaded = false;
  attachDatePicker($("aDue"));

  // Load projects the first time the tab is opened, not on every popup open.
  document.querySelector('[data-tab="assign"]').addEventListener("click", async () => {
    if (loaded) return;
    loaded = true;
    try {
      fill($("aProject"), await listProjects(), "Choose a project");
    } catch (err) {
      loaded = false;
      msg("danger", `Couldn't load projects: ${err.message}. If you connected before this tab existed, Disconnect and Connect Zoho again in Settings so Zoho can grant the new permissions.`);
    }
  });

  $("aProject").onchange = async () => {
    const id = $("aProject").value;
    for (const s of [$("aUser"), $("aList")]) s.disabled = true;
    if (!id) return;
    try {
      const [users, lists] = await Promise.all([listProjectUsers(id), listTasklists(id)]);
      fill($("aUser"), users, "Choose a person");
      fill($("aList"), lists, "No task list");
      $("aMsg").className = "banner hidden";
    } catch (err) {
      msg("danger", `Couldn't load that project: ${err.message}`);
    }
  };

  $("assignForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const hours = $("aHours").value.trim();
    const minutes = hours ? parseDuration(hours) : null;
    const problem = !$("aProject").value ? "Choose a project." : !$("aUser").value ? "Choose who to assign it to." : !$("aName").value.trim() ? "Give the task a name." : hours && !minutes ? "Estimated hours looks wrong. Try 4 or 1:30." : "";
    if (problem) return msg("warn", problem);

    const btn = $("aSubmit");
    btn.disabled = true;
    try {
      const t = await createTask({
        projectId: $("aProject").value,
        name: $("aName").value.trim(),
        description: $("aDesc").value.trim(),
        assigneeId: $("aUser").value,
        tasklistId: $("aList").value,
        dueDate: $("aDue").value,
        priority: $("aPriority").value,
        minutes,
        today: isoDate(),
      });
      const who = $("aUser").selectedOptions[0].textContent;
      msg("ok", `Created${t.key ? ` ${t.key}` : ""} and assigned to ${who}.`);
      for (const id of ["aName", "aDesc", "aDue", "aHours"]) $(id).value = "";
      $("aPriority").value = "";
    } catch (err) {
      msg("danger", `Zoho said: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
}

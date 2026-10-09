import { get, set, getSettings, onChange } from "./src/storage.js";
import { getMyTasks, isSignedIn, NotSignedIn } from "./src/zoho.js";
import { enqueue, updateQueued, removeQueued, summarize } from "./src/logbook.js";
import { localParse } from "./src/match.js";
import { addTodo, updateTodo, toggleTodo, removeTodo, clearDone } from "./src/todos.js";
import { attachDatePicker } from "./src/datepicker.js";
import { isoDate, parseDuration, humanDuration, humanDate, toHHMM } from "./src/time.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get("page")) document.body.classList.add("page");

const state = {
  settings: null,
  tasks: [],
  byId: new Map(),
  taskId: "",
  billable: false,
  billingTouched: false,
  drafts: [],
  draftIndex: 0,
  editingId: null, // queue entry being edited
  menuIndex: 0,
  menuItems: [],
};

// ---------- boot ----------

init().catch((err) => showMsg("danger", err.message));

async function init() {
  state.settings = await getSettings();
  $("settingsBtn").onclick = () => chrome.runtime.openOptionsPage();
  $("setupBtn").onclick = () => chrome.runtime.openOptionsPage();

  if (!state.settings.clientId || !(await isSignedIn())) {
    $("connect").classList.remove("hidden");
    return;
  }
  $("main").classList.remove("hidden");

  wireTabs();
  wireForm();
  wireTodos();
  setDate(isoDate());
  setBilling(false, false);
  updateHint();
  $("matchMode").textContent = state.settings.geminiKey ? "Gemini matches it to your tasks" : "Matched on this device";

  setTasks(await get("tasks")); // instant, from cache
  await restoreDraft();
  renderQueue(await get("queue"));
  renderSent(await get("history"));
  renderTodos(await get("todos"));
  renderToday();
  onChange(["todos"], async () => renderTodos(await get("todos")));
  onChange(["queue", "history"], async () => {
    renderQueue(await get("queue"));
    renderSent(await get("history"));
    renderToday();
  });

  if (params.get("view")) selectTab(params.get("view"));
  else $("say").focus();

  loadTasks(false);
}

async function loadTasks(force) {
  const btn = $("refreshBtn");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    setTasks(await getMyTasks({ force }));
    if (!state.tasks.length) showMsg("warn", "No open tasks are assigned to you in Zoho. Check Settings if that's wrong.");
  } catch (err) {
    if (err instanceof NotSignedIn) {
      $("main").classList.add("hidden");
      $("connect").classList.remove("hidden");
      return;
    }
    showMsg("danger", `Couldn't load tasks: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Refresh tasks";
  }
}

function setTasks(tasks) {
  state.tasks = tasks;
  state.byId = new Map(tasks.map((t) => [t.id, t]));
  const select = $("project");
  const current = select.value;
  const projects = [...new Map(tasks.map((t) => [t.projectId, t.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  select.replaceChildren(
    new Option(`All my projects (${tasks.length} tasks)`, ""),
    ...projects.map(([id, name]) => new Option(name, id)),
  );
  select.value = projects.some(([id]) => id === current) ? current : "";
  fillTodoTaskSelect(projects);
  get("todos").then(renderTodos); // task names on todos may have changed
  if (state.taskId && !state.byId.has(state.taskId)) selectTask("");
}

// ---------- tabs ----------

function wireTabs() {
  for (const tab of document.querySelectorAll("[data-tab]")) tab.onclick = () => selectTab(tab.dataset.tab);
}

function selectTab(name) {
  for (const tab of document.querySelectorAll("[data-tab]")) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  for (const view of document.querySelectorAll("[data-view]")) view.classList.toggle("hidden", view.dataset.view !== name);
}

// ---------- form ----------

function wireForm() {
  $("fillBtn").onclick = fillFromText;
  $("say").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      fillFromText();
    }
  });
  $("skipDraftBtn").onclick = () => nextDraft();
  $("refreshBtn").onclick = () => loadTasks(true);

  $("project").onchange = () => {
    const task = state.byId.get(state.taskId);
    if (task && $("project").value && task.projectId !== $("project").value) selectTask("");
    saveDraft();
  };

  const search = $("taskSearch");
  search.addEventListener("focus", () => openMenu());
  search.addEventListener("input", () => {
    if (state.taskId) {
      state.taskId = "";
      $("taskMeta").textContent = "";
    }
    openMenu();
    saveDraft();
  });
  search.addEventListener("keydown", onMenuKey);
  search.addEventListener("blur", () => setTimeout(closeMenu, 150));

  $("hours").addEventListener("input", () => {
    $("hours").classList.remove("invalid");
    clearProblem();
    saveDraft();
  });
  $("hours").addEventListener("blur", () => {
    const minutes = parseDuration($("hours").value);
    if (minutes) $("hours").value = toHHMM(minutes).replace(/^0(\d)/, "$1");
  });
  for (const chip of $("quickHours").children) {
    chip.onclick = () => {
      $("hours").value = toHHMM(+chip.dataset.min).replace(/^0(\d)/, "$1");
      $("hours").classList.remove("invalid");
      saveDraft();
    };
  }
  attachDatePicker($("date"));
  $("date").onchange = saveDraft;
  $("notes").oninput = saveDraft;
  $("say").oninput = saveDraft;
  for (const b of $("billing").children) b.onclick = () => setBilling(b.dataset.v === "1", true);

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    queueEntry();
  });
  $("form").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      queueEntry();
    }
  });
  $("logNowBtn").onclick = logNow;
}

function setDate(iso) {
  $("date").value = iso;
}

function setBilling(billable, touched) {
  state.billable = billable;
  if (touched) state.billingTouched = true;
  for (const b of $("billing").children) b.setAttribute("aria-pressed", String((b.dataset.v === "1") === billable));
  if (touched) saveDraft();
}

function selectTask(id) {
  state.taskId = id;
  const task = state.byId.get(id);
  $("taskSearch").value = task ? task.name : "";
  $("taskCombo").classList.remove("invalid");
  $("suggestions").classList.add("hidden");
  clearProblem();
  if (!task) {
    $("taskMeta").textContent = "";
    return;
  }
  if ($("project").value && $("project").value !== task.projectId) $("project").value = task.projectId;
  if (!state.billingTouched) setBilling(task.billable, false);
  const bits = [task.key, task.tasklist, $("project").value ? "" : task.projectName, task.logged && task.logged !== "00:00" ? `${task.logged} logged so far` : ""];
  $("taskMeta").textContent = bits.filter(Boolean).join(" · ");
  saveDraft();
}

function matchingTasks(query) {
  const project = $("project").value;
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  return state.tasks.filter((t) => {
    if (project && t.projectId !== project) return false;
    const hay = `${t.key} ${t.name} ${t.tasklist} ${t.projectName}`.toLowerCase();
    return q.every((w) => hay.includes(w));
  });
}

function openMenu() {
  const menu = $("taskMenu");
  const query = state.taskId ? "" : $("taskSearch").value;
  state.menuItems = matchingTasks(query).slice(0, 60);
  state.menuIndex = 0;
  const showProject = !$("project").value;
  menu.replaceChildren(
    ...(state.menuItems.length
      ? state.menuItems.map((t, i) => {
          const li = el("li", { role: "option", "aria-selected": String(i === 0) });
          li.append(el("div", { class: "t" }, t.name), el("div", { class: "s" }, [t.key, t.tasklist, showProject ? t.projectName : ""].filter(Boolean).join(" · ")));
          li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            selectTask(t.id);
            closeMenu();
          });
          return li;
        })
      : [el("li", { class: "empty" }, state.tasks.length ? "No matching tasks" : "No tasks loaded yet")]),
  );
  menu.classList.remove("hidden");
  $("taskSearch").setAttribute("aria-expanded", "true");
}

function closeMenu() {
  $("taskMenu").classList.add("hidden");
  $("taskSearch").setAttribute("aria-expanded", "false");
}

function onMenuKey(e) {
  const open = !$("taskMenu").classList.contains("hidden");
  if (e.key === "Escape" && open) {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    return;
  }
  if (!open || !state.menuItems.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = state.menuItems.length;
    state.menuIndex = (state.menuIndex + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    const items = $("taskMenu").children;
    for (let i = 0; i < items.length; i++) items[i].setAttribute("aria-selected", String(i === state.menuIndex));
    items[state.menuIndex].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    selectTask(state.menuItems[state.menuIndex].id);
    closeMenu();
  }
}

// ---------- "type it" ----------

async function fillFromText() {
  const text = $("say").value.trim();
  if (!text) return $("say").focus();
  if (!state.tasks.length) return showMsg("warn", "Your tasks haven't loaded yet. Try Refresh tasks.");

  const btn = $("fillBtn");
  btn.disabled = true;
  btn.replaceChildren(el("span", { class: "spinner" }), " Reading…");
  hideMsg();
  let drafts;
  try {
    if (state.settings.geminiKey) {
      try {
        const { aiParse } = await import("./src/ai.js");
        drafts = await aiParse(text, state.tasks, isoDate(), state.settings.geminiKey);
      } catch (err) {
        drafts = localParse(text, state.tasks, isoDate());
        showMsg("warn", `Gemini wasn't reachable (${err.message}). Used on-device matching instead.`);
      }
    } else {
      drafts = localParse(text, state.tasks, isoDate());
    }
  } finally {
    btn.disabled = false;
    btn.replaceChildren("Fill form ", el("kbd", {}, "⌘↵"));
  }
  if (!drafts.length) return showMsg("warn", "Couldn't find any hours in that. Try “2h on …”.");
  state.drafts = drafts;
  state.draftIndex = 0;
  loadDraft();
}

function loadDraft() {
  const d = state.drafts[state.draftIndex];
  const many = state.drafts.length > 1;
  $("draftNav").classList.toggle("hidden", !many);
  if (many) $("draftLabel").textContent = `Entry ${state.draftIndex + 1} of ${state.drafts.length}: check it, then queue it`;

  state.billingTouched = d.billable !== null;
  $("project").value = "";
  selectTask(d.taskId);
  if (d.billable !== null) setBilling(d.billable, false);
  $("hours").value = d.minutes ? toHHMM(d.minutes).replace(/^0(\d)/, "$1") : "";
  setDate(d.date);
  $("notes").value = d.notes;

  const suggestions = $("suggestions");
  const alternatives = d.candidates.filter((id) => id !== d.taskId && state.byId.has(id)).slice(0, 3);
  if (!d.taskId || !d.confident) {
    suggestions.replaceChildren(
      el("span", { class: "small muted" }, d.taskId ? "Best guess. Or:" : "Which task?"),
      ...alternatives.map((id) => {
        const chip = el("button", { class: "chip", type: "button", title: state.byId.get(id).projectName }, state.byId.get(id).name);
        chip.onclick = () => selectTask(id);
        return chip;
      }),
    );
    suggestions.classList.toggle("hidden", !alternatives.length && Boolean(d.taskId));
    if (!d.taskId) $("taskSearch").focus();
  } else {
    suggestions.classList.add("hidden");
  }
  if (!d.minutes) $("hours").classList.add("invalid");
  saveDraft();
}

function nextDraft() {
  if (state.draftIndex + 1 < state.drafts.length) {
    state.draftIndex++;
    loadDraft();
  } else {
    state.drafts = [];
    $("draftNav").classList.add("hidden");
    resetForm();
  }
}

// ---------- queue / log ----------

function readForm() {
  const task = state.byId.get(state.taskId);
  const minutes = parseDuration($("hours").value);
  const date = $("date").value;
  let problem = "";
  if (!task) {
    $("taskCombo").classList.add("invalid");
    problem = "Pick a task.";
  }
  if (!minutes) {
    $("hours").classList.add("invalid");
    problem ||= "Enter the hours, like 1:30 or 1.5.";
  }
  if (!date) problem ||= "Pick a date.";
  if (problem) {
    showMsg("danger", problem);
    return null;
  }
  return {
    taskId: task.id,
    projectId: task.projectId,
    taskName: task.name,
    taskKey: task.key,
    projectName: task.projectName,
    date,
    minutes,
    billable: state.billable,
    notes: $("notes").value.trim(),
  };
}

async function queueEntry() {
  const entry = readForm();
  if (!entry) return;
  if (state.editingId) {
    await updateQueued(state.editingId, entry);
    state.editingId = null;
    $("queueBtn").textContent = "Add to queue";
    showMsg("ok", `Updated: ${humanDuration(entry.minutes)} on ${entry.taskName}.`);
  } else {
    await enqueue([entry]);
    showMsg("ok", `Queued ${humanDuration(entry.minutes)} on ${entry.taskName}.`);
  }
  afterSave();
}

async function logNow() {
  const entry = readForm();
  if (!entry) return;
  const btn = $("logNowBtn");
  btn.disabled = true;
  btn.replaceChildren(el("span", { class: "spinner" }), " Sending…");
  try {
    const res = await chrome.runtime.sendMessage({ type: "send-now", entry });
    if (!res?.ok) throw new Error(res?.error || "No answer from the extension.");
    if (state.editingId) {
      await removeQueued(state.editingId);
      state.editingId = null;
      $("queueBtn").textContent = "Add to queue";
    }
    showMsg("ok", `Logged ${humanDuration(entry.minutes)} on ${entry.taskName} in Zoho.`);
    afterSave();
  } catch (err) {
    showMsg("danger", `Zoho didn't accept it: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Log now";
  }
}

function afterSave() {
  if (state.drafts.length > 1 && state.draftIndex + 1 < state.drafts.length) {
    state.draftIndex++;
    loadDraft();
    return;
  }
  state.drafts = [];
  $("draftNav").classList.add("hidden");
  $("say").value = "";
  resetForm();
}

function resetForm() {
  selectTask("");
  $("hours").value = "";
  $("hours").classList.remove("invalid");
  setDate(isoDate());
  $("notes").value = "";
  state.billingTouched = false;
  setBilling(false, false);
  $("suggestions").classList.add("hidden");
  set("lastDraft", null);
}

function updateHint() {
  const { endOfDay, autoSubmit } = state.settings;
  const at = new Date(`2000-01-01T${endOfDay}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("queueHint").textContent = autoSubmit ? `Queued hours go to Zoho automatically at ${at}.` : `At ${at} you'll get a reminder to send queued hours.`;
}

// ---------- draft persistence (the popup closes whenever you click away) ----------

let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    set("lastDraft", {
      say: $("say").value,
      projectId: $("project").value,
      taskId: state.taskId,
      hours: $("hours").value,
      date: $("date").value,
      billable: state.billable,
      billingTouched: state.billingTouched,
      notes: $("notes").value,
      editingId: state.editingId,
      savedAt: Date.now(),
    });
  }, 200);
}

async function restoreDraft() {
  const d = await get("lastDraft");
  if (!d || Date.now() - d.savedAt > 12 * 60 * 60 * 1000) return;
  $("say").value = d.say || "";
  $("project").value = d.projectId || "";
  if (d.taskId && state.byId.has(d.taskId)) selectTask(d.taskId);
  $("hours").value = d.hours || "";
  if (d.date) setDate(d.date);
  state.billingTouched = d.billingTouched;
  setBilling(d.billable, false);
  $("notes").value = d.notes || "";
  if (d.editingId && (await get("queue")).some((e) => e.id === d.editingId)) {
    state.editingId = d.editingId;
    $("queueBtn").textContent = "Save changes";
  }
}

// ---------- queue + sent lists ----------

function renderQueue(queue) {
  const count = $("queueCount");
  count.textContent = String(queue.length);
  count.classList.toggle("hidden", !queue.length);
  count.classList.toggle("danger", queue.some((e) => e.error));

  const list = $("queueList");
  $("queueFooter").classList.toggle("hidden", !queue.length);
  if (!queue.length) {
    list.replaceChildren(emptyState("☕", "Nothing queued. Entries you add wait here until the end of the day."));
    return;
  }
  $("queueTotal").textContent = `${summarize(queue)} waiting`;
  $("sendAllBtn").onclick = () => sendQueued();
  list.replaceChildren(
    ...groupByDate(queue).map(([date, entries]) =>
      dayGroup(date, entries, (e) => {
        const card = entryCard(e);
        if (e.error) card.append(el("div", { class: "err" }, `Not sent: ${e.error}`));
        const ops = el("div", { class: "ops" });
        const edit = el("button", { class: "btn sm ghost" }, "Edit");
        edit.onclick = () => editQueued(e);
        const send = el("button", { class: "btn sm ghost" }, "Send now");
        send.onclick = () => sendQueued([e.id]);
        const del = el("button", { class: "btn sm ghost danger" }, "Delete");
        del.onclick = () => removeQueued(e.id);
        ops.append(edit, send, del);
        card.append(ops);
        return card;
      }),
    ),
  );
}

// ---------- todos ----------

function wireTodos() {
  $("todoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("todoText").value.trim();
    if (!text) return $("todoText").focus();
    await addTodo(text, $("todoTask").value);
    $("todoText").value = "";
    $("todoTask").value = "";
    $("todoText").focus();
  });
  $("clearDoneBtn").onclick = () => clearDone();
}

function fillTodoTaskSelect(projects) {
  const select = $("todoTask");
  const current = select.value;
  select.replaceChildren(
    new Option("No Zoho task linked", ""),
    ...projects.map(([id, name]) => {
      const group = document.createElement("optgroup");
      group.label = name;
      group.append(...state.tasks.filter((t) => t.projectId === id).map((t) => new Option(t.name, t.id)));
      return group;
    }),
  );
  select.value = state.byId.has(current) ? current : "";
}

function renderTodos(todos) {
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const count = $("todoCount");
  count.textContent = String(open.length);
  count.classList.toggle("hidden", !open.length);

  $("todoList").replaceChildren(...(open.length ? open.map(todoRow) : [emptyState("✅", done.length ? "All done. Nice." : "No todos yet. Add one above.")]));
  $("doneBlock").classList.toggle("hidden", !done.length);
  $("doneLabel").textContent = `Done (${done.length})`;
  $("doneList").replaceChildren(...done.map(todoRow));
}

function todoRow(todo) {
  const row = el("div", { class: `todo${todo.done ? " done" : ""}` });

  const box = el("button", { class: "check", type: "button", role: "checkbox", "aria-checked": String(todo.done), "aria-label": todo.done ? "Mark as not done" : "Mark as done" }, todo.done ? "✓" : "");
  box.onclick = () => toggleTodo(todo.id);

  const body = el("div", { class: "todo-body" });
  const text = el("div", { class: "todo-text", title: "Double-click to edit" }, todo.text);
  text.ondblclick = () => editTodoText(todo, text);
  body.append(text);
  const task = state.byId.get(todo.taskId);
  if (todo.taskId) body.append(el("div", { class: "todo-task" }, task ? `${task.key ? task.key + " · " : ""}${task.name}` : "Linked task is closed in Zoho"));

  const ops = el("div", { class: "todo-ops" });
  if (!todo.done) {
    const log = el("button", { class: "btn sm", type: "button", title: "Log time for this" }, "⏱ Log");
    log.onclick = () => logFromTodo(todo);
    ops.append(log);
  }
  const del = el("button", { class: "icon-x", type: "button", "aria-label": "Delete todo", title: "Delete" }, "✕");
  del.onclick = () => removeTodo(todo.id);
  ops.append(del);

  row.append(box, body, ops);
  return row;
}

function editTodoText(todo, node) {
  const input = el("input", { type: "text", class: "todo-edit", maxlength: "300" });
  input.value = todo.text;
  let finished = false;
  const finish = async (keep) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (keep && value && value !== todo.text) await updateTodo(todo.id, { text: value });
    else renderTodos(await get("todos"));
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  node.replaceWith(input);
  input.focus();
  input.select();
}

function logFromTodo(todo) {
  state.editingId = null;
  state.drafts = [];
  $("draftNav").classList.add("hidden");
  $("queueBtn").textContent = "Add to queue";
  $("project").value = "";
  selectTask(state.byId.has(todo.taskId) ? todo.taskId : "");
  $("notes").value = todo.text;
  setDate(isoDate());
  selectTab("log");
  (state.taskId ? $("hours") : $("taskSearch")).focus();
  saveDraft();
}

function editQueued(e) {
  state.editingId = e.id;
  state.drafts = [];
  $("draftNav").classList.add("hidden");
  $("project").value = "";
  selectTask(e.taskId);
  $("hours").value = toHHMM(e.minutes).replace(/^0(\d)/, "$1");
  setDate(e.date);
  state.billingTouched = true;
  setBilling(e.billable, false);
  $("notes").value = e.notes;
  $("queueBtn").textContent = "Save changes";
  selectTab("log");
  if (!state.byId.has(e.taskId)) showMsg("warn", "That task is no longer open in Zoho. Pick another one.");
  saveDraft();
}

async function sendQueued(ids) {
  const btn = $("sendAllBtn");
  btn.disabled = true;
  btn.replaceChildren(el("span", { class: "spinner" }), " Sending…");
  try {
    const res = await chrome.runtime.sendMessage({ type: "send-queue", ids });
    if (!res?.ok) throw new Error(res?.error || "No answer from the extension.");
    if (res.failed.length) showMsg("danger", `${res.sent.length} sent, ${res.failed.length} failed. See the Queue tab.`);
    else if (res.sent.length) showMsg("ok", `Sent ${summarize(res.sent)} to Zoho.`);
  } catch (err) {
    showMsg("danger", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Send all now";
  }
}

function renderSent(history) {
  const list = $("sentList");
  if (!history.length) {
    list.replaceChildren(emptyState("⚡", "Nothing sent yet. Your logged hours show up here."));
    return;
  }
  list.replaceChildren(...groupByDate(history.slice(0, 80)).map(([date, entries]) => dayGroup(date, entries, entryCard)));
}

function renderToday() {
  Promise.all([get("history"), get("queue")]).then(([history, queue]) => {
    const today = isoDate();
    const sent = history.filter((e) => e.date === today).reduce((s, e) => s + e.minutes, 0);
    const queued = queue.filter((e) => e.date === today).reduce((s, e) => s + e.minutes, 0);
    const pill = $("todayTotal");
    const total = sent + queued;
    pill.textContent = `Today ${humanDuration(total)}${total >= FULL_DAY ? " ✅" : ""}`;
    pill.title = `${humanDuration(sent)} sent to Zoho, ${humanDuration(queued)} queued`;
    if (total >= FULL_DAY) celebrate(today);
  });
}

const FULL_DAY = 8 * 60;
const CHEERS = [
  ["🎉 8 hours. Done.", "Timesheet complete. Close the laptop. Touch grass."],
  ["🏆 Full day logged!", "Your timesheet is perfect. Your manager is quietly proud."],
  ["🚀 8 hours in the bag", "You've officially out-logged the timesheet fairy."],
  ["🥳 Timesheet: 100%", "Nothing left to log. Treat yourself to a snack."],
];

/** Confetti plus a pop-up, once per day, the first time today's hours reach 8. */
async function celebrate(today) {
  if ((await get("celebrated")) === today) return;
  await set("celebrated", today);
  const [title, text] = CHEERS[Math.floor(Math.random() * CHEERS.length)];
  const cheer = el("div", { class: "cheer" }, el("b", {}, title), el("span", {}, text));
  const remove = () => cheer.remove();
  cheer.onclick = remove;
  document.body.append(cheer);
  setTimeout(remove, 5000);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#ffd60a", "#7cc6fe", "#8ff0a4", "#ff8fab", "#ffb347"];
  for (let i = 0; i < 50; i++) {
    const c = el("i", { class: "confetti" });
    c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.8}s`;
    document.body.append(c);
    setTimeout(() => c.remove(), 3500);
  }
}

function groupByDate(entries) {
  const groups = new Map();
  for (const e of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  return [...groups.entries()];
}

function dayGroup(date, entries, render) {
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const head = el("div", { class: "day-head" }, el("span", {}, humanDate(date)), el("span", {}, humanDuration(total)));
  return el("div", {}, head, ...entries.map(render));
}

function entryCard(e) {
  const card = el("div", { class: "entry" });
  card.append(
    el("div", { class: "title" }, e.taskName),
    el(
      "div",
      { class: "meta" },
      el("span", { class: "dur" }, humanDuration(e.minutes)),
      el("span", {}, e.projectName),
      el("span", { class: `pill ${e.billable ? "ok" : ""}` }, e.billable ? "Billable" : "Non-billable"),
    ),
  );
  if (e.notes) card.append(el("div", { class: "notes" }, e.notes));
  return card;
}

// ---------- helpers ----------

function showMsg(kind, text) {
  const box = $("formMsg");
  box.className = `banner ${kind}`;
  box.textContent = text;
  if (kind === "ok") setTimeout(() => box.textContent === text && hideMsg(), 4000);
}

/** Drops a validation error once the user starts fixing it. */
function clearProblem() {
  if ($("formMsg").classList.contains("danger")) hideMsg();
}

function hideMsg() {
  $("formMsg").className = "banner hidden";
}

function emptyState(emoji, text) {
  return el("div", { class: "empty-state" }, el("span", { class: "big" }, emoji), text);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

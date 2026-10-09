// A personal todo list, stored only in this browser. A todo can point at a Zoho task
// so it can be turned into a time entry in one click.

import { get, set } from "./storage.js";

const DONE_LIMIT = 100;

async function save(todos) {
  // Keep every open todo, but only the most recent finished ones.
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt).slice(0, DONE_LIMIT);
  await set("todos", [...open, ...done]);
}

export async function addTodo(text, taskId = "") {
  const todos = await get("todos");
  todos.unshift({ id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`, text, taskId, done: false, createdAt: Date.now(), doneAt: 0 });
  await save(todos);
}

export async function updateTodo(id, patch) {
  const todos = await get("todos");
  await save(todos.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}

export async function toggleTodo(id) {
  const todos = await get("todos");
  await save(todos.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? 0 : Date.now() } : t)));
}

export async function removeTodo(id) {
  await save((await get("todos")).filter((t) => t.id !== id));
}

export async function clearDone() {
  await save((await get("todos")).filter((t) => !t.done));
}

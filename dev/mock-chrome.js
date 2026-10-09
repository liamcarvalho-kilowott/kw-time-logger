// Dev-only: a fake `chrome` API with sample data so popup.html / options.html render in a normal browser tab.
(() => {
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const tasks = [
    { id: "1", key: "AC-T12", name: "Checkout payment bug", projectId: "p1", projectName: "Acme Store", tasklist: "Sprint 4", billable: true, logged: "06:30" },
    { id: "2", key: "AC-T13", name: "Homepage redesign", projectId: "p1", projectName: "Acme Store", tasklist: "Design", billable: true, logged: "" },
    { id: "3", key: "HR-T11", name: "1 on 1 (Intra Team)", projectId: "p2", projectName: "HR / Team Building", tasklist: "HR General", billable: false, logged: "12:00" },
    { id: "4", key: "NA-T7", name: "Weekly budget optimization", projectId: "p3", projectName: "Northwind Ads", tasklist: "Paid media", billable: true, logged: "" },
    { id: "5", key: "NA-T9", name: "Monthly performance report", projectId: "p3", projectName: "Northwind Ads", tasklist: "Reporting", billable: true, logged: "" },
  ];
  const data = {
    settings: { clientId: "demo", endOfDay: "18:30", autoSubmit: true, geminiKey: "" },
    auth: { accessToken: "x", refreshToken: "y", expiresAt: Date.now() + 3.6e6, accountsServer: "https://accounts.zoho.in" },
    tasks, tasksFetchedAt: Date.now(),
    me: { name: "Demo User", zpuid: "123" },
    todos: [
      { id: "t1", text: "Reply to client about checkout copy", taskId: "1", done: false, createdAt: Date.now(), doneAt: 0 },
      { id: "t2", text: "Prep slides for Monday standup", taskId: "", done: false, createdAt: Date.now(), doneAt: 0 },
      { id: "t3", text: "Check last week's ad spend", taskId: "4", done: true, createdAt: Date.now(), doneAt: Date.now() },
    ],
    queue: [
      { id: "q1", taskId: "4", projectId: "p3", taskName: "Weekly budget optimization", projectName: "Northwind Ads", date: iso(today), minutes: 120, billable: true, notes: "Shifted budget to top 3 campaigns", error: "" },
    ],
    history: [
      { id: "h1", taskId: "1", projectId: "p1", taskName: "Checkout payment bug", projectName: "Acme Store", date: iso(today), minutes: 90, billable: true, notes: "Fixed retry on declined cards", sentAt: Date.now() },
      { id: "h2", taskId: "3", projectId: "p2", taskName: "1 on 1 (Intra Team)", projectName: "HR / Team Building", date: iso(yest), minutes: 30, billable: false, notes: "", sentAt: Date.now() },
    ],
  };
  const listeners = [];
  window.chrome = {
    storage: {
      local: {
        get: async (k) => ({ [k]: structuredClone(data[k]) }),
        set: async (obj) => { Object.assign(data, structuredClone(obj)); const ch = Object.fromEntries(Object.keys(obj).map((k) => [k, { newValue: obj[k] }])); listeners.forEach((l) => l(ch, "local")); },
        remove: async (ks) => ks.forEach((k) => delete data[k]),
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    permissions: { request: async () => true },
    runtime: {
      getManifest: () => ({ host_permissions: [] }),
      openOptionsPage: () => (location.href = "/options.html"),
      sendMessage: async (msg) => {
        await new Promise((r) => setTimeout(r, 400));
        if (msg.type === "send-now") { data.history.unshift({ ...msg.entry, id: "n" + Date.now(), sentAt: Date.now() }); chrome.storage.local.set({ history: data.history }); return { ok: true }; }
        const sent = data.queue.filter((e) => !msg.ids || msg.ids.includes(e.id));
        await chrome.storage.local.set({ history: [...sent, ...data.history], queue: data.queue.filter((e) => !sent.includes(e)) });
        return { ok: true, sent, failed: [] };
      },
      getURL: (p) => "/" + p,
    },
    identity: { getRedirectURL: () => "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/" },
  };
})();

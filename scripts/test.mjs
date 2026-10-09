const base = new URL("..", import.meta.url).href.replace(/\/$/, "");
const { parseDuration, findDate, toZohoDate, toHHMM } = await import(base + "/src/time.js");
const { localParse } = await import(base + "/src/match.js");
const eq = (a, b, label) => { const ok = JSON.stringify(a) === JSON.stringify(b); console.log(ok ? "ok  " : "FAIL", label, ok ? "" : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
for (const [i, w] of [["2",120],["2.5",150],["2:30",150],["2h30",150],["2h 30m",150],["90m",90],["1 hr 15 min",75],["0:30",30],["abc",null],["25",null]]) eq(parseDuration(i), w, `parseDuration(${i})`);
const today = "2026-10-08"; // Thursday
eq(findDate("did it yesterday", today), "2026-10-07", "yesterday");
eq(findDate("on monday", today), "2026-10-05", "monday");
eq(findDate("thursday", today), "2026-10-08", "thursday=today");
eq(findDate("sat on it", today), null, "sat is not saturday");
eq(toZohoDate("2026-10-08"), "10-08-2026", "zoho date");
eq(toHHMM(150), "02:30", "hhmm");
const tasks = [
  { id: "1", key: "SB1-T10", name: "Checkout payment bug", projectName: "Acme Store", tasklist: "Sprint 4" },
  { id: "2", key: "SB1-T11", name: "Homepage redesign", projectName: "Acme Store", tasklist: "Design" },
  { id: "3", key: "HR-T1", name: "1 on 1 (Intra Team)", projectName: "HR / Team Building", tasklist: "HR General" },
  { id: "4", key: "NI-T7", name: "Weekly budget optimization", projectName: "Nordic Ads", tasklist: "Paid media" },
];
let r = localParse("2h on the checkout bug - fixed payment retry", tasks, today);
eq([r[0].taskId, r[0].minutes, r[0].notes, r[0].date], ["1", 120, "fixed payment retry", today], "single entry");
r = localParse("1.5h homepage redesign yesterday and 30m team 1 on 1", tasks, today);
eq(r.map((e) => [e.taskId, e.minutes, e.date]), [["2", 90, "2026-10-07"], ["3", 30, today]], "two entries");
r = localParse("45 min SB1-T11 non billable", tasks, today);
eq([r[0].taskId, r[0].minutes, r[0].billable, r[0].confident], ["2", 45, false, true], "task key + non billable");
r = localParse("3h budget optimisation for nordic", tasks, today);
eq([r[0].taskId, r[0].minutes], ["4", 180], "fuzzy prefix match");

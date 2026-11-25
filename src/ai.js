// "Type it" with Gemini: turns a sentence into time entries matched against your open Zoho tasks.

const MODEL = "gemini-2.5-flash";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    entries: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          task_id: { type: "STRING", description: "id of the matching task from the list, or empty string if none fits" },
          minutes: { type: "INTEGER", description: "duration in minutes as stated; if not stated, your estimate from the effort described, in 15-minute steps" },
          stated: { type: "BOOLEAN", description: "true only if the person gave the time for this entry" },
          date: { type: "STRING", description: "YYYY-MM-DD" },
          notes: { type: "STRING", description: "short timesheet comment describing the work, or empty string" },
          billable: { type: "STRING", enum: ["billable", "non_billable", "task_default"] },
          confident: { type: "BOOLEAN", description: "false when the task match is a guess" },
        },
        required: ["task_id", "minutes", "stated", "date", "notes", "billable", "confident"],
      },
    },
  },
  required: ["entries"],
};

const INSTRUCTIONS = `You turn what someone says about their work into Zoho Projects time log entries.

- Pick the task from the list that best matches what they describe. Use the project, task list and task names. If nothing fits, leave task_id empty and set confident to false.
- One entry per piece of work. "2h on X and 1h on Y" is two entries. An end-of-day summary usually covers several tasks: split it into one entry per task, and merge pieces of work that belong to the same task.
- A working day holds 8 hours. When no time is given, estimate it from how much work is described, so the day adds up to 8 hours including what is already logged. Never go over 8 hours for a day.
- Resolve relative dates ("yesterday", "monday") against today's date. Default to today.
- notes: a brief, professional timesheet comment based on what they said they did. Don't repeat the task name. Empty if they gave no detail.
- billable: only say billable / non_billable if they said so; otherwise task_default.`;

async function callGemini(apiKey, body) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || cand?.finishReason === "SAFETY") throw new Error("Gemini couldn't process that. Fill in the form instead.");
  if (cand?.finishReason === "MAX_TOKENS") throw new Error("That was too long to read in one go. Try fewer entries.");
  return cand;
}

/** Turns a short note into a fuller timesheet comment, using the task for context. */
export async function aiExpand(note, task, apiKey) {
  const cand = await callGemini(apiKey, {
    systemInstruction: { parts: [{ text: "You write timesheet comments for Zoho Projects. Expand the person's short note into a clear, professional comment of 2-4 sentences (under 400 characters) in the first person, past tense. Only elaborate on what the note plausibly implies for this task; never invent specific numbers, names, tools or outcomes. Reply with the comment text only." }] },
    contents: [{ role: "user", parts: [{ text: `Task: ${task ? `${task.projectName} / ${task.name}` : "(not chosen)"}
Note: ${note}` }] }],
    generationConfig: { maxOutputTokens: 1000 },
  });
  const out = cand?.content?.parts?.map((p) => p.text).join("").trim();
  if (!out) throw new Error("Gemini returned nothing.");
  return out;
}

export async function aiParse(text, tasks, today, apiKey, logged = {}) {
  const taskList = tasks.map((t) => `${t.id} | ${t.key} | ${t.projectName} | ${t.tasklist} | ${t.name}`).join("\n");
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });

  const cand = await callGemini(apiKey, {
    systemInstruction: { parts: [{ text: `${INSTRUCTIONS}

Open tasks (id | key | project | task list | task):
${taskList}` }] },
    contents: [{ role: "user", parts: [{ text: `Today is ${weekday}, ${today}.
Already logged: ${Object.entries(logged).map(([d, m]) => `${d}: ${m} min`).join(", ") || "nothing"}.

${text}` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 8000 },
  });
  const { entries } = JSON.parse(cand?.content?.parts?.[0]?.text ?? '{"entries":[]}');

  const known = new Set(tasks.map((t) => t.id));
  return entries.map((e) => ({
    taskId: known.has(e.task_id) ? e.task_id : "",
    minutes: e.minutes > 0 ? e.minutes : null,
    stated: Boolean(e.stated && e.minutes > 0),
    date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : today,
    notes: e.notes,
    billable: e.billable === "task_default" ? null : e.billable === "billable",
    confident: e.confident && known.has(e.task_id),
    candidates: [],
  }));
}

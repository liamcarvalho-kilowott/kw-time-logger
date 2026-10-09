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
          minutes: { type: "INTEGER", description: "duration in minutes, 0 if not stated" },
          date: { type: "STRING", description: "YYYY-MM-DD" },
          notes: { type: "STRING", description: "short timesheet comment describing the work, or empty string" },
          billable: { type: "STRING", enum: ["billable", "non_billable", "task_default"] },
          confident: { type: "BOOLEAN", description: "false when the task match is a guess" },
        },
        required: ["task_id", "minutes", "date", "notes", "billable", "confident"],
      },
    },
  },
  required: ["entries"],
};

const INSTRUCTIONS = `You turn what someone says about their work into Zoho Projects time log entries.

- Pick the task from the list that best matches what they describe. Use the project, task list and task names. If nothing fits, leave task_id empty and set confident to false.
- One entry per piece of work. "2h on X and 1h on Y" is two entries.
- Resolve relative dates ("yesterday", "monday") against today's date. Default to today.
- notes: a brief, professional timesheet comment based on what they said they did. Don't repeat the task name. Empty if they gave no detail.
- billable: only say billable / non_billable if they said so; otherwise task_default.`;

export async function aiParse(text, tasks, today, apiKey) {
  const taskList = tasks.map((t) => `${t.id} | ${t.key} | ${t.projectName} | ${t.tasklist} | ${t.name}`).join("\n");
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${INSTRUCTIONS}\n\nOpen tasks (id | key | project | task list | task):\n${taskList}` }] },
      contents: [{ role: "user", parts: [{ text: `Today is ${weekday}, ${today}.\n\n${text}` }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 8000 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || cand?.finishReason === "SAFETY") throw new Error("Gemini couldn't process that. Fill in the form instead.");
  if (cand?.finishReason === "MAX_TOKENS") throw new Error("That was too long to read in one go. Try fewer entries.");
  const { entries } = JSON.parse(cand?.content?.parts?.[0]?.text ?? '{"entries":[]}');

  const known = new Set(tasks.map((t) => t.id));
  return entries.map((e) => ({
    taskId: known.has(e.task_id) ? e.task_id : "",
    minutes: e.minutes > 0 ? e.minutes : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : today,
    notes: e.notes,
    billable: e.billable === "task_default" ? null : e.billable === "billable",
    confident: e.confident && known.has(e.task_id),
    candidates: [],
  }));
}

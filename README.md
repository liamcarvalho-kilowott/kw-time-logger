# KW Time Logger ⚡

A Chrome extension for logging hours to your Zoho Projects tasks without opening Zoho.

- **Form:** pick a project, then one of *your* open tasks. Enter hours, date, billable or not, and a comment.
- **Type it:** for example `2h on the checkout bug - fixed payment retry and 30m team 1 on 1 yesterday`. This becomes two entries matched to your tasks. Matching happens on your device by default. Add an Anthropic API key to have Claude do the matching instead.
- **Queue:** entries wait until your end-of-day time (default 6:30 PM). Then they're either sent to Zoho automatically or you get a reminder to send them. **Log now** skips the queue.
- **Todo:** a personal checklist. Optionally link a todo to one of your Zoho tasks. **⏱ Log** on a todo opens the Log tab with that task selected and the todo text as the comment, so you only add the hours. Double-click a todo to edit it. Todos stay in this browser and are never sent to Zoho.
- **Sent:** shows what went to Zoho, grouped by day. The toolbar badge shows how many entries are queued, and turns red if one failed.

Open it with the toolbar icon or **⌘⇧L** (Ctrl+Shift+L on Windows).

## Install (about 2 minutes)

1. Go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `zoho-time-logger` folder. The settings page opens.
3. The settings page is a plain-language, step-by-step guide with copy buttons and a troubleshooting section, so you can send it to teammates as is. In short:
   1. Pick your Zoho region (India = `zoho.in`).
   2. In the Zoho API Console, create a **Server-based Application**. Paste in the redirect URI shown on the settings page. Then copy the Client ID and Secret back into the settings page.
   3. Click **Connect Zoho** and approve the access request.
4. Pin the extension (puzzle icon, then the pin) so it's one click away.

> Keep the folder where it is. Chrome builds the extension's ID, and therefore the redirect URI, from the folder path. If you move the folder, update the redirect URI in Zoho.

## How it talks to Zoho

| What | Zoho API |
| --- | --- |
| Sign in | OAuth 2.0 code flow through `chrome.identity`; the refresh token is stored in `chrome.storage.local` |
| Your account | `GET accounts.zoho.*/oauth/user/info` |
| Portals | `GET /api/v3/portals` |
| Your open tasks | `GET /api/v3/portal/{portal}/tasks` filtered to open tasks and to you as owner |
| Log hours | `POST /restapi/portal/{portal}/projects/{project}/tasks/{task}/logs/` with `date` (MM-DD-YYYY), `hours` (hh:mm), `bill_status`, `notes` |

The extension requests these scopes: `ZohoProjects.portals.READ`, `ZohoProjects.projects.READ`, `ZohoProjects.tasks.READ`, `ZohoProjects.timesheets.CREATE`, `ZohoProjects.timesheets.READ` and `AaaServer.profile.Read`.

Your tasks are cached for 30 minutes. Use **Refresh tasks** in the popup to reload them right away.

## Privacy

- Everything is stored only in this browser's extension storage: settings, tokens, queue and history. There is no server.
- Your Zoho client secret is stored there too. That's fine for a personal extension, but don't publish this build to the Chrome Web Store as it is.
- With an Anthropic key set, each **Fill form** sends Anthropic your sentence plus the names of your open tasks. Without a key, nothing leaves your machine except your calls to Zoho.

## Files

```
manifest.json      MV3 manifest
background.js      end-of-day alarm, notifications, badge, sends entries on the popup's behalf
popup.html/js/css  the popup
options.html/js    setup and settings
styles.css         shared neubrutalism styles (light and dark)
fonts/             Space Grotesk + Space Mono, bundled so nothing loads from the web
src/zoho.js        OAuth plus Zoho Projects calls
src/logbook.js     queue and history
src/todos.js       todo list
src/match.js       on-device sentence → entries matcher
src/ai.js          Claude matcher (claude-opus-5-5, structured output, server-side refusal fallback)
src/time.js        duration and date helpers
vendor/            bundled @anthropic-ai/sdk (rebuild: npm install && npm run build)
dev/               mock chrome API and preview server (not part of the extension)
```

To preview the popup outside Chrome with sample data, run `node dev/serve.mjs`, then open http://localhost:5178.

## Ideas for v2

- Activity suggestions: track time spent per site or tab (GitHub repo, Figma file, Google Doc). At the end of the day, suggest entries you can approve with one tap.
- Show the hours you've already logged in Zoho today, read from Zoho's time logs API, next to the local total.
- A start/stop timer per task.
- A desktop menu-bar version (Tauri) with a global hotkey that reuses `src/`.

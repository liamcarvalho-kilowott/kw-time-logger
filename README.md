# KW Time Logger ⚡

A Chrome extension for logging hours to your Zoho Projects tasks without opening Zoho.

- **Form:** pick a project, then one of *your* open tasks. Enter hours, date, billable or not, and a comment.
- **Type it:** for example `2h on the checkout bug - fixed payment retry and 30m team 1 on 1 yesterday`. This becomes two entries matched to your tasks. Matching happens on your device by default. Add a free Gemini API key to have Gemini do the matching instead.
- **Queue:** entries wait until your end-of-day time (default 6:30 PM). Then they're either sent to Zoho automatically or you get a reminder to send them. **Log now** skips the queue.
- **Todo:** a personal checklist. Optionally link a todo to one of your Zoho tasks. **⏱ Log** on a todo opens the Log tab with that task selected and the todo text as the comment, so you only add the hours. Double-click a todo to edit it. Todos stay in this browser and are never sent to Zoho.
- **Assign (managers):** create a task in any project and assign it to a project member, with task list, description, due date, priority and estimated hours. Zoho decides who is allowed, so non-managers just see Zoho's error. After updating from an older version, click **Disconnect** then **Connect Zoho** once so Zoho can grant the new permissions.
- **Sent:** shows what went to Zoho, grouped by day. The toolbar badge shows how many entries are queued, and turns red if one failed.

Open it with the toolbar icon or **⌘⇧L** (Ctrl+Shift+L on Windows).

## Install (the dumbest way possible)

### Part 1: Get the files

1. Open the [latest release](https://github.com/liamcarvalho-kilowott/kw-time-logger/releases/latest). Sign in to GitHub if it asks. If you see "404", ask to be added to the repo.
2. Scroll down to **Assets** and click **kw-time-logger.zip**. It lands in your **Downloads** folder.
3. Open your **Downloads** folder. Right-click the ZIP and choose **Extract All...**. Change the destination to a permanent place like `Documents\kw-time-logger`, then click **Extract**.
4. The folder you extracted into is your extension folder. It has `manifest.json` right inside it.
5. Do not rename or move that folder after this. Chrome needs it to stay there.

### Part 2: Plug the folder into Chrome

1. Open Chrome. Type `chrome://extensions` in the address bar and press Enter.
2. Turn on **Developer mode**. It is the switch at the top right.
3. Click **Load unpacked** (top left).
4. Pick the extension folder from Part 1, the one with `manifest.json` in it. Click **Select Folder**.
5. **KW Time Logger** now shows up in your list, and the settings page opens by itself.
6. Click the puzzle-piece icon at the top right of Chrome, then click the **pin** next to KW Time Logger so it is always one click away.

### Part 3: Connect Zoho

The settings page walks you through it with copy buttons. In short:

1. Pick your Zoho region (India = `zoho.in`).
2. In the Zoho API Console, create a **Server-based Application**. Paste in the redirect URI shown on the settings page. Then copy the Client ID and Secret back into the settings page.
3. Click **Connect Zoho** and approve the access request.

### Other browsers

- **Brave and Microsoft Edge:** they are Chrome under the hood, so use the same `kw-time-logger.zip` and the same steps. Open `brave://extensions` or `edge://extensions` instead of `chrome://extensions`.
- **Internet Explorer:** it was retired in 2022 and never supported extensions like this. Use Edge instead.
- **Firefox:** use `kw-time-logger-firefox.zip` from the release, extract it, then open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick the `manifest.json` inside the folder. Firefox forgets temporary add-ons when it closes, so you repeat this each time, unless you sign the add-on for free at addons.mozilla.org (choose "On your own"). When you click **Connect Zoho**, allow the permission request that Firefox shows. The Zoho redirect URI on the settings page is different from Chrome's, so add it in the Zoho API Console. In Firefox the end-of-day notification has no Send button; click it to open the queue.

### Updating later

Download the new ZIP from the latest release, extract it, and copy the files **over the old folder** (same folder, same place). Then go to `chrome://extensions` and click the round **reload** arrow on KW Time Logger.

> Chrome builds the extension's ID, and therefore the Zoho redirect URI, from the folder path. If you move the folder, update the redirect URI in Zoho.

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
- With a Gemini key set, each **Fill form** sends Google your sentence plus the names of your open tasks. Without a key, nothing leaves your machine except your calls to Zoho.

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
src/ai.js          Gemini matcher (gemini-2.5-flash, structured JSON output)
src/time.js        duration and date helpers
dev/               mock chrome API and preview server (not part of the extension)
```

To preview the popup outside Chrome with sample data, run `node dev/serve.mjs`, then open http://localhost:5178.

## Ideas for v2

- Activity suggestions: track time spent per site or tab (GitHub repo, Figma file, Google Doc). At the end of the day, suggest entries you can approve with one tap.
- Show the hours you've already logged in Zoho today, read from Zoho's time logs API, next to the local total.
- A start/stop timer per task.
- A desktop menu-bar version (Tauri) with a global hotkey that reuses `src/`.

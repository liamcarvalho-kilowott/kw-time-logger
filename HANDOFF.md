# KW Time Logger ⚡ — handoff

Everything a new person (or a new Claude Code session) needs to carry on. Start a session in this folder and say: **"Read HANDOFF.md and continue."**

## What this is

A Chrome extension (Manifest V3, plain JavaScript, no framework) that logs hours to **Zoho Projects** tasks without opening Zoho. Built for personal use at Kilowott; the Zoho portal is on the India data centre (`zoho.in`).

Features built so far:
- **Log tab:** project → task search (only *my* open tasks) → hours, date, billable, comment.
- **⚡ Type it:** write "2h on the checkout bug - fixed retry and 30m 1 on 1 yesterday" → fills the form, one entry at a time. Matches on-device by default (`src/match.js`). With a Gemini key it uses Gemini (`src/ai.js`, `gemini-2.5-flash`, plain `fetch` to the REST API, JSON-schema output; falls back to on-device matching on any error).
- **Queue:** entries wait until an end-of-day time (default 18:30), then auto-send or show a "Send" notification (`background.js`). **Log now** skips the queue. Catches up on next Chrome start if it was closed.
- **Sent** history, **Todo** tab (a todo can link to a Zoho task; ⏱ Log turns it into a time entry).
- Neubrutalist UI (yellow `#ffd60a`, black borders, hard shadows, Space Grotesk/Mono bundled in `fonts/`).
- Settings page = plain-language setup guide for non-technical teammates.

## Run it on a new machine

```bash
git clone <repo-url> zoho-time-logger && cd zoho-time-logger
npm install          # only needed to rebuild vendor/ or run tests; the extension itself has no build step
```

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → pick this folder.
2. The settings page opens. Follow it. **Important:** the redirect URI shown there depends on the extension ID, which depends on the folder path, so on a new laptop it will be **different** from the old one. In the Zoho API Console, edit the client and **add the new redirect URI** (a client can have several), or create a new client.
3. Secrets (Zoho client ID/secret, tokens, Gemini key) are stored in `chrome.storage.local` only. They are not in this repo and have to be entered again on each machine.

Preview the UI without Chrome (fake `chrome` API + sample data): `npm run preview` → http://localhost:5178 (popup) and `/options.html`.
Tests (duration/date parsing and the task matcher): `npm test`.
Rebuild icons: `npm run icons`. (`vendor/` and `npm run build` are the old bundled Anthropic SDK; nothing imports it anymore and it can be deleted.)

## File map

```
manifest.json      MV3 manifest (name "KW Time Logger ⚡", shortcut ⌘⇧L / Ctrl+Shift+L)
background.js      end-of-day alarm, notifications, badge, sends on the popup's behalf
popup.html/js/css  popup (Log / Todo / Queue / Sent)
options.html/js    setup guide + settings
styles.css         shared neubrutalism tokens and components
src/zoho.js        OAuth (chrome.identity) + Zoho Projects calls
src/logbook.js     queue + history
src/match.js       on-device sentence → entries matcher
src/ai.js          Gemini matcher
src/datepicker.js  custom calendar popover for the Date field
src/todos.js       todo list
src/time.js        duration/date helpers
src/storage.js     chrome.storage wrapper + settings defaults + region list
dev/               fake chrome API + preview server (not shipped)
scripts/           icon generator, tests, SDK bundle entry
```

## Zoho facts (checked against Zoho's docs and live reads)

- **Log time:** `POST https://projectsapi.<dc>/restapi/portal/{portal}/projects/{project}/tasks/{task}/logs/` (v1 REST). Form fields: `date` as **MM-DD-YYYY**, `hours` as **hh:mm**, `bill_status` = `Billable` | `Non Billable`, `notes`. Scope `ZohoProjects.timesheets.CREATE`.
- **Read tasks:** v3, `GET /api/v3/portal/{portal}/tasks`, `filter` is a JSON string with `criteria` + `pattern`. Open tasks: `{"field_name":"status","criteria_condition":"all_open","value":["${all_open}"]}`.
- **Gotcha:** filtering by `owner` needs the **Projects user id (ZPUID)**, not the account id (ZUID); the macros `${ME}` / `${CURRENTUSER}` are rejected. `src/zoho.js` discovers the ZPUID on first run by scanning tasks and matching on ZUID/email, then uses the fast filtered path. There's a manual override under Advanced in settings.
- Portals: `GET /api/v3/portals`. The OAuth token endpoint answers a dead refresh token with HTTP 200 + `{"error":"invalid_code"}` (handled).
- Task cache: 30 minutes (`TASK_CACHE_MS`).

## What has NOT been verified yet (do this first)

The popup/options/queue/todo UI and the parsers were tested in the preview with fake data. Not yet run against real services:
1. The real **OAuth sign-in** through `chrome.identity.launchWebAuthFlow`.
2. A real **time log write** to Zoho (confirm it appears in the task's timesheet).
3. The **ZPUID discovery** and owner-filtered task fetch with a real account (response shapes of `/oauth/user/info` and `/api/v3/portals` were written from docs, so field names may need a tweak).
4. The **Gemini path** (`src/ai.js`) with a real key. Written from the REST docs, never run: check the `responseSchema` (uppercase types, no `additionalProperties`) and the model name `gemini-2.5-flash` if it returns a 400.
5. The end-of-day alarm and notifications in real Chrome.
6. The setup guide's wording against Zoho's current API Console screens (written without access to the console).

First real test: connect, then log **one** small entry with **Log now** and check it in Zoho. If Zoho rejects it, the popup shows Zoho's error text.

## Decisions and why

- **Extension first, agent later.** "Watches everything I do" is v2: per-site/tab time tracking that *suggests* entries at the end of the day, never logs without approval (privacy; an all-apps screen watcher would often pick the wrong task).
- **On-device matching by default**, Gemini optional, so it works with no key and nothing leaves the machine besides Zoho calls.
- **Queue + end-of-day** instead of logging instantly, with **Log now** as the escape hatch.
- **No build step** for the extension; the extension uses only `fetch`, no SDK.
- **Secrets only in extension storage.** The client secret sits in the extension, which is fine for a personal build, but **don't publish this build to the Chrome Web Store as-is**.
- **Neubrutalism**, yellow ⚡ branding.

## Added after the first handoff

- **Date picker:** the Date field is a read-only text input (ISO value) with a custom calendar popover (`src/datepicker.js`, styles at the end of `popup.css`).
- **Notifications:** `background.js` now notifies every day at the end-of-day time, even with an empty queue, using random funny messages (`JOKES`). Settings has a test-notification button. Windows can still block them (Settings → System → Notifications, Focus assist).
- **8-hour celebration:** `celebrate()` in `popup.js` shows confetti and a pop-up once per day (`celebrated` storage key) when sent + queued hours for today reach 8.
- **Light mode only:** all dark-mode CSS was removed and `--bg` is white.
- **Distribution:** private repo `liamcarvalho-kilowott/kw-time-logger`; teammates download `kw-time-logger.zip` from the latest GitHub release and use Load unpacked. Releases so far: v0.1.0 to v0.1.2. To release: bump `version` in `manifest.json` and `package.json`, rebuild the ZIP (manifest at the ZIP root; only manifest, JS/HTML/CSS, `src/`, `icons/`, `fonts/`), commit with `git add -f kw-time-logger.zip`, push, then `gh release create`.

## Assign tab (managers)

`src/assign.js` (UI) + `listProjects/listProjectUsers/listTasklists/createTask` at the end of `src/zoho.js`. Uses the v1 REST API: `POST /restapi/portal/{p}/projects/{id}/tasks/` with `name`, `person_responsible` (ZPUID), `description`, `tasklist_id`, `priority`, `start_date`/`end_date` (MM-DD-YYYY), `duration` + `duration_type=hours`. New scopes: `ZohoProjects.tasks.CREATE`, `users.READ`, `tasklists.READ`, so everyone must Disconnect/Connect once. **Never run against real Zoho**: the response shapes and the `duration_type` value are from memory of the docs; tested only with mocked responses. The tab shows for everyone; Zoho's permissions decide who can create.

## Usage analytics (parked)

Not shipped. A working version (daily anonymous ping to a Supabase edge function, with an opt-out) was built and tested but removed from the release. The Supabase project `kw-time-logger-analytics` (ref `tjzmkzwkhclnttmziohv`) with table `kw_daily` and function `kw-ping` still exists. Re-adding the client side means a small `src/ping.js`, a host permission, a settings checkbox and a README privacy line.

## Firefox, Edge, Brave

Edge and Brave (Chromium) run the normal build. Firefox uses `manifest.firefox.json` (background.scripts instead of a service worker, fixed gecko id `kw-time-logger@kilowott.com`, min Firefox 121). Everything else is shared. `python scripts/build-zips.py` makes `kw-time-logger.zip` and `kw-time-logger-firefox.zip`; keep the version in both manifests in sync. Firefox does not grant host permissions at install, so `connect()` in `options.js` requests them; `notify()` in `background.js` falls back to a plain notification because Firefox rejects buttons. **Firefox is untested in a real browser.** Internet Explorer is not supported (it is retired).

## Open questions / next ideas

- v2: activity suggestions from tab/site time; show hours already logged in Zoho today (`GET .../projects/{id}/logs/`); start/stop timer; menu-bar app with a global hotkey reusing `src/`.
- Work-laptop check: confirm company policy allows the Gemini key option (it sends the typed sentence and open task names to Google; free-tier data may be used by Google to improve its products).

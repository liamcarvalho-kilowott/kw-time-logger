// Everything lives in chrome.storage.local, on this machine only.

export const REGIONS = [
  { label: "India (zoho.in)", server: "https://accounts.zoho.in" },
  { label: "United States (zoho.com)", server: "https://accounts.zoho.com" },
  { label: "Europe (zoho.eu)", server: "https://accounts.zoho.eu" },
  { label: "Australia (zoho.com.au)", server: "https://accounts.zoho.com.au" },
  { label: "Japan (zoho.jp)", server: "https://accounts.zoho.jp" },
  { label: "Canada (zohocloud.ca)", server: "https://accounts.zohocloud.ca" },
  { label: "Saudi Arabia (zoho.sa)", server: "https://accounts.zoho.sa" },
  { label: "China (zoho.com.cn)", server: "https://accounts.zoho.com.cn" },
];

const DEFAULT_SETTINGS = {
  accountsServer: "https://accounts.zoho.in",
  clientId: "",
  clientSecret: "",
  portalId: "", // empty = the default portal
  zpuid: "", // Zoho Projects user id; found automatically, can be overridden
  endOfDay: "18:30",
  autoSubmit: true, // false = remind me and wait for approval
  geminiKey: "", // optional; without it, "type it" uses the on-device matcher
};

const DEFAULTS = {
  settings: DEFAULT_SETTINGS,
  auth: null, // { accessToken, refreshToken, expiresAt, accountsServer }
  me: null, // { zuid, zpuid, email, name }
  portal: null, // { id, name, url }
  tasks: [],
  tasksFetchedAt: 0,
  queue: [], // entries waiting for end of day
  history: [], // entries sent to Zoho (newest first, capped)
  lastDraft: null,
  todos: [], // { id, text, taskId, done, createdAt, doneAt }
};

export async function get(key) {
  const found = await chrome.storage.local.get(key);
  return found[key] ?? structuredClone(DEFAULTS[key]);
}

export function set(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await get("settings")) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await set("settings", next);
  return next;
}

export async function signOutLocal() {
  await chrome.storage.local.remove(["auth", "me", "portal", "tasks", "tasksFetchedAt"]);
}

export function onChange(keys, fn) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && keys.some((k) => k in changes)) fn(changes);
  });
}

// Zoho OAuth + the few Zoho Projects calls we need.
// Reads use the v3 API; writing a time log uses the v1 endpoint (POST .../tasks/{id}/logs/).

import { get, set, getSettings, signOutLocal } from "./storage.js";
import { toHHMM, toZohoDate } from "./time.js";

const SCOPES = [
  "ZohoProjects.portals.READ",
  "ZohoProjects.projects.READ",
  "ZohoProjects.tasks.READ",
  "ZohoProjects.timesheets.CREATE",
  "ZohoProjects.timesheets.READ",
  "ZohoProjects.tasks.CREATE", // Assign tab (managers)
  "ZohoProjects.users.READ",
  "ZohoProjects.tasklists.READ",
  "AaaServer.profile.Read",
].join(",");

const OPEN_TASKS = { field_name: "status", criteria_condition: "all_open", value: ["${all_open}"] };
const TASK_CACHE_MS = 30 * 60 * 1000;

export class ZohoError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class NotSignedIn extends ZohoError {
  constructor() {
    super("Not connected to Zoho yet.", 401);
  }
}

export const redirectUri = () => chrome.identity.getRedirectURL();

const projectsHost = (accountsServer) => accountsServer.replace("://accounts.", "://projectsapi.");

// ---------- auth ----------

export async function signIn() {
  const s = await getSettings();
  if (!s.clientId || !s.clientSecret) throw new ZohoError("Add your Zoho client ID and secret first.");
  const state = crypto.randomUUID();
  const url = new URL(`${s.accountsServer}/oauth/v2/auth`);
  url.search = new URLSearchParams({
    scope: SCOPES,
    client_id: s.clientId,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    redirect_uri: redirectUri(),
    state,
  });

  const back = new URL(await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true }));
  const params = back.searchParams;
  if (params.get("error")) throw new ZohoError(`Zoho refused the sign-in: ${params.get("error")}`);
  if (params.get("state") !== state || !params.get("code")) throw new ZohoError("Sign-in was interrupted. Try again.");

  // Zoho tells us which data centre the account really lives in.
  const accountsServer = params.get("accounts-server") || s.accountsServer;
  const tok = await tokenRequest(accountsServer, {
    grant_type: "authorization_code",
    client_id: s.clientId,
    client_secret: s.clientSecret,
    redirect_uri: redirectUri(),
    code: params.get("code"),
  });
  if (!tok.refresh_token) throw new ZohoError("Zoho didn't return a refresh token. Remove the app's access in Zoho and sign in again.");

  await signOutLocal();
  await set("auth", {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + (tok.expires_in - 120) * 1000,
    accountsServer,
  });
  if (accountsServer !== s.accountsServer) await set("settings", { ...s, accountsServer });
}

export async function signOut() {
  const auth = await get("auth");
  if (auth?.refreshToken) {
    // Best effort: revoke on Zoho's side too.
    fetch(`${auth.accountsServer}/oauth/v2/token/revoke?token=${encodeURIComponent(auth.refreshToken)}`, { method: "POST" }).catch(() => {});
  }
  await signOutLocal();
}

export async function isSignedIn() {
  return Boolean(await get("auth"));
}

async function tokenRequest(accountsServer, params) {
  const res = await fetch(`${accountsServer}/oauth/v2/token`, { method: "POST", body: new URLSearchParams(params) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const hint = json.error === "invalid_client" ? " Check the client ID, secret and region in Settings." : "";
    const err = new ZohoError(`Zoho sign-in failed (${json.error || res.status}).${hint}`, res.status);
    err.code = json.error;
    throw err;
  }
  return json;
}

let refreshing = null;

async function freshAuth(force = false) {
  const auth = await get("auth");
  if (!auth) throw new NotSignedIn();
  if (!force && Date.now() < auth.expiresAt) return auth;
  // One refresh at a time: Zoho rate-limits how often a refresh token can be used.
  refreshing ??= (async () => {
    try {
      const s = await getSettings();
      const tok = await tokenRequest(auth.accountsServer, {
        grant_type: "refresh_token",
        refresh_token: auth.refreshToken,
        client_id: s.clientId,
        client_secret: s.clientSecret,
      });
      const next = { ...auth, accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 120) * 1000 };
      await set("auth", next);
      return next;
    } catch (err) {
      // Zoho answers a dead refresh token with 200 + {"error": "invalid_code"}.
      if (err.code === "invalid_code" || err.status === 401) {
        await signOutLocal();
        throw new NotSignedIn();
      }
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request(url, { method = "GET", form } = {}, retried = false) {
  const auth = await freshAuth();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${auth.accessToken}` },
    body: form ? new URLSearchParams(form) : undefined,
  });
  if (res.status === 401 && !retried) {
    await freshAuth(true);
    return request(url, { method, form }, true);
  }
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ZohoError(errorMessage(json) || `Zoho returned ${res.status}`, res.status);
  return json;
}

function errorMessage(json) {
  const e = json?.error;
  if (!e) return json?.message;
  if (typeof e === "string") return e;
  return e.details?.[0]?.message || e.message || e.title;
}

async function projectsApi(path, query) {
  const auth = await freshAuth();
  const url = new URL(projectsHost(auth.accountsServer) + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, v);
  return request(url);
}

// ---------- who am I, which portal ----------

async function profile() {
  const auth = await freshAuth();
  const info = await request(`${auth.accountsServer}/oauth/user/info`);
  return { zuid: String(info.ZUID), email: (info.Email || "").toLowerCase(), name: info.Display_Name || info.First_Name || "" };
}

export async function getPortal() {
  const cached = await get("portal");
  const { portalId } = await getSettings();
  if (cached && (!portalId || cached.id === portalId)) return cached;
  const portals = await listPortals();
  if (!portals.length) throw new ZohoError("Your Zoho account has no Projects portals.");
  const pick = portals.find((p) => p.id === portalId) || portals.find((p) => p.isDefault) || portals[0];
  await set("portal", pick);
  return pick;
}

export async function listPortals() {
  const json = await projectsApi("/api/v3/portals");
  const list = Array.isArray(json) ? json : json.portals ?? json.result ?? json.data?.result ?? [];
  return list.map((p) => ({
    id: String(p.id),
    name: p.org_name || p.portal_name || p.name,
    url: p.portal_url || "",
    isDefault: Boolean(p.is_default_portal ?? p.default),
  }));
}

// ---------- tasks ----------

function slimTask(t) {
  return {
    id: String(t.id),
    key: t.prefix || "",
    name: t.name,
    projectId: String(t.project?.id ?? ""),
    projectName: t.project?.name ?? "",
    tasklist: t.tasklist?.name ?? "",
    status: t.status?.name ?? "",
    billable: t.billing_type === "billable",
    logged: t.log_hours?.total_hours ?? "",
  };
}

async function taskPage(portalId, page, criteria) {
  const filter = { criteria, pattern: criteria.map((_, i) => i + 1).join(" AND ") };
  const json = await projectsApi(`/api/v3/portal/${portalId}/tasks`, {
    page,
    per_page: 200,
    sort_by: "DESC(last_modified_time)",
    filter: JSON.stringify(filter),
  });
  const body = json.data ?? json;
  return { tasks: body.tasks ?? [], hasNext: Boolean(body.page_info?.has_next_page) };
}

const isMine = (task, me) =>
  (task.owners_and_work?.owners ?? []).some(
    (o) => (me.zpuid && String(o.zpuid) === me.zpuid) || String(o.zuid) === me.zuid || (o.email || "").toLowerCase() === me.email,
  );

/** Open tasks assigned to me, across every project in the portal. Cached for 30 minutes. */
export async function getMyTasks({ force = false } = {}) {
  const fetchedAt = await get("tasksFetchedAt");
  if (!force && Date.now() - fetchedAt < TASK_CACHE_MS) {
    const cached = await get("tasks");
    if (cached.length) return cached;
  }

  const portal = await getPortal();
  const settings = await getSettings();
  let me = await get("me");
  if (!me || force) me = { ...(await profile()), zpuid: me?.zpuid || "" };
  if (settings.zpuid) me.zpuid = settings.zpuid;

  const mine = [];
  if (me.zpuid) {
    // Fast path: let Zoho filter by owner (it needs the Projects user id, not the account id).
    for (let page = 1; page <= 10; page++) {
      const { tasks, hasNext } = await taskPage(portal.id, page, [
        OPEN_TASKS,
        { field_name: "owner", criteria_condition: "is", value: [me.zpuid] },
      ]);
      mine.push(...tasks);
      if (!hasNext) break;
    }
  } else {
    // First run: we don't know our Projects user id yet, so scan open tasks and match by account.
    for (let page = 1; page <= 25; page++) {
      const { tasks, hasNext } = await taskPage(portal.id, page, [OPEN_TASKS]);
      for (const t of tasks) {
        if (!isMine(t, me)) continue;
        mine.push(t);
        const owner = t.owners_and_work.owners.find((o) => String(o.zuid) === me.zuid || (o.email || "").toLowerCase() === me.email);
        if (owner?.zpuid) me.zpuid = String(owner.zpuid);
      }
      if (!hasNext) break;
    }
  }

  const slim = mine.map(slimTask);
  await set("me", me);
  await set("tasks", slim);
  await set("tasksFetchedAt", Date.now());
  return slim;
}

// ---------- time logs ----------

/** Logs one entry against a task. Returns Zoho's log id. */
export async function logTime({ projectId, taskId, date, minutes, billable, notes }) {
  const portal = await getPortal();
  const auth = await freshAuth();
  const url = `${projectsHost(auth.accountsServer)}/restapi/portal/${portal.id}/projects/${projectId}/tasks/${taskId}/logs/`;
  const json = await request(url, {
    method: "POST",
    form: {
      date: toZohoDate(date),
      bill_status: billable ? "Billable" : "Non Billable",
      hours: toHHMM(minutes),
      notes: notes || "",
    },
  });
  const log = json.timelogs?.tasklogs?.[0];
  return log ? String(log.id_string ?? log.id) : "";
}

// ---------- creating tasks (managers) ----------
// ponytail: v1 REST shapes written from Zoho's docs, never run against a real portal. Zoho's error text is shown as is.

async function restApi(path, { method = "GET", form, query } = {}) {
  const portal = await getPortal();
  const auth = await freshAuth();
  const url = new URL(`${projectsHost(auth.accountsServer)}/restapi/portal/${portal.id}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return request(url, { method, form });
}

const byName = (a, b) => a.name.localeCompare(b.name);

export async function listProjects() {
  const json = await restApi("/projects/", { query: { status: "active", range: 200 } });
  return (json.projects ?? []).map((p) => ({ id: String(p.id_string ?? p.id), name: p.name })).sort(byName);
}

export async function listProjectUsers(projectId) {
  const json = await restApi(`/projects/${projectId}/users/`);
  return (json.users ?? [])
    .filter((u) => u.active !== false)
    .map((u) => ({ id: String(u.id), name: u.name || u.email || String(u.id), email: u.email || "" }))
    .sort(byName);
}

export async function listTasklists(projectId) {
  const json = await restApi(`/projects/${projectId}/tasklists/`, { query: { flag: "internal", range: 100 } });
  return (json.tasklists ?? []).map((t) => ({ id: String(t.id_string ?? t.id), name: t.name })).sort(byName);
}

/** Creates a task assigned to one project member. Returns { id, key, url }. */
export async function createTask({ projectId, name, description, assigneeId, tasklistId, dueDate, priority, minutes, today }) {
  const form = { name, person_responsible: assigneeId };
  if (description) form.description = description;
  if (tasklistId) form.tasklist_id = tasklistId;
  if (priority) form.priority = priority;
  if (dueDate) {
    form.end_date = toZohoDate(dueDate);
    form.start_date = toZohoDate(dueDate < today ? dueDate : today);
  }
  if (minutes) {
    form.duration = String(+(minutes / 60).toFixed(2));
    form.duration_type = "hours";
  }
  const json = await restApi(`/projects/${projectId}/tasks/`, { method: "POST", form });
  const t = json.tasks?.[0];
  return { id: String(t?.id_string ?? t?.id ?? ""), key: t?.key ?? "", url: t?.link?.web?.url ?? "" };
}

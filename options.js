import { REGIONS, get, getSettings, saveSettings, set } from "./src/storage.js";
import { signIn, signOut, isSignedIn, listPortals, getMyTasks, redirectUri } from "./src/zoho.js";

const $ = (id) => document.getElementById(id);

init();

async function init() {
  const s = await getSettings();

  const region = $("region");
  region.replaceChildren(...REGIONS.map((r) => new Option(r.label, r.server)));
  region.value = s.accountsServer;
  updateConsoleLink();

  $("redirect").value = redirectUri();
  // Every Copy button copies the box right before it.
  for (const btn of document.querySelectorAll("[data-copy]")) {
    btn.onclick = async () => {
      const input = btn.previousElementSibling;
      try {
        await navigator.clipboard.writeText(input.value);
        btn.textContent = "Copied ✓";
      } catch {
        input.select(); // clipboard blocked: select it so ⌘C works
        btn.textContent = "Press ⌘C";
      }
      setTimeout(() => (btn.textContent = "Copy"), 1800);
    };
  }

  $("clientId").value = s.clientId;
  $("clientSecret").value = s.clientSecret;
  $("endOfDay").value = s.endOfDay;
  document.querySelector(`input[name="mode"][value="${s.autoSubmit ? "auto" : "ask"}"]`).checked = true;
  $("geminiKey").value = s.geminiKey;
  $("zpuid").value = s.zpuid;

  region.onchange = () => {
    updateConsoleLink();
    save({ accountsServer: region.value });
  };
  for (const id of ["clientId", "clientSecret", "geminiKey", "zpuid"]) {
    $(id).addEventListener("change", () => {
      save({ [id]: $(id).value.trim() });
      updateBadges();
    });
    $(id).addEventListener("input", updateBadges);
  }
  $("testNote").onclick = () => chrome.runtime.sendMessage({ type: "test-notification" });
  $("endOfDay").onchange = () => $("endOfDay").value && save({ endOfDay: $("endOfDay").value });
  for (const r of document.querySelectorAll('input[name="mode"]')) r.onchange = () => save({ autoSubmit: r.value === "auto" });

  $("connectBtn").onclick = connect;
  $("disconnectBtn").onclick = async () => {
    await signOut();
    await renderStatus();
  };
  $("portal").onchange = async () => {
    await save({ portalId: $("portal").value });
    await set("portal", null);
    await refreshTasks();
  };

  await renderStatus();
  updateBadges();
}

function updateConsoleLink() {
  const href = $("region").value.replace("://accounts.", "://api-console.");
  $("consoleLink").href = href;
  $("consoleLink2").href = href;
}

let signedInNow = false;

/** "✓ Done" tags on the big steps, so people can see where they are. */
function updateBadges() {
  $("badge1").classList.toggle("hidden", !($("clientId").value.trim() && $("clientSecret").value.trim()));
  $("badge2").classList.toggle("hidden", !signedInNow);
}

let savedTimer;
async function save(patch) {
  await saveSettings(patch);
  const note = $("saved");
  note.style.opacity = 1;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (note.style.opacity = 0), 1200);
}

async function connect() {
  // Firefox doesn't grant host permissions at install; this asks (needs the click) and is instant in Chrome.
  await chrome.permissions.request({ origins: chrome.runtime.getManifest().host_permissions }).catch(() => {});
  await save({
    accountsServer: $("region").value,
    clientId: $("clientId").value.trim(),
    clientSecret: $("clientSecret").value.trim(),
  });
  const btn = $("connectBtn");
  btn.disabled = true;
  btn.textContent = "Waiting for Zoho…";
  msg();
  try {
    await signIn();
    await renderStatus();
    await refreshTasks();
  } catch (err) {
    msg("danger", friendly(err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = "Connect Zoho";
  }
}

async function renderStatus() {
  const signedIn = await isSignedIn();
  signedInNow = signedIn;
  updateBadges();
  $("statusDot").classList.toggle("on", signedIn);
  $("connectBtn").classList.toggle("hidden", signedIn);
  $("disconnectBtn").classList.toggle("hidden", !signedIn);
  $("portalRow").classList.add("hidden"); // shown once portals load, and only if there's a choice
  if (!signedIn) {
    $("statusText").textContent = "Not connected";
    $("statusSub").textContent = "";
    return;
  }
  const me = await get("me");
  $("statusText").textContent = me?.name ? `Connected as ${me.name}` : "Connected";
  const tasks = await get("tasks");
  $("statusSub").textContent = tasks.length ? `${tasks.length} open tasks assigned to you` : "";

  try {
    const portals = await listPortals();
    const { portalId } = await getSettings();
    const current = portalId || (await get("portal"))?.id || portals.find((p) => p.isDefault)?.id || portals[0]?.id;
    $("portal").replaceChildren(...portals.map((p) => new Option(p.name, p.id)));
    if (current) $("portal").value = current;
    $("portalRow").classList.toggle("hidden", portals.length < 2);
  } catch (err) {
    msg("danger", `Couldn't load your Zoho workspaces (${err.message}). Check your internet connection and reload this page.`);
  }
}

async function refreshTasks() {
  $("statusSub").textContent = "Loading your tasks…";
  try {
    const tasks = await getMyTasks({ force: true });
    const me = await get("me");
    if (me?.zpuid && !$("zpuid").value) $("zpuid").placeholder = `Found: ${me.zpuid}`;
    $("statusText").textContent = me?.name ? `Connected as ${me.name}` : "Connected";
    $("statusSub").textContent = `${tasks.length} open tasks assigned to you`;
    msg(tasks.length ? "ok" : "warn", tasks.length ? "All set! Click the ⚡ icon in your toolbar (or press ⌘ Shift L) to log time. Step 3 below lets you pick when hours go to Zoho." : "Connected, but no open tasks are assigned to you in this workspace. See “It connected, but I see no tasks” below.");
  } catch (err) {
    $("statusSub").textContent = "";
    msg("danger", `Connected, but loading tasks failed: ${err.message}`);
  }
}

/** Turns technical errors into something a non-technical person can act on. */
function friendly(message) {
  const m = message.toLowerCase();
  if (m.includes("did not approve") || m.includes("user cancel") || m.includes("closed")) return "The Zoho window was closed before you approved. Click Connect Zoho and press Accept in the Zoho window.";
  if (m.includes("redirect")) return "Zoho doesn't recognise the redirect address. Fix it using “Invalid redirect URI” in the help section at the bottom of this page, then try again.";
  if (m.includes("invalid_client")) return "Zoho doesn't accept that Client ID or Secret. Re-copy them from Zoho's Client Secret tab and check the region in step A.";
  if (m.includes("client id and secret")) return "Please fill in the Client ID and Client Secret first (step F).";
  return message;
}

function msg(kind, text) {
  const box = $("connectMsg");
  box.className = kind ? `banner ${kind}` : "banner hidden";
  box.textContent = text || "";
}

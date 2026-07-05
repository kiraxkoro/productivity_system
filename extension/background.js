// Focus OS Blocker — MV3 service worker.
// Polls the Focus OS desktop app for the active block's blocked domains and
// redirects matching tabs to blocked.html for the whole block. Fails open:
// if Focus OS isn't running, nothing is blocked.

const API = "http://127.0.0.1:48210/blocklist";

let state = { active: false, domains: [], label: "", endTime: "" };
let fetchedAt = 0;

// Restore last-known state instantly when the service worker wakes, so
// navigation events can be matched before the next fetch returns.
chrome.storage.session.get("state").then(({ state: saved }) => {
  if (saved) state = saved;
});

async function refresh() {
  try {
    const res = await fetch(API);
    state = await res.json();
    fetchedAt = Date.now();
  } catch {
    state = { active: false, domains: [], label: "", endTime: "" };
  }
  await chrome.storage.session.set({ state });
  if (state.active && state.domains.length) await sweepAllTabs();
}

// Tab activity re-checks the blocklist immediately when the cached copy is
// stale, so a block that just started bites in ~1s instead of up to 30s.
function maybeRefresh() {
  if (Date.now() - fetchedAt > 10_000) refresh();
}

function isBlocked(url) {
  if (!state.active || !state.domains.length) return false;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  // "youtube.com" matches youtube.com + any subdomain; a bare token like
  // "youtube" (user skipped the .com) matches any host containing that label
  return state.domains.some(
    (d) =>
      host === d || host.endsWith("." + d) || host.split(".").includes(d),
  );
}

function blockedPageUrl() {
  const params = new URLSearchParams({
    label: state.label || "Focus block",
    until: state.endTime || "",
  });
  return chrome.runtime.getURL("blocked.html") + "?" + params.toString();
}

function blockTab(tabId) {
  chrome.tabs.update(tabId, { url: blockedPageUrl() }).catch(() => {});
}

async function sweepAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id !== undefined && tab.url && isBlocked(tab.url)) blockTab(tab.id);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  maybeRefresh();
  const url = changeInfo.url || (changeInfo.status === "loading" ? tab.url : null);
  if (url && isBlocked(url)) blockTab(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  maybeRefresh();
  if (tab.id !== undefined && tab.pendingUrl && isBlocked(tab.pendingUrl)) {
    blockTab(tab.id);
  }
});

chrome.alarms.create("focus-os-refresh", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "focus-os-refresh") refresh();
});
chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onInstalled.addListener(refresh);

// Also refresh whenever the worker wakes for any event.
refresh();

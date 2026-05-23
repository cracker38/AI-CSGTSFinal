/** Clear browser storage used by the app (keeps login + theme). */

const PRESERVE_LOCAL_KEYS = new Set(["aicsgts_auth", "aicsgts_theme_mode", "aicsgts_last_email"]);
export const FRESH_RELOAD_FLAG = "aicsgts_fresh_reload_at";

export function clearStaleBrowserData() {
  const preserved = {};
  for (const key of PRESERVE_LOCAL_KEYS) {
    const value = localStorage.getItem(key);
    if (value != null) preserved[key] = value;
  }
  const freshReloadAt = sessionStorage.getItem(FRESH_RELOAD_FLAG);
  localStorage.clear();
  sessionStorage.clear();
  for (const [key, value] of Object.entries(preserved)) {
    localStorage.setItem(key, value);
  }
  if (freshReloadAt != null) {
    sessionStorage.setItem(FRESH_RELOAD_FLAG, freshReloadAt);
  }
  if ("caches" in window) {
    return caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))));
  }
  return Promise.resolve();
}

export function consumeFreshReloadNotice() {
  const raw = sessionStorage.getItem(FRESH_RELOAD_FLAG);
  if (!raw) return null;
  sessionStorage.removeItem(FRESH_RELOAD_FLAG);
  const at = Number(raw);
  if (!Number.isFinite(at)) return null;
  return new Date(at);
}

export async function reloadFreshPage() {
  const stamp = String(Date.now());
  sessionStorage.setItem(FRESH_RELOAD_FLAG, stamp);
  await clearStaleBrowserData();
  const url = new URL(window.location.href);
  url.searchParams.set("_fresh", stamp);
  window.location.replace(url.toString());
}

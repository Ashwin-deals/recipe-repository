// Shared-device safety: everything this browser kept for the signed-in user is removed when
// they sign out, when their session ends, and before someone else signs in.

/** The theme is a device preference, not account data, so it survives sign-out. */
const KEEP = new Set(["cartchef:theme"]);
/** The service worker's offline copy of API responses (see vite.config.ts). */
export const API_CACHE = "cartchef-api";
/** Which user the stored offline data belongs to. */
export const OWNER_KEY = "cartchef:owner";

function clearStorage(storage: Storage): void {
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key): key is string => key !== null && key.startsWith("cartchef:") && !KEEP.has(key),
    );
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

/** Remove the offline list queue, chat history, cached API responses and any other user data. */
export async function clearUserData(): Promise<void> {
  clearStorage(localStorage);
  clearStorage(sessionStorage);
  try {
    if ("caches" in window) await caches.delete(API_CACHE);
  } catch {
    // No Cache Storage (old browser, private mode): nothing to clear.
  }
}

/**
 * Called once the signed-in user is known. If the data on this device belongs to someone else
 * (or nobody recorded it), clear it before any of it can be shown.
 */
export async function claimDeviceData(userId: number): Promise<void> {
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(OWNER_KEY);
  } catch {
    // Storage blocked: treat as unknown owner.
  }
  if (owner !== String(userId)) await clearUserData();
  try {
    localStorage.setItem(OWNER_KEY, String(userId));
  } catch {
    // Storage blocked: offline data can't persist anyway.
  }
}

// Queue of "set checked" changes made while offline, persisted in localStorage.
// Each entry stores the desired final state (not a toggle), so replaying it is idempotent.

import { ApiError } from "../api/client";

export type Queue = Record<string, boolean>;

export const QUEUE_KEY = "cartchef:pending-checks";

export function loadQueue(storage: Storage = localStorage): Queue {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(QUEUE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  } catch {
    return {};
  }
}

export function saveQueue(queue: Queue, storage: Storage = localStorage): void {
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Storage full or blocked: the change still applies on screen and is sent if online.
  }
}

export function enqueue(id: number, checked: boolean, storage: Storage = localStorage): Queue {
  const queue = { ...loadQueue(storage), [String(id)]: checked };
  saveQueue(queue, storage);
  return queue;
}

export interface FlushResult {
  synced: Array<[number, boolean]>;
  dropped: number[];
  remaining: Queue;
  offline: boolean;
}

/**
 * Send queued changes one by one. Stops at the first network failure (still offline);
 * drops changes the server rejects (e.g. the item was cleared meanwhile).
 */
export async function flushQueue(
  send: (id: number, checked: boolean) => Promise<void>,
  storage: Storage = localStorage,
): Promise<FlushResult> {
  const result: FlushResult = { synced: [], dropped: [], remaining: {}, offline: false };
  for (const [key, checked] of Object.entries(loadQueue(storage))) {
    const id = Number(key);
    try {
      await send(id, checked);
      result.synced.push([id, checked]);
    } catch (error) {
      if (!(error instanceof ApiError) || error.offline) {
        result.offline = true;
        break;
      }
      result.dropped.push(id);
    }
    // Only remove the entry if the user didn't change it again while we were sending.
    const queue = loadQueue(storage);
    if (queue[key] === checked) {
      saveQueue(Object.fromEntries(Object.entries(queue).filter(([other]) => other !== key)), storage);
    }
  }
  result.remaining = loadQueue(storage);
  return result;
}

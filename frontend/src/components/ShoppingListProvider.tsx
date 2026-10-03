import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addListItem, clearList, getList, removeListItem, setItemAmount, setItemChecked } from "../api/endpoints";
import type { LoadStatus } from "../hooks/useApi";
import { ShoppingListContext, type ShoppingListApi } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import { applyPending, setChecked, type ViewItem } from "../lib/listView";
import { enqueue, flushQueue, loadQueue, saveQueue, type Queue } from "../lib/offlineQueue";
import type { ListData } from "../types";

const RETRY_MS = 15_000;

/** Owns the shopping list so the dashboard panel, the full list page and the nav badge stay in sync. */
export function ShoppingListProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [data, setData] = useState<ListData | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Queue>(() => loadQueue());
  const flushing = useRef(false);

  const reload = useCallback(async () => {
    try {
      setData(await getList());
      setStatus("ready");
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
      setStatus((current) => (current === "ready" ? "ready" : "error"));
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    let needsReload = false;
    try {
      // Keep going while progress is made, so ticks made during a flush are sent too.
      for (;;) {
        const result = await flushQueue(async (id, checked) => {
          await setItemChecked(id, checked);
        });
        if (result.synced.length) {
          setData((current) =>
            current && result.synced.reduce((list, [id, checked]) => setChecked(list, id, checked), current),
          );
        }
        needsReload ||= result.dropped.length > 0;
        setPending(result.remaining);
        const progress = result.synced.length + result.dropped.length;
        if (result.offline || progress === 0 || Object.keys(result.remaining).length === 0) break;
      }
    } finally {
      flushing.current = false;
    }
    if (needsReload) await reload();
  }, [reload]);

  useEffect(() => {
    // Sync queued ticks before loading, so a stale list can't overwrite them.
    void flush().then(reload);
    const onOnline = () => {
      void flush().then(reload);
    };
    const timer = window.setInterval(() => {
      if (Object.keys(loadQueue()).length) void flush();
    }, RETRY_MS);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [reload, flush]);

  const toggle = useCallback(
    (item: ViewItem) => {
      setPending(enqueue(item.id, !item.checked));
      if (navigator.onLine) void flush();
      else toast.show("Saved offline. It will sync when you're back online.");
    },
    [flush, toast],
  );

  const clear = useCallback(
    async (scope: "all" | "checked") => {
      const result = await clearList(scope);
      if (scope === "all") {
        saveQueue({});
        setPending({});
      }
      await reload();
      return result.removed;
    },
    [reload],
  );

  const addItem = useCallback(
    async (line: string) => {
      const result = await addListItem(line);
      await reload();
      return result;
    },
    [reload],
  );

  const setAmount = useCallback(
    async (id: number, amount: string) => {
      await setItemAmount(id, amount);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: number) => {
      await removeListItem(id);
      // A queued offline tick for this item has nothing left to apply to.
      const queue = loadQueue();
      if (String(id) in queue) {
        const rest = Object.fromEntries(Object.entries(queue).filter(([key]) => key !== String(id)));
        saveQueue(rest);
        setPending(rest);
      }
      await reload();
    },
    [reload],
  );

  const value = useMemo<ShoppingListApi>(() => {
    const view = data ? applyPending(data, pending) : { groups: [], counts: { total: 0, checked: 0, open: 0 } };
    return {
      ...view,
      status,
      error,
      pendingCount: Object.keys(pending).length,
      reload,
      toggle,
      clear,
      addItem,
      setAmount,
      remove,
    };
  }, [data, pending, status, error, reload, toggle, clear, addItem, setAmount, remove]);

  return <ShoppingListContext.Provider value={value}>{children}</ShoppingListContext.Provider>;
}

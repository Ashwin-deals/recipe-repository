import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { errorMessage } from "../lib/errors";

export type LoadStatus = "loading" | "ready" | "error";

export interface ApiState<T> {
  data: T | null;
  status: LoadStatus;
  error: string | null;
  reload: () => Promise<void>;
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Load data for a page. `key` identifies the request: when it changes the data is
 * reloaded (e.g. a new category filter). Stale responses are ignored.
 */
export function useApi<T>(key: string, loader: () => Promise<T>): ApiState<T> {
  const loaderRef = useRef(loader);
  const requestId = useRef(0);
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    try {
      const result = await loaderRef.current();
      if (id !== requestId.current) return;
      setData(result);
      setStatus("ready");
    } catch (err) {
      if (id !== requestId.current) return;
      setError(errorMessage(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    setData(null);
    setStatus("loading");
    void reload();
  }, [key, reload]);

  return { data, status, error, reload, setData };
}

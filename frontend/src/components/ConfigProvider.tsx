import { useEffect, useState, type ReactNode } from "react";
import { getConfig } from "../api/endpoints";
import { ConfigContext, DEFAULT_CONFIG } from "../hooks/useConfig";
import type { AppConfig } from "../types";

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => {
      // Offline or server down: the defaults keep the UI usable.
    });
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

import { createContext, useContext } from "react";
import type { AppConfig } from "../types";

// Used until /api/config answers (and offline), so the UI never waits on it.
export const DEFAULT_CONFIG: AppConfig = {
  allow_signups: true,
  demo_login: false,
  ai_enabled: false,
  categories: ["Breakfast", "Lunch", "Dinner", "Dessert"],
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  multipliers: [1, 2, 3, 4],
  max_image_bytes: 5 * 1024 * 1024,
};

export const ConfigContext = createContext<AppConfig>(DEFAULT_CONFIG);

export function useConfig(): AppConfig {
  return useContext(ConfigContext);
}

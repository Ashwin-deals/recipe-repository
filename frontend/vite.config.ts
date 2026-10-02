import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// Flask runs on 5001 in development (macOS often has AirPlay on 5000).
const BACKEND = "http://127.0.0.1:5001";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": a new build waits until the user accepts the "new version" banner.
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/icon-192.png"],
      manifest: {
        name: "CartChef: Recipe Box & Shopping List",
        short_name: "CartChef",
        description: "Save recipes, scale them, and build one consolidated shopping checklist.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#fbf5ea",
        theme_color: "#c8442a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Shopping list", short_name: "List", url: "/shopping" },
          { name: "Meal planner", short_name: "Planner", url: "/planner" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/healthz/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Read-only data: network first, falling back to the last copy when offline.
            urlPattern: /\/api\/(list|recipes|config|planner|insights)(\/|\?|$)/,
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "cartchef-api",
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 80 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": BACKEND,
      "/healthz": BACKEND,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    alias: {
      "virtual:pwa-register/react": new URL("./src/test/pwaRegisterStub.ts", import.meta.url).pathname,
    },
  },
});

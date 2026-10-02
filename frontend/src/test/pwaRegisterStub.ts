// Stand-in for vite-plugin-pwa's virtual module, which only exists in a Vite build.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => undefined] as const,
    offlineReady: [false, () => undefined] as const,
    updateServiceWorker: async () => undefined,
  };
}

import { useRegisterSW } from "virtual:pwa-register/react";

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Shows a banner when a new build has been deployed, instead of silently serving the old one. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) window.setInterval(() => void registration.update(), UPDATE_CHECK_MS);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="update-prompt" role="status">
      <span>A new version of CartChef is available.</span>
      <button type="button" className="btn btn-primary" onClick={() => void updateServiceWorker(true)}>
        Refresh
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}

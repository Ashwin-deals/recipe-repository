import { useOnline } from "../hooks/useOnline";
import { Icon } from "./Icon";

export function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="wifi-off" />
      <span>You're offline. Showing your last saved list; ticks will sync when you're back.</span>
    </div>
  );
}

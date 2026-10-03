import { useLocation } from "react-router-dom";

/** Shows the current URL, so tests can check search state in ?q= and navigation. */
export function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

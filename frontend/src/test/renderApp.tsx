import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { OWNER_KEY } from "../lib/session";
import { LocationProbe } from "./LocationProbe";
import { TEST_USER } from "./mockApi";

/**
 * The whole app (header search, chat widget, routes) at `route`, signed in as TEST_USER
 * (mock /api/auth/me). Resolves once the session check is done and the app is on screen.
 * Data saved on this device is marked as TEST_USER's, so tests can pre-fill storage.
 */
export async function renderApp(route = "/") {
  localStorage.setItem(OWNER_KEY, String(TEST_USER.id));
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByText("Opening your recipe box…")).not.toBeInTheDocument());
  return result;
}

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { LocationProbe } from "./LocationProbe";

/** The whole app (header search, chat widget, routes) at `route`. */
export function renderApp(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

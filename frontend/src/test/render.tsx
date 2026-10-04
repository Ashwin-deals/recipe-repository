import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { Providers } from "../App";
import { ConfigProvider } from "../components/ConfigProvider";

export function renderWithProviders(ui: ReactElement, { route = "/" } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ConfigProvider>
        <Providers>{ui}</Providers>
      </ConfigProvider>
    </MemoryRouter>,
  );
}

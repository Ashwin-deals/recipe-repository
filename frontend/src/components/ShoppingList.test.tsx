import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { loadQueue } from "../lib/offlineQueue";
import { makeItem, makeList } from "../test/fixtures";
import { mockApi, networkDown } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { ShoppingList } from "./ShoppingList";

const flour = makeItem({ id: 5, label: "2 cups flour" });

describe("ShoppingList", () => {
  it("strikes items through and persists check and uncheck", async () => {
    const api = mockApi({
      "GET /api/list": makeList([flour]),
      "POST /api/list/5/check": (body) => ({ id: 5, ...(body as object), counts: { total: 1, checked: 0, open: 1 } }),
    });
    renderWithProviders(<ShoppingList variant="full" />);

    const item = await screen.findByRole("button", { name: /2 cups flour/ });
    expect(item).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(item);
    expect(item).toHaveAttribute("aria-pressed", "true");
    expect(item).toHaveClass("is-checked");
    await vi.waitFor(() => expect(api.callsTo("POST", "/api/list/5/check")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/list/5/check")[0]?.body).toEqual({ checked: true });

    await userEvent.click(item);
    expect(item).toHaveAttribute("aria-pressed", "false");
    await vi.waitFor(() => expect(api.callsTo("POST", "/api/list/5/check")).toHaveLength(2));
    expect(api.callsTo("POST", "/api/list/5/check")[1]?.body).toEqual({ checked: false });
    await vi.waitFor(() => expect(loadQueue()).toEqual({}));
  });

  it("queues ticks made offline and syncs them when back online", async () => {
    let online = false;
    let serverItem = flour;
    const api = mockApi({
      "GET /api/list": () => makeList([serverItem]),
      "POST /api/list/5/check": (body) => {
        if (!online) networkDown();
        const { checked } = body as { checked: boolean };
        serverItem = { ...serverItem, checked };
        return { id: 5, checked, counts: makeList([serverItem]).counts };
      },
    });
    renderWithProviders(<ShoppingList variant="full" />);

    const item = await screen.findByRole("button", { name: /2 cups flour/ });
    await userEvent.click(item);

    expect(item).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("1 change waiting to sync")).toBeInTheDocument();
    expect(item).toHaveClass("is-pending");
    expect(loadQueue()).toEqual({ "5": true });

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await vi.waitFor(() => expect(screen.queryByText(/waiting to sync/)).not.toBeInTheDocument());
    expect(loadQueue()).toEqual({});
    expect(item).not.toHaveClass("is-pending");
    expect(item).toHaveAttribute("aria-pressed", "true");
    expect(api.callsTo("POST", "/api/list/5/check").at(-1)?.body).toEqual({ checked: true });
    expect(serverItem.checked).toBe(true);
  });

  it("applies changes queued in an earlier session on load", async () => {
    localStorage.setItem("cartchef:pending-checks", JSON.stringify({ "5": true }));
    let serverItem = flour;
    const api = mockApi({
      "GET /api/list": () => makeList([serverItem]),
      "POST /api/list/5/check": () => {
        serverItem = { ...serverItem, checked: true };
        return { id: 5, checked: true, counts: makeList([serverItem]).counts };
      },
    });
    renderWithProviders(<ShoppingList variant="full" />);
    expect(await screen.findByRole("button", { name: /2 cups flour/ })).toHaveAttribute("aria-pressed", "true");
    // The queued change is sent before the list is loaded, so the list already reflects it.
    expect(api.calls.map((c) => `${c.method} ${c.path}`).filter((c) => c.includes("/api/list"))).toEqual([
      "POST /api/list/5/check",
      "GET /api/list",
    ]);
    expect(loadQueue()).toEqual({});
  });

  it("clears the list after a confirming second tap", async () => {
    let list = makeList([flour]);
    const api = mockApi({
      "GET /api/list": () => list,
      "POST /api/list/clear": () => {
        list = makeList();
        return { removed: 1, scope: "all", counts: list.counts };
      },
    });
    renderWithProviders(<ShoppingList variant="full" />);
    await screen.findByRole("button", { name: /2 cups flour/ });

    await userEvent.click(screen.getByRole("button", { name: "Clear list" }));
    expect(api.callsTo("POST", "/api/list/clear")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Tap again to clear" }));

    expect(await screen.findByText("Nothing on the list yet.")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/list/clear")[0]?.body).toEqual({ scope: "all" });
  });

  it("adds a manual item", async () => {
    let list = makeList();
    const api = mockApi({
      "GET /api/list": () => list,
      "POST /api/list/items": () => {
        list = makeList([makeItem({ id: 7, label: "2 lemons", aisle: "Produce" })]);
        return { added: 1, merged: 0, counts: list.counts };
      },
    });
    renderWithProviders(<ShoppingList variant="full" />);
    await screen.findByText("Nothing on the list yet.");
    await userEvent.type(screen.getByLabelText("Add an item"), "2 lemons");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByRole("button", { name: /2 lemons/ })).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/list/items")[0]?.body).toEqual({ line: "2 lemons" });
    expect(screen.getByLabelText("Add an item")).toHaveValue("");
  });
});

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeItem, makeList, makeRecipe } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import type { ListData } from "../types";
import { Dashboard } from "./Dashboard";

const pancakes = makeRecipe();
const curry = makeRecipe({ id: 2, title: "Chicken Curry", category: "Dinner", lines: ["500 g chicken", "2 onions"] });

describe("Dashboard", () => {
  it("updates the shopping list panel right after adding a recipe", async () => {
    let list: ListData = makeList();
    mockApi({
      "GET /api/recipes": { recipes: [pancakes, curry] },
      "GET /api/list": () => list,
      "POST /api/recipes/1/add-to-list": () => {
        list = makeList([makeItem({ id: 9, label: "1 1/2 cups flour" }), makeItem({ id: 10, label: "1 egg", aisle: "Dairy & Eggs" })]);
        return { added: 2, merged: 0, multiplier: 1, counts: list.counts };
      },
    });
    renderWithProviders(<Dashboard />);

    const panel = await screen.findByRole("complementary", { name: "Shopping list" });
    expect(await within(panel).findByText("Nothing on the list yet.")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Pancakes" }));
    const drawer = screen.getByRole("dialog", { name: "Pancakes" });
    await userEvent.click(within(drawer).getByRole("button", { name: /add to list/i }));

    expect(await within(panel).findByRole("button", { name: "1 1/2 cups flour" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "1 egg" })).toBeInTheDocument();
    expect(within(panel).getByText("to buy", { exact: false })).toHaveTextContent("2 to buy");
  });

  it("filters recipes by category using the backend", async () => {
    const api = mockApi({
      "GET /api/recipes": { recipes: [pancakes, curry] },
      "GET /api/recipes?category=Dinner": { recipes: [curry] },
      "GET /api/list": makeList(),
    });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByRole("button", { name: "Pancakes" })).toBeInTheDocument();

    const dinner = screen.getByRole("button", { name: "Dinner" });
    await userEvent.click(dinner);

    expect(await screen.findByRole("button", { name: "Chicken Curry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pancakes" })).not.toBeInTheDocument();
    expect(dinner).toHaveAttribute("aria-pressed", "true");
    expect(api.callsTo("GET", "/api/recipes?category=Dinner")).toHaveLength(1);
  });

  it("shows an error with a retry when recipes fail to load", async () => {
    let fail = true;
    mockApi({
      "GET /api/recipes": () => {
        if (fail) throw new TypeError("Failed to fetch");
        return { recipes: [pancakes] };
      },
      "GET /api/list": makeList(),
    });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent("You're offline");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Pancakes" })).toBeInTheDocument();
  });

  it("shows an empty state for a category with no recipes", async () => {
    mockApi({ "GET /api/recipes?category=Dessert": { recipes: [] }, "GET /api/list": makeList() });
    renderWithProviders(<Dashboard />, { route: "/?category=Dessert" });
    expect(await screen.findByText("No dessert recipes yet.")).toBeInTheDocument();
  });

  it("closes the drawer after deleting and removes the card", async () => {
    mockApi({
      "GET /api/recipes": { recipes: [pancakes, curry] },
      "GET /api/list": makeList(),
      "DELETE /api/recipes/1": { deleted: 1 },
    });
    renderWithProviders(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: "Pancakes" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Tap again to delete" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Pancakes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chicken Curry" })).toBeInTheDocument();
  });

  it("opens Ask the chef for a recipe from its card, and in general mode from the header", async () => {
    const api = mockApi({
      "GET /api/recipes": { recipes: [pancakes, curry] },
      "GET /api/list": makeList(),
      "POST /api/chat": { reply: "Use oat milk.", proposal: null, shopping_items: [], source: "gemini" },
    });
    renderWithProviders(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: "Ask the chef about Chicken Curry" }));
    const chat = screen.getByRole("dialog", { name: "Ask the chef" });
    expect(within(chat).getByText("About: Chicken Curry")).toBeInTheDocument();
    await userEvent.type(within(chat).getByLabelText("Message the chef"), "dairy-free?{Enter}");
    expect(await within(chat).findByText("Use oat milk.")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/chat")[0]?.body).toMatchObject({ recipe_id: 2 });

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Ask the chef" }));
    expect(screen.getByText("General kitchen help")).toBeInTheDocument();
  });
});

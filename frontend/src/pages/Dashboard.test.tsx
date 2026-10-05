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
      "GET /api/recipes/1/list-impact": { removed: 0, reduced: 0 },
      "DELETE /api/recipes/1": { deleted: 1, list_removed: 0, list_reduced: 0, counts: { total: 0, checked: 0, open: 0 } },
    });
    renderWithProviders(<Dashboard />);
    await userEvent.click(await screen.findByRole("button", { name: "Pancakes" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete recipe" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Pancakes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chicken Curry" })).toBeInTheDocument();
  });

  it("filters the grid by ?q= together with the category, and clears the search", async () => {
    const pasta = makeRecipe({ id: 3, title: "Garlic Pasta", category: "Dinner", lines: ["200 g pasta", "2 cloves garlic"], diet_tags: [] });
    mockApi({
      "GET /api/recipes": { recipes: [pancakes, curry, pasta] },
      "GET /api/recipes?category=Dinner": { recipes: [curry, pasta] },
      "GET /api/list": makeList(),
    });
    renderWithProviders(<Dashboard />, { route: "/?q=chicken" });
    expect(await screen.findByRole("button", { name: "Chicken Curry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pancakes" })).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1 of 3 recipes for “chicken”");

    // Changing the category keeps the search.
    await userEvent.click(screen.getByRole("button", { name: "Dinner" }));
    expect(await screen.findByText(/Showing/)).toHaveTextContent("Showing 1 of 2 dinner recipes for “chicken”");
    expect(screen.queryByRole("button", { name: "Garlic Pasta" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByRole("button", { name: "Garlic Pasta" })).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it("shows an empty state when the search matches nothing", async () => {
    mockApi({ "GET /api/recipes": { recipes: [pancakes, curry] }, "GET /api/list": makeList() });
    renderWithProviders(<Dashboard />, { route: "/?q=sushi" });
    expect(await screen.findByText("No recipes match “sushi”.")).toBeInTheDocument();
    const empty = screen.getByText("No recipes match “sushi”.").closest(".state") as HTMLElement;
    await userEvent.click(within(empty).getByRole("button", { name: "Clear search" }));
    expect(await screen.findByRole("button", { name: "Pancakes" })).toBeInTheDocument();
  });

  it("has no Ask the chef buttons in the header or on cards", async () => {
    mockApi({ "GET /api/recipes": { recipes: [pancakes, curry] }, "GET /api/list": makeList() });
    renderWithProviders(<Dashboard />);
    await screen.findByRole("button", { name: "Pancakes" });
    expect(screen.queryByRole("button", { name: /ask the chef/i })).not.toBeInTheDocument();
  });
});

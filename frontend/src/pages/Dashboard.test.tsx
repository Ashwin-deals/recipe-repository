import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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

    const card = (await screen.findByRole("link", { name: "Pancakes" })).closest("article");
    if (!card) throw new Error("card not found");
    await userEvent.click(within(card).getByRole("button", { name: /add to list/i }));

    expect(await within(panel).findByText("1 1/2 cups flour")).toBeInTheDocument();
    expect(within(panel).getByText("1 egg")).toBeInTheDocument();
    expect(within(panel).getByText("to buy", { exact: false })).toHaveTextContent("2 to buy");
  });

  it("filters recipes by category using the backend", async () => {
    const api = mockApi({
      "GET /api/recipes": { recipes: [pancakes, curry] },
      "GET /api/recipes?category=Dinner": { recipes: [curry] },
      "GET /api/list": makeList(),
    });
    renderWithProviders(<Dashboard />);
    expect(await screen.findByRole("link", { name: "Pancakes" })).toBeInTheDocument();

    const dinner = screen.getByRole("button", { name: "Dinner" });
    await userEvent.click(dinner);

    expect(await screen.findByRole("link", { name: "Chicken Curry" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pancakes" })).not.toBeInTheDocument();
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
    expect(await screen.findByRole("link", { name: "Pancakes" })).toBeInTheDocument();
  });

  it("shows an empty state for a category with no recipes", async () => {
    mockApi({ "GET /api/recipes?category=Dessert": { recipes: [] }, "GET /api/list": makeList() });
    renderWithProviders(<Dashboard />, { route: "/?category=Dessert" });
    expect(await screen.findByText("No dessert recipes yet.")).toBeInTheDocument();
  });
});

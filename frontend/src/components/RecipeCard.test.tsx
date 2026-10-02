import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeList, makeRecipe } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { RecipeCard } from "./RecipeCard";

describe("RecipeCard", () => {
  it("shows scaled quantities from the backend when servings change", async () => {
    const api = mockApi({
      "GET /api/list": makeList(),
      "GET /api/recipes/1/scaled?x=2": { multiplier: 2, lines: ["3 cups flour", "2 eggs", "salt to taste"] },
    });
    renderWithProviders(<RecipeCard recipe={makeRecipe()} onDeleted={vi.fn()} />);

    const ingredients = screen.getByRole("list", { name: "Ingredients for Pancakes" });
    expect(within(ingredients).getByText("1 1/2 cups flour")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Servings for Pancakes"), "2");

    expect(await within(ingredients).findByText("3 cups flour")).toBeInTheDocument();
    expect(within(ingredients).getByText("2 eggs")).toBeInTheDocument();
    expect(within(ingredients).getByText("salt to taste")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(api.callsTo("GET", "/api/recipes/1/scaled?x=2")).toHaveLength(1);
  });

  it("goes back to the saved lines at 1x without another request", async () => {
    const api = mockApi({
      "GET /api/list": makeList(),
      "GET /api/recipes/1/scaled?x=3": { multiplier: 3, lines: ["4 1/2 cups flour", "3 eggs", "salt to taste"] },
    });
    renderWithProviders(<RecipeCard recipe={makeRecipe()} onDeleted={vi.fn()} />);
    const select = screen.getByLabelText("Servings for Pancakes");
    await userEvent.selectOptions(select, "3");
    expect(await screen.findByText("4 1/2 cups flour")).toBeInTheDocument();
    await userEvent.selectOptions(select, "1");
    expect(await screen.findByText("1 1/2 cups flour")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path.includes("/scaled"))).toHaveLength(1);
  });

  it("sends the chosen multiplier when adding to the list", async () => {
    const api = mockApi({
      "GET /api/list": makeList(),
      "GET /api/recipes/1/scaled?x=4": { multiplier: 4, lines: ["6 cups flour", "4 eggs", "salt to taste"] },
      "POST /api/recipes/1/add-to-list": { added: 3, merged: 0, multiplier: 4, counts: { total: 3, checked: 0, open: 3 } },
    });
    renderWithProviders(<RecipeCard recipe={makeRecipe()} onDeleted={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Servings for Pancakes"), "4");
    await userEvent.click(screen.getByRole("button", { name: /add to list/i }));
    expect(await screen.findByText("Added 3 new items.")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/recipes/1/add-to-list")[0]?.body).toEqual({ multiplier: 4 });
  });

  it("needs two taps to delete", async () => {
    const onDeleted = vi.fn();
    const api = mockApi({ "GET /api/list": makeList(), "DELETE /api/recipes/1": { deleted: 1 } });
    renderWithProviders(<RecipeCard recipe={makeRecipe()} onDeleted={onDeleted} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.callsTo("DELETE", "/api/recipes/1")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Tap again to delete" }));
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(1));
  });
});

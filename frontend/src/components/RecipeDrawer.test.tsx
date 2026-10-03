import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeList, makeRecipe } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { RecipeCard } from "./RecipeCard";
import { RecipeDrawer } from "./RecipeDrawer";

function renderDrawer(overrides = {}) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const onAsk = vi.fn();
  renderWithProviders(<RecipeDrawer recipe={makeRecipe(overrides)} onClose={onClose} onDeleted={onDeleted} onAsk={onAsk} />);
  return { onClose, onDeleted, onAsk };
}

describe("RecipeCard", () => {
  it("is compact and opens the recipe from its title", async () => {
    mockApi({ "GET /api/list": makeList() });
    const onOpen = vi.fn();
    renderWithProviders(<RecipeCard recipe={makeRecipe()} index={0} onOpen={onOpen} onAsk={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Pancakes" })).toBeInTheDocument();
    expect(screen.getByText("ingredients", { exact: false })).toHaveTextContent("3 ingredients");
    expect(screen.queryByRole("list", { name: /Ingredients for/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pancakes" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});

describe("RecipeCard layout", () => {
  it("shows at most two diet tags and collapses the rest into +N", () => {
    mockApi({ "GET /api/list": makeList() });
    renderWithProviders(
      <RecipeCard recipe={makeRecipe({ diet_tags: ["vegetarian", "vegan", "gluten-free", "contains nuts"] })} index={0} onOpen={vi.fn()} onAsk={vi.fn()} />,
    );
    const tags = screen.getByRole("list", { name: "Diet tags (estimate)" });
    expect(within(tags).getAllByRole("listitem")).toHaveLength(3);
    expect(within(tags).getByText("+2")).toBeInTheDocument();
    expect(within(tags).getByText("gluten-free, contains nuts")).toHaveClass("visually-hidden");
  });

  it("reserves the tag row even without tags", () => {
    mockApi({ "GET /api/list": makeList() });
    const { container } = renderWithProviders(<RecipeCard recipe={makeRecipe({ diet_tags: [] })} index={0} onOpen={vi.fn()} onAsk={vi.fn()} />);
    expect(container.querySelector(".card-tags")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Diet tags (estimate)" })).not.toBeInTheDocument();
  });
});

describe("RecipeDrawer", () => {
  it("is a labelled dialog that takes focus and closes on Escape", async () => {
    mockApi({ "GET /api/list": makeList() });
    const { onClose } = renderDrawer();
    const dialog = screen.getByRole("dialog", { name: "Pancakes" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows scaled quantities from the backend when servings change", async () => {
    const api = mockApi({
      "GET /api/list": makeList(),
      "GET /api/recipes/1/scaled?x=2": { multiplier: 2, lines: ["3 cups flour", "2 eggs", "salt to taste"] },
    });
    renderDrawer();

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
    renderDrawer();
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
    renderDrawer();
    await userEvent.selectOptions(screen.getByLabelText("Servings for Pancakes"), "4");
    await userEvent.click(screen.getByRole("button", { name: /add to list/i }));
    expect(await screen.findByText("Added 3 new items.")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/recipes/1/add-to-list")[0]?.body).toEqual({ multiplier: 4 });
  });

  it("needs two taps to delete", async () => {
    const api = mockApi({ "GET /api/list": makeList(), "DELETE /api/recipes/1": { deleted: 1 } });
    const { onDeleted } = renderDrawer();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.callsTo("DELETE", "/api/recipes/1")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Tap again to delete" }));
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(1));
  });

  it("links to the full recipe page", () => {
    mockApi({ "GET /api/list": makeList() });
    renderDrawer();
    expect(screen.getByRole("link", { name: /Full recipe/ })).toHaveAttribute("href", "/recipes/1");
  });
});

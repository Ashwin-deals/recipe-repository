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
    renderWithProviders(<RecipeCard recipe={makeRecipe()} index={0} onOpen={onOpen} />);
    expect(screen.getByRole("heading", { name: "Pancakes" })).toBeInTheDocument();
    expect(screen.getByText("ingredients", { exact: false })).toHaveTextContent("3 ingredients");
    expect(screen.queryByRole("list", { name: /Ingredients for/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pancakes" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("has no Ask the chef button (the floating launcher replaces it)", () => {
    mockApi({ "GET /api/list": makeList() });
    renderWithProviders(<RecipeCard recipe={makeRecipe()} index={0} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /ask the chef/i })).not.toBeInTheDocument();
  });
});

describe("RecipeCard layout", () => {
  it("shows at most two diet tags and collapses the rest into +N", () => {
    mockApi({ "GET /api/list": makeList() });
    renderWithProviders(
      <RecipeCard recipe={makeRecipe({ diet_tags: ["vegetarian", "vegan", "gluten-free", "contains nuts"] })} index={0} onOpen={vi.fn()} />,
    );
    const tags = screen.getByRole("list", { name: "Diet tags (estimate)" });
    expect(within(tags).getAllByRole("listitem")).toHaveLength(3);
    expect(within(tags).getByText("+2")).toBeInTheDocument();
    expect(within(tags).getByText("gluten-free, contains nuts")).toHaveClass("visually-hidden");
  });

  it("reserves the tag row even without tags", () => {
    mockApi({ "GET /api/list": makeList() });
    const { container } = renderWithProviders(<RecipeCard recipe={makeRecipe({ diet_tags: [] })} index={0} onOpen={vi.fn()} />);
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

  describe("deleting", () => {
    const impact = (removed: number, reduced: number) => ({ "GET /api/recipes/1/list-impact": { removed, reduced } });
    const deleted = (removed: number, reduced: number) => ({
      "DELETE /api/recipes/1": { deleted: 1, list_removed: removed, list_reduced: reduced, counts: { total: 0, checked: 0, open: 0 } },
    });

    it("opens a confirmation that says how many list items come with the recipe", async () => {
      mockApi({ "GET /api/list": makeList(), ...impact(2, 1) });
      renderDrawer();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = screen.getByRole("alertdialog", { name: "Delete “Pancakes”?" });
      expect(dialog).toHaveTextContent("Deleting this recipe will also remove its ingredients from your shopping list.");
      expect(await within(dialog).findByText(/3 items on your list came from this recipe\. 1 is shared/)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
      expect(within(dialog).getByRole("button", { name: "Delete recipe and ingredients" })).toBeInTheDocument();
    });

    it("says only the recipe goes when none of it is on the list", async () => {
      mockApi({ "GET /api/list": makeList(), ...impact(0, 0) });
      renderDrawer();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(await screen.findByText(/only the recipe will be deleted/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete recipe" })).toBeInTheDocument();
    });

    it("Cancel deletes nothing and sends no delete request", async () => {
      const api = mockApi({ "GET /api/list": makeList(), ...impact(3, 0), ...deleted(3, 0) });
      const { onDeleted, onClose } = renderDrawer();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(api.callsTo("DELETE", "/api/recipes/1")).toHaveLength(0);
      expect(onDeleted).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    });

    it("Esc closes only the confirmation, not the drawer, and deletes nothing", async () => {
      const api = mockApi({ "GET /api/list": makeList(), ...impact(3, 0), ...deleted(3, 0) });
      const { onClose } = renderDrawer();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument(); // the drawer
      expect(api.callsTo("DELETE", "/api/recipes/1")).toHaveLength(0);
    });

    it("clicking outside cancels too", async () => {
      const api = mockApi({ "GET /api/list": makeList(), ...impact(3, 0) });
      renderDrawer();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.click(document.querySelector(".dialog-backdrop") as HTMLElement);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(api.callsTo("DELETE", "/api/recipes/1")).toHaveLength(0);
    });

    it("Confirm deletes, refreshes the list and says what was removed", async () => {
      const api = mockApi({ "GET /api/list": makeList(), ...impact(3, 1), ...deleted(3, 1) });
      const { onDeleted } = renderDrawer();
      await vi.waitFor(() => expect(api.callsTo("GET", "/api/list")).toHaveLength(1));
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.click(screen.getByRole("button", { name: "Delete recipe and ingredients" }));
      await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(1));
      expect(api.callsTo("DELETE", "/api/recipes/1")).toHaveLength(1);
      await vi.waitFor(() => expect(api.callsTo("GET", "/api/list")).toHaveLength(2)); // list reloaded
      expect(await screen.findByText("Recipe and 3 list items removed; 1 shared item reduced.")).toBeInTheDocument();
    });

    it("keeps the dialog open with the error if the delete fails", async () => {
      const { reply } = await import("../test/mockApi");
      mockApi({ "GET /api/list": makeList(), ...impact(1, 0), "DELETE /api/recipes/1": reply(500, { error: "Something went wrong on our side." }) });
      const { onDeleted } = renderDrawer();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await userEvent.click(screen.getByRole("button", { name: "Delete recipe and ingredients" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side.");
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(onDeleted).not.toHaveBeenCalled();
    });
  });

  it("links to the full recipe page", () => {
    mockApi({ "GET /api/list": makeList() });
    renderDrawer();
    expect(screen.getByRole("link", { name: /Full recipe/ })).toHaveAttribute("href", "/recipes/1");
  });

  it("offers a small 'Ask about this recipe' link", async () => {
    mockApi({ "GET /api/list": makeList() });
    const { onAsk } = renderDrawer();
    await userEvent.click(screen.getByRole("button", { name: "Ask about this recipe" }));
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});

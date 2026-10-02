import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeList, makeRecipe } from "../test/fixtures";
import { mockApi, reply } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { RecipeForm } from "./RecipeForm";

describe("RecipeForm with snap-a-recipe import", () => {
  it("pre-fills the form from pasted text without saving", async () => {
    const api = mockApi({
      "GET /api/list": makeList(),
      "POST /api/import": {
        recipe: { title: "Banana Bread", prep_time: 15, category: "Dessert", ingredients: ["3 bananas", "1 1/2 cups flour"] },
        source: "basic",
        message: "Gemini isn't configured, so CartChef used its built-in fallback.",
      },
    });
    const onSaved = vi.fn();
    renderWithProviders(<RecipeForm onSaved={onSaved} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Recipe text"), "Banana Bread{enter}3 bananas");
    await userEvent.click(screen.getByRole("button", { name: /fill the form/i }));

    expect(await screen.findByText(/used its built-in fallback/)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Banana Bread");
    expect(screen.getByLabelText("Prep time (minutes)")).toHaveValue(15);
    expect(screen.getByLabelText("Category")).toHaveValue("Dessert");
    expect(screen.getByLabelText(/Ingredients/)).toHaveValue("3 bananas\n1 1/2 cups flour");

    const importBody = api.callsTo("POST", "/api/import")[0]?.body;
    expect(importBody).toBeInstanceOf(FormData);
    expect((importBody as FormData).get("text")).toBe("Banana Bread\n3 bananas");
    expect(api.callsTo("POST", "/api/recipes")).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the friendly message when photo import is unavailable", async () => {
    mockApi({
      "GET /api/list": makeList(),
      "POST /api/import": reply(503, { error: "Photo import needs Gemini, which isn't available right now." }),
    });
    renderWithProviders(<RecipeForm onSaved={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Photo" }));
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "dinner.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/Choose a JPEG/), file);
    await userEvent.click(screen.getByRole("button", { name: /fill the form/i }));
    expect(await screen.findByText(/Photo import needs Gemini/)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("shows server-side field errors and saves once fixed", async () => {
    let attempt = 0;
    const api = mockApi({
      "GET /api/list": makeList(),
      "POST /api/recipes": () => {
        attempt += 1;
        return attempt === 1
          ? reply(400, { error: "Please fix the highlighted fields.", fields: { title: "Give the recipe a title." } })
          : { recipe: makeRecipe({ id: 9, title: "Toast" }) };
      },
    });
    const onSaved = vi.fn();
    renderWithProviders(<RecipeForm onSaved={onSaved} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(await screen.findByText("Give the recipe a title.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");

    await userEvent.type(screen.getByLabelText("Title"), "Toast");
    await userEvent.type(screen.getByLabelText("Prep time (minutes)"), "5");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Breakfast");
    await userEvent.type(screen.getByLabelText(/Ingredients/), "2 slices bread");
    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.callsTo("POST", "/api/recipes")[1]?.body).toEqual({
      title: "Toast", prep_time: "5", category: "Breakfast", ingredients: "2 slices bread",
    });
  });
});

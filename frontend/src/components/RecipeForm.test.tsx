import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeList, makeRecipe } from "../test/fixtures";
import { mockApi, reply } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { RecipeForm } from "./RecipeForm";

const IMPORTED = {
  recipe: { title: "Banana Bread", prep_time: 15, category: "Dessert", ingredients: ["3 bananas", "1 1/2 cups flour"] },
  source: "gemini",
  message: "Imported with AI, please review before saving.",
};

function renderForm(onSaved = vi.fn()) {
  renderWithProviders(<RecipeForm onSaved={onSaved} onCancel={vi.fn()} />);
  return { onSaved };
}

const jpeg = (size = 3) => new File([new Uint8Array(size).fill(0xff)], "dinner.jpg", { type: "image/jpeg" });

beforeEach(() => {
  // jsdom has no object URLs; the preview only needs a string.
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("Snap-a-recipe import", () => {
  it("pre-fills the empty form from pasted text without saving", async () => {
    const api = mockApi({ "GET /api/list": makeList(), "POST /api/import": IMPORTED });
    const { onSaved } = renderForm();

    await userEvent.type(screen.getByLabelText("Or paste recipe text"), "Banana Bread{enter}3 bananas");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText("Imported with AI, please review before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Banana Bread");
    expect(screen.getByLabelText("Prep time (minutes)")).toHaveValue(15);
    expect(screen.getByLabelText("Category")).toHaveValue("Dessert");
    expect(screen.getByLabelText(/^Ingredients/)).toHaveValue("3 bananas\n1 1/2 cups flour");
    expect(screen.getByLabelText("Title")).toHaveFocus();

    const sent = api.callsTo("POST", "/api/import")[0]?.body as FormData;
    expect(sent.get("text")).toBe("Banana Bread\n3 bananas");
    expect(sent.get("image")).toBeNull();
    expect(api.callsTo("POST", "/api/recipes")).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows a thumbnail and sends the photo", async () => {
    const api = mockApi({ "GET /api/list": makeList(), "POST /api/import": IMPORTED });
    renderForm();
    await userEvent.upload(screen.getByLabelText("Choose image"), jpeg());

    expect(screen.getByRole("img", { name: "Selected recipe photo" })).toHaveAttribute("src", "blob:preview");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Imported with AI, please review before saving.");
    expect((api.callsTo("POST", "/api/import")[0]?.body as FormData).get("image")).toBeInstanceOf(File);

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("img", { name: "Selected recipe photo" })).not.toBeInTheDocument();
  });

  it("offers camera capture on mobile", () => {
    mockApi({ "GET /api/list": makeList() });
    renderForm();
    expect(screen.getByLabelText("Take photo")).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("Take photo")).toHaveAttribute("accept", "image/*");
  });

  it.each([
    [new File(["GIF89a"], "anim.gif", { type: "image/gif" }), "Use a JPEG, PNG or WebP image."],
    [jpeg(6 * 1024 * 1024), "That photo is over 5 MB. Try a smaller one."],
  ])("rejects a bad file instantly without uploading", async (file, message) => {
    const api = mockApi({ "GET /api/list": makeList() });
    renderForm();
    await userEvent.upload(screen.getByLabelText("Choose image"), file, { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(api.callsTo("POST", "/api/import")).toHaveLength(0);
  });

  it("asks before importing nothing", async () => {
    const api = mockApi({ "GET /api/list": makeList() });
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a photo or paste some recipe text first.");
    expect(api.callsTo("POST", "/api/import")).toHaveLength(0);
  });

  it("disables the button while importing so it can't be sent twice", async () => {
    let release: () => void = () => undefined;
    const api = mockApi({
      "GET /api/list": makeList(),
      "POST /api/import": () => new Promise((resolve) => { release = () => resolve(IMPORTED); }),
    });
    renderForm();
    await userEvent.type(screen.getByLabelText("Or paste recipe text"), "Banana Bread");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    const busy = await screen.findByRole("button", { name: "Importing…" });
    expect(busy).toBeDisabled();
    expect(screen.getByText("Reading your recipe…")).toBeInTheDocument();
    await userEvent.click(busy);
    release();
    await screen.findByText("Imported with AI, please review before saving.");
    expect(api.callsTo("POST", "/api/import")).toHaveLength(1);
  });

  it("shows errors without touching the form", async () => {
    mockApi({
      "GET /api/list": makeList(),
      "POST /api/import": reply(503, { error: "Photo import needs the AI service, which isn't available right now." }),
    });
    renderForm();
    await userEvent.type(screen.getByLabelText("Title"), "My own title");
    await userEvent.upload(screen.getByLabelText("Choose image"), jpeg());
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Photo import needs the AI service");
    expect(screen.getByLabelText("Title")).toHaveValue("My own title");
    expect(screen.getByLabelText(/^Ingredients/)).toHaveValue("");
  });

  it("asks before replacing what the user typed, and can replace", async () => {
    mockApi({ "GET /api/list": makeList(), "POST /api/import": IMPORTED });
    renderForm();
    await userEvent.type(screen.getByLabelText("Title"), "Mum's bread");
    await userEvent.type(screen.getByLabelText("Or paste recipe text"), "Banana Bread");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    const replace = await screen.findByRole("button", { name: "Replace with import" });
    expect(screen.getByText(/would replace what you've already typed in/)).toHaveTextContent("Title");
    expect(replace).toHaveFocus();
    expect(screen.getByLabelText("Title")).toHaveValue("Mum's bread"); // untouched until the user decides

    await userEvent.click(replace);
    expect(screen.getByLabelText("Title")).toHaveValue("Banana Bread");
    expect(screen.queryByRole("button", { name: "Replace with import" })).not.toBeInTheDocument();
  });

  it("can keep the user's entries and fill only the empty fields", async () => {
    mockApi({ "GET /api/list": makeList(), "POST /api/import": IMPORTED });
    renderForm();
    await userEvent.type(screen.getByLabelText("Title"), "Mum's bread");
    await userEvent.type(screen.getByLabelText("Or paste recipe text"), "Banana Bread");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await userEvent.click(await screen.findByRole("button", { name: "Keep mine, fill empty fields" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Mum's bread");
    expect(screen.getByLabelText("Category")).toHaveValue("Dessert");
    expect(screen.getByLabelText(/^Ingredients/)).toHaveValue("3 bananas\n1 1/2 cups flour");
  });

  it("labels fallback results so the user knows AI wasn't used", async () => {
    mockApi({
      "GET /api/list": makeList(),
      "POST /api/import": {
        ...IMPORTED,
        source: "fallback",
        message: "Filled in with the basic text parser (AI isn't available), please review before saving.",
      },
    });
    renderForm();
    await userEvent.type(screen.getByLabelText("Or paste recipe text"), "Banana Bread");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText(/basic text parser/)).toBeInTheDocument();
  });
});

describe("Saving the recipe", () => {
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
    const { onSaved } = renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(await screen.findByText("Give the recipe a title.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");

    await userEvent.type(screen.getByLabelText("Title"), "Toast");
    await userEvent.type(screen.getByLabelText("Prep time (minutes)"), "5");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Breakfast");
    await userEvent.type(screen.getByLabelText(/^Ingredients/), "2 slices bread");
    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.callsTo("POST", "/api/recipes")[1]?.body).toEqual({
      title: "Toast", prep_time: "5", category: "Breakfast", ingredients: "2 slices bread",
    });
  });
});

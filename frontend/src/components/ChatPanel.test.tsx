import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useChat } from "../hooks/useChat";
import { makeList, makeRecipe } from "../test/fixtures";
import { mockApi, networkDown, reply } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import type { ChatResult, Recipe } from "../types";
import { ChatWidget } from "./ChatWidget";

const recipe = makeRecipe({ id: 3, title: "Butter Chicken", category: "Dinner", prep_time: 40, lines: ["500 g chicken", "3 tbsp butter", "1 cup cream"] });

const answer = (overrides: Partial<ChatResult> = {}): ChatResult => ({
  reply: "Swap the butter for olive oil.", proposal: null, shopping_items: [], source: "gemini", ...overrides,
});

const vegan = answer({
  reply: "Here's a vegan version.",
  proposal: { title: "Vegan Butter Chicken", prep_time: 35, category: "Dinner", ingredients: ["400 g tofu", "3 tbsp butter", "1 cup coconut cream"] },
});

const base = { "GET /api/list": makeList(), "GET /api/recipes": { recipes: [recipe] } };

/** Opens the chat the way the recipe drawer does, with or without a recipe. */
function OpenChat({ about }: { about: Recipe | null }) {
  const { openChat } = useChat();
  useEffect(() => {
    openChat({ recipe: about });
  }, [openChat, about]);
  return null;
}

async function renderChat(withRecipe = true) {
  renderWithProviders(
    <>
      <OpenChat about={withRecipe ? recipe : null} />
      <ChatWidget />
    </>,
  );
  const dialog = await screen.findByRole("dialog", { name: "Ask the chef" });
  return { dialog, input: () => screen.getByLabelText("Message the chef") };
}

describe("ChatPanel", () => {
  it("is a labelled, non-modal dialog with the recipe context and the safety note", async () => {
    mockApi(base);
    const { dialog, input } = await renderChat();
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(within(dialog).getByLabelText("About:")).toHaveDisplayValue("Butter Chicken");
    expect(within(dialog).getByText("AI suggestions can be wrong. Check ingredients for allergies.")).toBeInTheDocument();
    expect(input()).toHaveFocus();
  });

  it("sends with Enter, shows the reply, and sends history on the next turn", async () => {
    const api = mockApi({ ...base, "POST /api/chat": answer() });
    const { input } = await renderChat();
    await userEvent.type(input(), "No butter, what can I use?{Enter}");

    const log = screen.getByRole("log", { name: "Conversation" });
    expect(await within(log).findByText("Swap the butter for olive oil.")).toBeInTheDocument();
    expect(within(log).getByText("No butter, what can I use?")).toBeInTheDocument();
    expect(input()).toHaveValue("");
    expect(api.callsTo("POST", "/api/chat")[0]?.body).toEqual({ message: "No butter, what can I use?", recipe_id: 3, history: [] });

    await userEvent.type(input(), "And for the cream?{Enter}");
    await vi.waitFor(() => expect(api.callsTo("POST", "/api/chat")).toHaveLength(2));
    expect(api.callsTo("POST", "/api/chat")[1]?.body).toEqual({
      message: "And for the cream?",
      recipe_id: 3,
      history: [
        { role: "user", text: "No butter, what can I use?" },
        { role: "assistant", text: "Swap the butter for olive oil." },
      ],
    });
  });

  it("uses Shift+Enter for a new line and counts characters", async () => {
    const api = mockApi(base);
    const { input } = await renderChat();
    await userEvent.type(input(), "line one{Shift>}{Enter}{/Shift}line two");
    expect(input()).toHaveValue("line one\nline two");
    expect(screen.getByText("17/500")).toBeInTheDocument();
    expect(input()).toHaveAttribute("maxLength", "500");
    expect(api.callsTo("POST", "/api/chat")).toHaveLength(0);
  });

  it("shows the typing indicator and status, and blocks sending while waiting", async () => {
    let release: () => void = () => undefined;
    mockApi({ ...base, "POST /api/chat": () => new Promise((resolve) => { release = () => resolve(answer()); }) });
    const { dialog, input } = await renderChat();
    await userEvent.type(input(), "Make it vegan{Enter}");
    expect(await screen.findByText("The chef is typing…")).toBeInTheDocument();
    expect(within(dialog).getByText("Cooking up ideas…")).toBeInTheDocument();
    await userEvent.type(input(), "again");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scale for 6 people" })).toBeDisabled();
    release();
    expect(await screen.findByText("Swap the butter for olive oil.")).toBeInTheDocument();
    expect(screen.queryByText("The chef is typing…")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Cooking up ideas…")).not.toBeInTheDocument();
  });

  it("shows an error bubble with a retry that resends the same message", async () => {
    let fail = true;
    const api = mockApi({
      ...base,
      "POST /api/chat": () => (fail ? reply(504, { error: "The AI chef took too long to answer. Please try again." }) : answer()),
    });
    const { input } = await renderChat();
    await userEvent.type(input(), "Make it vegan{Enter}");
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("took too long");

    fail = false;
    await userEvent.click(within(error).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Swap the butter for olive oil.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("Make it vegan", { selector: ".bubble-text" })).toHaveLength(1);
    expect(api.callsTo("POST", "/api/chat")[1]?.body).toMatchObject({ message: "Make it vegan", history: [] });
  });

  it("reports when offline", async () => {
    mockApi({ ...base, "POST /api/chat": () => networkDown() });
    const { input } = await renderChat();
    await userEvent.type(input(), "hello{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("You're offline");
  });

  it("sends a suggested chip as a message", async () => {
    const api = mockApi({ ...base, "POST /api/chat": answer() });
    await renderChat();
    const chips = screen.getByRole("group", { name: "Suggested questions" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Make it vegan", "What can I use instead of buttermilk?", "Scale for 6 people", "What can I cook with eggs and tomatoes?",
    ]);
    await userEvent.click(within(chips).getByRole("button", { name: "What can I use instead of buttermilk?" }));
    await vi.waitFor(() => expect(api.callsTo("POST", "/api/chat")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/chat")[0]?.body).toMatchObject({ message: "What can I use instead of buttermilk?", recipe_id: 3 });
  });

  it("previews a proposal before and after, and saves nothing until a button is clicked", async () => {
    const api = mockApi({ ...base, "POST /api/chat": vegan });
    await renderChat();
    await userEvent.click(screen.getByRole("button", { name: "Make it vegan" }));

    const proposal = await screen.findByRole("region", { name: "Proposed recipe: Vegan Butter Chicken" });
    expect(within(proposal).getByText("Butter Chicken", { selector: "del" })).toBeInTheDocument();
    expect(within(proposal).getByText("Vegan Butter Chicken", { selector: "ins" })).toBeInTheDocument();
    const lines = within(proposal).getByRole("list", { name: "Ingredients in the proposal" });
    expect(within(lines).getByText("400 g tofu").closest("li")).toHaveClass("is-added");
    expect(within(lines).getByText("3 tbsp butter").closest("li")).not.toHaveClass("is-added");
    expect(within(lines).getByText("500 g chicken").closest("li")).toHaveClass("is-removed");
    expect(within(proposal).getByLabelText("Prep (min)")).toHaveValue(35);

    expect(api.calls.filter((c) => c.method !== "GET" && c.path !== "/api/chat")).toHaveLength(0);
  });

  it("applies a proposal as a new recipe and links to it", async () => {
    const api = mockApi({
      ...base,
      "POST /api/chat": vegan,
      "POST /api/recipes": { recipe: makeRecipe({ id: 10, title: "Vegan Butter Chicken" }) },
    });
    await renderChat();
    await userEvent.click(screen.getByRole("button", { name: "Make it vegan" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply as new recipe" }));

    const saved = await screen.findByText("Saved “Vegan Butter Chicken” as a new recipe.", { selector: ".proposal-saved", exact: false });
    expect(within(saved).getByRole("link", { name: "Open recipe" })).toHaveAttribute("href", "/recipes/10");
    expect(api.callsTo("POST", "/api/recipes")[0]?.body).toEqual({
      title: "Vegan Butter Chicken", prep_time: "35", category: "Dinner", ingredients: "400 g tofu\n3 tbsp butter\n1 cup coconut cream",
    });
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(screen.queryByRole("button", { name: "Apply as new recipe" })).not.toBeInTheDocument();
  });

  it("replaces the current recipe and keeps chatting about the new version", async () => {
    const replaced = makeRecipe({ id: 3, title: "Vegan Butter Chicken", category: "Dinner" });
    const api = mockApi({ ...base, "POST /api/chat": vegan, "PUT /api/recipes/3": { recipe: replaced } });
    const { dialog } = await renderChat();
    await userEvent.click(screen.getByRole("button", { name: "Make it vegan" }));
    await userEvent.click(await screen.findByRole("button", { name: "Replace this recipe" }));
    await vi.waitFor(() => expect(api.callsTo("PUT", "/api/recipes/3")).toHaveLength(1));
    expect(api.callsTo("PUT", "/api/recipes/3")[0]?.body).toMatchObject({ title: "Vegan Butter Chicken" });
    expect(api.callsTo("POST", "/api/recipes")).toHaveLength(0);
    await vi.waitFor(() => expect(within(dialog).getByLabelText("About:")).toHaveDisplayValue("Vegan Butter Chicken"));
  });

  it("dismisses a proposal without saving", async () => {
    const api = mockApi({ ...base, "POST /api/chat": vegan });
    await renderChat();
    await userEvent.click(screen.getByRole("button", { name: "Make it vegan" }));
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.getByText("Suggestion dismissed.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path.startsWith("/api/recipes") && c.method !== "GET")).toHaveLength(0);
  });

  it("asks for a prep time when a general-mode proposal has none", async () => {
    const api = mockApi({
      ...base,
      "POST /api/chat": answer({ proposal: { title: "Tomato Eggs", prep_time: null, category: "Breakfast", ingredients: ["4 eggs", "2 tomatoes"] } }),
      "POST /api/recipes": { recipe: makeRecipe({ id: 11, title: "Tomato Eggs" }) },
    });
    const { dialog } = await renderChat(false);
    expect(within(dialog).getByLabelText("About:")).toHaveDisplayValue("All recipes");
    expect(screen.queryByRole("button", { name: "Make it vegan" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "What can I cook with eggs and tomatoes?" }));
    expect(api.callsTo("POST", "/api/chat")[0]?.body).toMatchObject({ recipe_id: null });
    expect(screen.queryByRole("button", { name: "Replace this recipe" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Apply as new recipe" }));
    expect(await screen.findByText("Add a prep time first.")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/recipes")).toHaveLength(0);

    await userEvent.type(screen.getByLabelText("Prep (min)"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Apply as new recipe" }));
    await vi.waitFor(() => expect(api.callsTo("POST", "/api/recipes")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/recipes")[0]?.body).toMatchObject({ prep_time: "20", category: "Breakfast" });
  });

  it("adds suggested shopping items only when clicked", async () => {
    const api = mockApi({
      ...base,
      "POST /api/chat": answer({ reply: "You'll need these.", shopping_items: ["400 g tofu", "1 can coconut milk"] }),
      "POST /api/list/items": { added: 1, merged: 0, counts: { total: 1, checked: 0, open: 1 } },
    });
    const { input } = await renderChat();
    await userEvent.type(input(), "What do I need to buy?{Enter}");
    const items = await screen.findByRole("region", { name: "Suggested shopping items" });
    expect(api.callsTo("POST", "/api/list/items")).toHaveLength(0);

    await userEvent.click(within(items).getByRole("button", { name: "Add 400 g tofu to list" }));
    await vi.waitFor(() => expect(api.callsTo("POST", "/api/list/items")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/list/items")[0]?.body).toEqual({ line: "400 g tofu" });
    expect(await within(items).findByText("Added")).toBeInTheDocument();
    expect(within(items).queryByRole("button", { name: /Add all/ })).not.toBeInTheDocument(); // one left
  });

  it("clears the chat and labels fallback answers", async () => {
    mockApi({ ...base, "POST /api/chat": answer({ reply: "The AI chef isn't available right now.", source: "fallback" }) });
    const { input } = await renderChat();
    await userEvent.type(input(), "hello{Enter}");
    const bubble = (await screen.findByText("The AI chef isn't available right now.")).closest(".bubble");
    expect(bubble).toHaveClass("bubble-fallback");
    await userEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(screen.queryByText("hello", { selector: ".bubble-text" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear chat" })).toBeDisabled();
  });

  it("changes the recipe context from the dropdown and notes it in the log", async () => {
    const pasta = makeRecipe({ id: 8, title: "Pasta Bake", category: "Dinner" });
    const api = mockApi({ ...base, "GET /api/recipes": { recipes: [recipe, pasta] }, "POST /api/chat": answer() });
    const { dialog, input } = await renderChat();
    await userEvent.type(input(), "hi{Enter}");
    await screen.findByText("Swap the butter for olive oil.");

    const context = within(dialog).getByLabelText("About:");
    await within(context).findByRole("option", { name: "Pasta Bake" });
    await userEvent.selectOptions(context, "Pasta Bake");
    expect(within(dialog).getByText("Now asking about Pasta Bake.")).toBeInTheDocument();

    await userEvent.type(input(), "make it creamier{Enter}");
    await vi.waitFor(() => expect(api.callsTo("POST", "/api/chat")).toHaveLength(2));
    // Notes are not part of the history sent to the model.
    expect(api.callsTo("POST", "/api/chat")[1]?.body).toEqual({
      message: "make it creamier",
      recipe_id: 8,
      history: [
        { role: "user", text: "hi" },
        { role: "assistant", text: "Swap the butter for olive oil." },
      ],
    });
  });
});

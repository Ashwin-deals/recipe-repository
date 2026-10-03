import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeList, makeRecipe } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp } from "../test/renderApp";
import type { ChatResult } from "../types";

const pancakes = makeRecipe({ id: 1, title: "Pancakes" });
const curry = makeRecipe({ id: 2, title: "Chicken Curry", category: "Dinner" });
const reply: ChatResult = { reply: "Try oat milk.", proposal: null, shopping_items: [], source: "gemini" };
const routes = {
  "GET /api/recipes": { recipes: [pancakes, curry] },
  "GET /api/recipes/1": { recipe: pancakes },
  "GET /api/list": makeList(),
  "GET /api/planner": { plan: {}, days: [] },
  "POST /api/chat": reply,
};

const launcher = () => screen.getByRole("button", { name: /Ask the chef|Close Ask the chef/ });
const chat = () => screen.queryByRole("dialog", { name: "Ask the chef" });

describe("Ask the chef widget", () => {
  it("opens from the launcher, focuses the input, and closes with the launcher", async () => {
    mockApi(routes);
    renderApp();
    expect(launcher()).toHaveAttribute("aria-expanded", "false");
    expect(chat()).not.toBeInTheDocument();

    await userEvent.click(launcher());
    const dialog = await screen.findByRole("dialog", { name: "Ask the chef" });
    expect(launcher()).toHaveAttribute("aria-expanded", "true");
    expect(launcher()).toHaveAccessibleName("Close Ask the chef");
    expect(launcher()).toHaveAttribute("aria-controls", dialog.id);
    expect(within(dialog).getByLabelText("Message the chef")).toHaveFocus();

    await userEvent.click(launcher());
    expect(chat()).not.toBeInTheDocument(); // hidden from assistive tech while it animates out
    expect(launcher()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and with Minimize, returning focus to the launcher", async () => {
    mockApi(routes);
    renderApp();
    await userEvent.click(launcher());
    await screen.findByRole("dialog", { name: "Ask the chef" });
    await userEvent.keyboard("{Escape}");
    expect(chat()).not.toBeInTheDocument();
    expect(launcher()).toHaveFocus();

    await userEvent.click(launcher());
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Ask the chef" })).getByRole("button", { name: "Minimize chat" }));
    expect(chat()).not.toBeInTheDocument();
    expect(launcher()).toHaveFocus();
  });

  it("keeps the conversation across pages", async () => {
    mockApi(routes);
    renderApp();
    await userEvent.click(launcher());
    await userEvent.type(await screen.findByLabelText("Message the chef"), "dairy-free swaps?{Enter}");
    expect(await screen.findByText("Try oat milk.")).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: /Planner/ }));
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Ask the chef" });
    expect(within(dialog).getByText("Try oat milk.")).toBeInTheDocument();
    expect(within(dialog).getByText("dairy-free swaps?")).toBeInTheDocument();
  });

  it("opens about a recipe from the drawer's 'Ask about this recipe' link", async () => {
    const api = mockApi(routes);
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Chicken Curry" }));
    const drawer = screen.getByRole("dialog", { name: "Chicken Curry" });
    await userEvent.click(within(drawer).getByRole("button", { name: "Ask about this recipe" }));

    const dialog = await screen.findByRole("dialog", { name: "Ask the chef" });
    expect(screen.queryByRole("dialog", { name: "Chicken Curry" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("About:")).toHaveDisplayValue("Chicken Curry");
    await userEvent.type(within(dialog).getByLabelText("Message the chef"), "less spicy?{Enter}");
    await vi.waitFor(() => expect(api.callsTo("POST", "/api/chat")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/chat")[0]?.body).toMatchObject({ recipe_id: 2 });
  });

  it("opens about the recipe from the full recipe page", async () => {
    mockApi(routes);
    renderApp("/recipes/1");
    await userEvent.click(await screen.findByRole("button", { name: "Ask about this recipe" }));
    const dialog = await screen.findByRole("dialog", { name: "Ask the chef" });
    expect(within(dialog).getByLabelText("About:")).toHaveDisplayValue("Pancakes");
  });

  it("shows an unread dot when the chef answers while the panel is closed", async () => {
    let release: () => void = () => undefined;
    mockApi({ ...routes, "POST /api/chat": () => new Promise((resolve) => { release = () => resolve(reply); }) });
    renderApp();
    await userEvent.click(launcher());
    await userEvent.type(await screen.findByLabelText("Message the chef"), "hello{Enter}");
    await userEvent.keyboard("{Escape}");
    release();
    await vi.waitFor(() => expect(launcher()).toHaveAccessibleName("Ask the chef (new reply)"));

    await userEvent.click(launcher());
    expect(launcher()).toHaveAccessibleName("Close Ask the chef");
    expect(within(await screen.findByRole("dialog", { name: "Ask the chef" })).getByText("Try oat milk.")).toBeInTheDocument();
  });

  it("remembers the conversation and open state for the session", async () => {
    mockApi(routes);
    const first = renderApp();
    await userEvent.click(launcher());
    await userEvent.type(await screen.findByLabelText("Message the chef"), "hello{Enter}");
    await screen.findByText("Try oat milk.");
    first.unmount();

    renderApp();
    const dialog = await screen.findByRole("dialog", { name: "Ask the chef" });
    expect(within(dialog).getByText("Try oat milk.")).toBeInTheDocument();
    // A restored panel doesn't steal focus on page load.
    expect(within(dialog).getByLabelText("Message the chef")).not.toHaveFocus();
  });

  it("starts fresh if the saved session is unreadable", async () => {
    sessionStorage.setItem("cartchef:chat", "{not json");
    mockApi(routes);
    renderApp();
    await userEvent.click(launcher());
    const dialog = await screen.findByRole("dialog", { name: "Ask the chef" });
    expect(within(dialog).getByRole("button", { name: "Clear chat" })).toBeDisabled();
  });

  it("shows the label bubble once, on the first visit", () => {
    mockApi(routes);
    const first = renderApp();
    expect(document.querySelector(".launcher-tip")).toHaveClass("is-shown");
    first.unmount();
    renderApp();
    expect(document.querySelector(".launcher-tip")).not.toHaveClass("is-shown");
  });
});

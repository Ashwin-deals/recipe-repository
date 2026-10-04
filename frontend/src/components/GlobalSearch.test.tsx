import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeItem, makeList, makeRecipe } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp } from "../test/renderApp";

const pancakes = makeRecipe({ id: 1, title: "Pancakes", lines: ["1 cup flour", "2 eggs", "1 cup buttermilk"], diet_tags: ["vegetarian"] });
const curry = makeRecipe({ id: 2, title: "Chicken Curry", category: "Dinner", prep_time: 45, lines: ["500 g chicken", "2 onions"], diet_tags: ["gluten-free"] });
const cookies = makeRecipe({ id: 3, title: "Egg-free Cookies", category: "Dessert", prep_time: 30, lines: ["2 cups flour", "1 cup sugar"], diet_tags: ["vegan"] });
const list = makeList([makeItem({ id: 7, label: "500 g chicken thighs", name: "chicken thighs", amount: "500 g", aisle: "Meat & Seafood" })]);
const routes = { "GET /api/recipes": { recipes: [pancakes, curry, cookies] }, "GET /api/list": list, "GET /api/planner": { plan: {}, days: [] } };

const searchBox = () => screen.getByRole("combobox", { name: /search recipes/i });
const location = () => screen.getByTestId("location").textContent;
const header = () => within(screen.getByRole("search"));
/** Result options (the Planner page has its own <option>s, so look only inside the results). */
const result = async (name: RegExp) => within(await screen.findByRole("listbox", { name: "Search results" })).findByRole("option", { name });

describe("Header search", () => {
  it("focuses with / unless you are typing somewhere else", async () => {
    mockApi(routes);
    await renderApp();
    await screen.findByRole("button", { name: "Pancakes" });
    await userEvent.keyboard("/");
    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toHaveValue("");

    // In another field, "/" is just a character.
    const addItem = screen.getByPlaceholderText(/Add an item/);
    await userEvent.click(addItem);
    await userEvent.keyboard("/");
    expect(addItem).toHaveValue("/");
  });

  it("shows grouped, highlighted results for recipes and list items", async () => {
    mockApi(routes);
    await renderApp();
    await userEvent.type(searchBox(), "chicken");
    const results = await screen.findByRole("listbox", { name: "Search results" });
    expect(searchBox()).toHaveAttribute("aria-expanded", "true");

    const recipes = within(results).getByRole("group", { name: "Recipes" });
    const option = within(recipes).getByRole("option", { name: /Chicken Curry/ });
    expect(option).toHaveTextContent("Dinner");
    expect(option).toHaveTextContent("45 min");
    expect(within(option).getByText("Chicken", { selector: "mark" })).toBeInTheDocument();

    const items = within(results).getByRole("group", { name: "On your list" });
    expect(within(items).getByRole("option", { name: /chicken thighs/ })).toHaveTextContent("500 g");
  });

  it("matches ingredients, categories and diet tags", async () => {
    mockApi(routes);
    await renderApp("/planner");
    await userEvent.type(searchBox(), "buttermilk");
    const option = await result(/Pancakes/);
    expect(option).toHaveTextContent("Ingredient · 1 cup buttermilk");

    await userEvent.clear(searchBox());
    await userEvent.type(searchBox(), "vegan");
    await vi.waitFor(async () => expect(await result(/Egg-free Cookies/)).toHaveTextContent("Tag · vegan"));

    await userEvent.clear(searchBox());
    await userEvent.type(searchBox(), "dessert");
    // Results update once the debounce settles.
    await vi.waitFor(async () => expect(await result(/Egg-free Cookies/)).toHaveTextContent("Category · Dessert"));
  });

  it("moves through results with the arrow keys and opens a recipe's drawer with Enter", async () => {
    mockApi(routes);
    await renderApp("/planner");
    await userEvent.type(searchBox(), "chicken");
    await result(/Chicken Curry/);

    await userEvent.keyboard("{ArrowDown}");
    const first = within(screen.getByRole("listbox")).getByRole("option", { name: /Chicken Curry/ });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(searchBox()).toHaveAttribute("aria-activedescendant", first.id);

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: /See all 1 matching recipes/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}{Enter}");

    expect(await screen.findByRole("dialog", { name: "Chicken Curry" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(location()).toBe("/planner");
  });

  it("goes to the list when a list item is chosen", async () => {
    mockApi(routes);
    await renderApp();
    await userEvent.type(searchBox(), "thighs");
    await userEvent.click(await result(/chicken thighs/));
    expect(location()).toBe("/shopping");
  });

  it("filters the recipe grid live and keeps the query in the URL", async () => {
    mockApi(routes);
    await renderApp();
    await screen.findByRole("button", { name: "Pancakes" });
    await userEvent.type(searchBox(), "curry");
    await vi.waitFor(() => expect(location()).toBe("/?q=curry"));
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1 of 3 recipes for “curry”");
    expect(screen.queryByRole("button", { name: "Pancakes" })).not.toBeInTheDocument();

    // "Clear search" on the page empties the header box too.
    await userEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "Clear search" }));
    await vi.waitFor(() => expect(location()).toBe("/"));
    expect(searchBox()).toHaveValue("");
    expect(await screen.findByRole("button", { name: "Pancakes" })).toBeInTheDocument();
  });

  it("reads the query from the URL on load", async () => {
    mockApi(routes);
    await renderApp("/?q=cookies");
    expect(searchBox()).toHaveValue("cookies");
    expect(await screen.findByRole("button", { name: "Egg-free Cookies" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pancakes" })).not.toBeInTheDocument();
  });

  it("clears with the x button and with Escape", async () => {
    mockApi(routes);
    await renderApp();
    await userEvent.type(searchBox(), "curry");
    await screen.findByRole("listbox");
    await userEvent.click(header().getByRole("button", { name: "Clear search" }));
    expect(searchBox()).toHaveValue("");
    expect(searchBox()).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await userEvent.type(searchBox(), "curry");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Escape}");
    expect(searchBox()).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(location()).toBe("/"));
  });

  it("offers Ask the chef when nothing matches", async () => {
    mockApi(routes);
    await renderApp("/planner");
    await userEvent.type(searchBox(), "eggs and tomatoes");
    expect(await screen.findByText("No matches.", { selector: ".search-empty" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");

    const chat = await screen.findByRole("dialog", { name: "Ask the chef" });
    expect(within(chat).getByLabelText("Message the chef")).toHaveValue("eggs and tomatoes");
  });

  it("shows a loading state until recipes arrive", async () => {
    let release: () => void = () => undefined;
    mockApi({ ...routes, "GET /api/recipes": () => new Promise((resolve) => { release = () => resolve({ recipes: [curry] }); }) });
    await renderApp("/planner");
    await userEvent.type(searchBox(), "curry");
    expect(await screen.findByText("Searching recipes…")).toBeInTheDocument();
    release();
    expect(await result(/Chicken Curry/)).toBeInTheDocument();
    expect(screen.queryByText("Searching recipes…")).not.toBeInTheDocument();
  });
});

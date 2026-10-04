import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../api/client";
import { QUEUE_KEY } from "../lib/offlineQueue";
import { OWNER_KEY } from "../lib/session";
import { mockApi, reply, TEST_USER } from "../test/mockApi";
import { renderApp } from "../test/renderApp";

const EMPTY_LIST = { groups: [], counts: { total: 0, checked: 0, open: 0 } };
const RECIPE = {
  id: 7, title: "Private Pie", prep_time: 10, category: "Dessert", ingredients: "1 apple", lines: ["1 apple"],
  nutrition: null, diet_tags: [], created_at: "2026-10-01 10:00:00",
};
const location = () => screen.getByTestId("location").textContent;

describe("signed-in session", () => {
  it("sends you to sign in with a message when the session expires", async () => {
    let expired = false;
    mockApi({
      "GET /api/recipes": () => (expired ? reply(401, { error: "Please sign in to continue.", code: "auth" }) : { recipes: [RECIPE] }),
      "GET /api/list": EMPTY_LIST,
    });
    await renderApp("/");
    expect(await screen.findByText("Private Pie")).toBeInTheDocument();
    expired = true;
    await api.get("/api/recipes").catch(() => undefined);
    expect(await screen.findByText("Your session expired. Please sign in again.")).toBeInTheDocument();
    expect(location()).toBe("/login");
    expect(screen.queryByText("Private Pie")).not.toBeInTheDocument();
  });

  it("signing out clears data, the offline queue, the chat and cached API responses", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", { delete: async (name: string) => (deleted.push(name), true), keys: async () => [] });
    const mock = mockApi({
      "GET /api/recipes": { recipes: [RECIPE] },
      "GET /api/list": EMPTY_LIST,
      "POST /api/auth/logout": { signed_out: true, csrf_token: "anon" },
    });
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ 5: true }));
    sessionStorage.setItem("cartchef:chat", JSON.stringify({ open: false, messages: [], recipe: null }));
    localStorage.setItem("cartchef:theme", "dark");
    const user = userEvent.setup();
    await renderApp("/");
    expect(await screen.findByText("Private Pie")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Account menu for Test Cook/ }));
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(menu).toHaveTextContent(TEST_USER.email);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(location()).toBe("/login"));
    expect(mock.callsTo("POST", "/api/auth/logout")).toHaveLength(1);
    expect(screen.queryByText("Private Pie")).not.toBeInTheDocument();
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
    expect(sessionStorage.getItem("cartchef:chat")).toBeNull();
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
    expect(localStorage.getItem("cartchef:theme")).toBe("dark"); // a device preference, not account data
    expect(deleted).toContain("cartchef-api");
  });

  it("drops another user's offline data before showing the app", async () => {
    mockApi({ "GET /api/recipes": { recipes: [] }, "GET /api/list": EMPTY_LIST });
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ 99: true }));
    localStorage.setItem(OWNER_KEY, "42"); // someone else
    const { render, screen: s } = await import("@testing-library/react");
    const { MemoryRouter } = await import("react-router-dom");
    const { default: App } = await import("../App");
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await s.findByRole("button", { name: /Account menu/ });
    expect(localStorage.getItem(QUEUE_KEY) ?? "{}").toBe("{}");
    expect(localStorage.getItem(OWNER_KEY)).toBe(String(TEST_USER.id));
  });

  it("the account menu works from the keyboard", async () => {
    mockApi({ "GET /api/recipes": { recipes: [] }, "GET /api/list": EMPTY_LIST });
    const user = userEvent.setup();
    await renderApp("/");
    const avatar = screen.getByRole("button", { name: /Account menu/ });
    expect(avatar).toHaveTextContent("TC");
    avatar.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Delete account/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();
  });

  it("deleting the account asks for the password and confirms", async () => {
    let attempts = 0;
    const mock = mockApi({
      "GET /api/recipes": { recipes: [] },
      "GET /api/list": EMPTY_LIST,
      "DELETE /api/auth/account": () =>
        ++attempts === 1
          ? reply(403, { error: "That password is incorrect.", fields: { password: "That password is incorrect." }, code: "bad_password" })
          : { deleted: true, csrf_token: "anon" },
    });
    const user = userEvent.setup();
    await renderApp("/");
    await user.click(screen.getByRole("button", { name: /Account menu/ }));
    await user.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    expect(dialog).toHaveTextContent("can't be undone");

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByText("Enter your password to confirm.")).toBeInTheDocument();
    expect(mock.callsTo("DELETE", "/api/auth/account")).toHaveLength(0);

    await user.type(screen.getByLabelText("Your password"), "wrong one");
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    expect(await screen.findByText("That password is incorrect.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Your password"));
    await user.type(screen.getByLabelText("Your password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(location()).toBe("/login"));
    expect(screen.getByText(/account and everything in it has been deleted/)).toBeInTheDocument();
    expect(mock.callsTo("DELETE", "/api/auth/account")[1]?.body).toEqual({ password: "correct horse battery" });
  });

  it("cancelling the delete dialog keeps the account", async () => {
    const mock = mockApi({ "GET /api/recipes": { recipes: [] }, "GET /api/list": EMPTY_LIST });
    const user = userEvent.setup();
    await renderApp("/");
    await user.click(screen.getByRole("button", { name: /Account menu/ }));
    await user.click(screen.getByRole("menuitem", { name: /Delete account/ }));
    await user.click(screen.getByRole("button", { name: "Keep my account" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.callsTo("DELETE", "/api/auth/account")).toHaveLength(0);
  });

  it("the shared demo account is labelled and can't be deleted", async () => {
    mockApi({
      "GET /api/auth/me": { user: { ...TEST_USER, is_demo: true, display_name: "Demo Kitchen", initials: "DK" }, csrf_token: "t" },
      "GET /api/recipes": { recipes: [] },
      "GET /api/list": EMPTY_LIST,
    });
    const user = userEvent.setup();
    await renderApp("/");
    await user.click(screen.getByRole("button", { name: /Account menu for Demo Kitchen/ }));
    expect(screen.getByRole("menu")).toHaveTextContent("Shared demo account");
    expect(screen.queryByRole("menuitem", { name: /Delete account/ })).not.toBeInTheDocument();
  });
});

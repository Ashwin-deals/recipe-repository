import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { passwordStrength } from "../lib/password";
import { LocationProbe } from "../test/LocationProbe";
import { mockApi, reply, TEST_USER } from "../test/mockApi";

const signedOut = { "GET /api/auth/me": { user: null, csrf_token: "anon-token" } };
const signedIn = { user: TEST_USER, csrf_token: "session-token" };

function renderAt(route: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[state ? { pathname: route, state } : route]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId("location").textContent;
const submitButton = () => within(screen.getByRole("form")).getByRole("button", { name: /^(Sign in|Create account)$/ });

describe("sign in and sign up", () => {
  it("starts on the sign-in form with focus in the email field", async () => {
    mockApi(signedOut);
    renderAt("/login");
    const email = await screen.findByLabelText("Email");
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("shows inline errors after blur, not before", async () => {
    mockApi(signedOut);
    const user = userEvent.setup();
    renderAt("/login");
    const email = await screen.findByLabelText("Email");
    await user.type(email, "not-an-email");
    expect(screen.queryByText(/valid email/)).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText(/Enter a valid email address/)).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("signs in with Enter, shows loading, then opens the app", async () => {
    let resolve: (value: unknown) => void = () => {};
    const mock = mockApi({
      ...signedOut,
      "POST /api/auth/login": () => new Promise((r) => (resolve = r)),
      "GET /api/recipes": { recipes: [] },
      "GET /api/list": { groups: [], counts: { total: 0, checked: 0, open: 0 } },
    });
    const user = userEvent.setup();
    renderAt("/login");
    await user.type(await screen.findByLabelText("Email"), "cook@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery{Enter}");
    const button = await screen.findByRole("button", { name: /Signing in/ });
    expect(button).toBeDisabled();
    resolve(signedIn);
    await waitFor(() => expect(location()).toBe("/"));
    expect(mock.callsTo("POST", "/api/auth/login")[0]?.body).toEqual({
      email: "cook@example.com", password: "correct horse battery", remember: false,
    });
    expect(await screen.findByRole("button", { name: /Account menu for Test Cook/ })).toBeInTheDocument();
  });

  it("shows the server's generic error in an alert and keeps the form", async () => {
    mockApi({ ...signedOut, "POST /api/auth/login": reply(401, { error: "Email or password is incorrect." }) });
    const user = userEvent.setup();
    renderAt("/login");
    await user.type(await screen.findByLabelText("Email"), "cook@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(document.querySelector(".auth-card")?.className).toMatch(/shake-/);
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(location()).toBe("/login");
  });

  it("explains a lockout", async () => {
    mockApi({ ...signedOut, "POST /api/auth/login": reply(429, { error: "Too many sign-in attempts. Try again in 15 minutes." }) });
    const user = userEvent.setup();
    renderAt("/login");
    await user.type(await screen.findByLabelText("Email"), "cook@example.com");
    await user.type(screen.getByLabelText("Password"), "whatever pw{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 15 minutes");
  });

  it("does not submit an empty form", async () => {
    const mock = mockApi(signedOut);
    const user = userEvent.setup();
    renderAt("/login");
    await screen.findByLabelText("Email");
    await user.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your email and password.");
    expect(mock.callsTo("POST", "/api/auth/login")).toHaveLength(0);
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("toggles to create account without reloading, keeping the email", async () => {
    mockApi(signedOut);
    const user = userEvent.setup();
    renderAt("/login");
    await user.type(await screen.findByLabelText("Email"), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Create account", pressed: false }));
    expect(location()).toBe("/signup");
    expect(screen.getByRole("heading", { level: 1, name: "Start your recipe box" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("new@example.com");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText(/Your name/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in", pressed: false }));
    expect(location()).toBe("/login");
  });

  it("rates passwords in plain language while signing up", async () => {
    mockApi(signedOut);
    const user = userEvent.setup();
    renderAt("/signup");
    const password = await screen.findByLabelText("Password");
    const meter = screen.getByRole("meter", { name: "Password strength" });
    await user.type(password, "short");
    expect(screen.getByText(/3 more characters to go/)).toBeInTheDocument();
    await user.clear(password);
    await user.type(password, "password");
    expect(meter).toHaveAttribute("aria-valuetext", "Too easy");
    await user.clear(password);
    await user.type(password, "plum kettle orbit 42");
    expect(meter).toHaveAttribute("aria-valuetext", "Very strong");
  });

  it("signs up, sends the optional name and remember choice, and shows the welcome", async () => {
    const mock = mockApi({
      ...signedOut,
      "POST /api/auth/signup": signedIn,
      "GET /api/recipes": { recipes: [] },
      "GET /api/list": { groups: [], counts: { total: 0, checked: 0, open: 0 } },
    });
    const user = userEvent.setup();
    renderAt("/signup");
    await user.type(await screen.findByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText(/Your name/), "Asha");
    await user.type(screen.getByLabelText("Password"), "plum kettle orbit 42");
    await user.click(screen.getByLabelText(/Keep me signed in/));
    await user.click(submitButton());
    expect(await screen.findByRole("heading", { name: "Welcome, Test." })).toBeInTheDocument();
    expect(mock.callsTo("POST", "/api/auth/signup")[0]?.body).toEqual({
      email: "new@example.com", password: "plum kettle orbit 42", remember: true, display_name: "Asha",
    });
    expect(screen.getByRole("button", { name: /Snap a recipe/ })).toBeInTheDocument();
  });

  it("shows server field errors from sign-up next to the field", async () => {
    const message = "An account with this email already exists. Sign in instead.";
    mockApi({ ...signedOut, "POST /api/auth/signup": reply(409, { error: message, fields: { email: message } }) });
    const user = userEvent.setup();
    renderAt("/signup");
    await user.type(await screen.findByLabelText("Email"), "taken@example.com");
    await user.type(screen.getByLabelText("Password"), "plum kettle orbit 42{Enter}");
    const field = screen.getByLabelText("Email").closest(".field") as HTMLElement;
    expect(await within(field).findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("shows and hides the password and warns about Caps Lock", async () => {
    mockApi(signedOut);
    const user = userEvent.setup();
    renderAt("/login");
    const password = await screen.findByLabelText("Password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
    await user.click(password);
    await user.keyboard("{CapsLock}a");
    expect(await screen.findByText("Caps Lock is on")).toBeInTheDocument();
  });

  it("hides sign-up when it is closed and offers the shared demo when enabled", async () => {
    mockApi({
      ...signedOut,
      "GET /api/config": { allow_signups: false, demo_login: true, ai_enabled: false, categories: [], days: [],
        multipliers: [1], max_image_bytes: 1 },
    });
    renderAt("/signup");
    expect(await screen.findByText("New sign-ups are closed right now.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try the shared demo" })).toBeInTheDocument();
    expect(screen.getByText(/anyone can see and change the demo box/)).toBeInTheDocument();
  });
});

describe("route guards", () => {
  it("sends signed-out visitors to /login and returns them after signing in", async () => {
    mockApi({
      ...signedOut,
      "POST /api/auth/login": signedIn,
      "GET /api/planner": { plan: {}, days: [] },
      "GET /api/list": { groups: [], counts: { total: 0, checked: 0, open: 0 } },
    });
    const user = userEvent.setup();
    renderAt("/planner");
    await waitFor(() => expect(location()).toBe("/login"));
    await user.type(screen.getByLabelText("Email"), "cook@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery{Enter}");
    await waitFor(() => expect(location()).toBe("/planner"));
  });

  it("sends signed-in users away from /login", async () => {
    mockApi({ "GET /api/recipes": { recipes: [] }, "GET /api/list": { groups: [], counts: { total: 0, checked: 0, open: 0 } } });
    renderAt("/login");
    await waitFor(() => expect(location()).toBe("/"));
  });

  it("shows a splash, not the sign-in page, while the session is checked", async () => {
    let resolve: (value: unknown) => void = () => {};
    mockApi({ "GET /api/auth/me": () => new Promise((r) => (resolve = r)) });
    renderAt("/");
    expect(screen.getByText("Opening your recipe box…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    resolve({ user: null, csrf_token: "t" });
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  it("never returns to an outside or auth URL", async () => {
    const { returnPath } = await import("../lib/returnPath");
    expect(returnPath({ from: { pathname: "//evil.example/x" } })).toBe("/");
    expect(returnPath({ from: { pathname: "/login" } })).toBe("/");
    expect(returnPath({ from: { pathname: "/shopping", search: "?a=1" } })).toBe("/shopping?a=1");
    expect(returnPath(null)).toBe("/");
  });
});

describe("password strength", () => {
  it("prefers length over composition rules", () => {
    expect(passwordStrength("abcdefgh").score).toBe(0);
    expect(passwordStrength("kettleplum").score).toBe(1);
    expect(passwordStrength("kettle plum orbit").score).toBe(4);
    expect(passwordStrength("ada1234567", "ada1234567@example.com").label).toBe("Too easy");
  });
});

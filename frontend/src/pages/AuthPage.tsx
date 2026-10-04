import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { ChefMark } from "../components/ChefMark";
import { Icon } from "../components/Icon";
import { RecipeCover } from "../components/RecipeCover";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
import { usePageTitle } from "../hooks/usePageTitle";
import { errorMessage } from "../lib/errors";
import { PASSWORD_MAX, emailProblem, passwordStrength } from "../lib/password";
import type { Category } from "../types";

type Mode = "signin" | "signup";
type Field = "email" | "password" | "display_name";
type Phase = "idle" | "busy" | "success";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const COPY = {
  signin: {
    title: "Welcome back",
    lede: "Sign in to your recipe box, your list and this week's plan.",
    submit: "Sign in",
    busy: "Signing in…",
    done: "Signed in",
  },
  signup: {
    title: "Start your recipe box",
    lede: "Free and private: only you can see your recipes, list and plan.",
    submit: "Create account",
    busy: "Creating your box…",
    done: "You're in",
  },
} as const;

/** Sign in and create account on one card, with the brand panel beside it (above it on phones). */
export function AuthPage() {
  const { pathname, state } = useLocation();
  const navigate = useNavigate();
  const { login, signup, demo, notice } = useAuth();
  const config = useConfig();
  const mode: Mode = pathname === "/signup" && config.allow_signups ? "signup" : "signin";
  const copy = COPY[mode];
  usePageTitle(mode === "signin" ? "Sign in" : "Create account");

  const ids = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverFields, setServerFields] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [shake, setShake] = useState(0);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailInput.current?.focus();
  }, []);

  // Switching between sign in and sign up keeps what was typed but drops old errors.
  useEffect(() => {
    setError(null);
    setServerFields({});
    setTouched({});
  }, [mode]);

  const strength = passwordStrength(password, email);
  const problems: Partial<Record<Field, string>> = {
    email: emailProblem(email) ?? undefined,
    password:
      mode === "signup"
        ? strength.score === 0
          ? password ? strength.hint : "Choose a password."
          : password.length > PASSWORD_MAX ? `Use ${PASSWORD_MAX} characters or fewer.` : undefined
        : password ? undefined : "Enter your password.",
  };
  const shown = (field: Field) => serverFields[field] ?? (touched[field] ? problems[field] : undefined);

  const switchMode = (next: Mode) => {
    if (next !== mode) navigate(next === "signup" ? "/signup" : "/login", { replace: true, state });
  };

  const fail = (message: string, fields: Partial<Record<Field, string>> = {}) => {
    setPhase("idle");
    setError(message);
    setServerFields(fields);
    setShake((n) => n + 1);
    if (fields.email) emailInput.current?.focus();
    else passwordInput.current?.focus();
  };

  const celebrate = async () => {
    setPhase("success");
    await wait(reducedMotion() ? 150 : 650);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phase !== "idle") return;
    setTouched({ email: true, password: true, display_name: true });
    setServerFields({});
    if (problems.email || problems.password) {
      setError(mode === "signin" ? "Enter your email and password." : "Please fix the highlighted fields.");
      setShake((n) => n + 1);
      (problems.email ? emailInput : passwordInput).current?.focus();
      return;
    }
    setError(null);
    setPhase("busy");
    const credentials = { email: email.trim(), password, remember, display_name: displayName.trim() || undefined };
    try {
      await (mode === "signin" ? login(credentials, { celebrate }) : signup(credentials, { celebrate }));
    } catch (err) {
      if (err instanceof ApiError) fail(err.message, err.fields as Partial<Record<Field, string>>);
      else fail(errorMessage(err));
    }
  };

  const tryDemo = async () => {
    setPhase("busy");
    try {
      await demo();
    } catch (err) {
      fail(errorMessage(err));
    }
  };

  const onPasswordKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (typeof event.getModifierState === "function") setCapsLock(event.getModifierState("CapsLock"));
  };

  const busy = phase !== "idle";
  const passwordError = shown("password");
  const emailError = shown("email");

  return (
    <div className={`auth auth-${mode}`}>
      <BrandPanel />
      <main className="auth-main" id="main">
        <div className="auth-tools">
          <ThemeToggle />
        </div>
        {/* Two identical shake animations, alternated, so each failure restarts it without a remount. */}
        <div className={`auth-card${shake ? ` shake-${shake % 2}` : ""}`} data-phase={phase}>
          {config.allow_signups ? (
            <div className="auth-toggle" role="group" aria-label="Choose sign in or create account" data-mode={mode}>
              <span className="auth-toggle-thumb" aria-hidden="true" />
              <button type="button" aria-pressed={mode === "signin"} onClick={() => switchMode("signin")}>
                Sign in
              </button>
              <button type="button" aria-pressed={mode === "signup"} onClick={() => switchMode("signup")}>
                Create account
              </button>
            </div>
          ) : (
            <p className="auth-closed">New sign-ups are closed right now.</p>
          )}

          <div className="auth-heading" key={mode}>
            <p className="eyebrow">{mode === "signin" ? "Members' entrance" : "New here"}</p>
            <h1 id={`${ids}-title`}>{copy.title}</h1>
            <p className="auth-lede">{copy.lede}</p>
          </div>

          {notice && (
            <p className="auth-notice" role="status">
              <Icon name="alert" />
              {notice}
            </p>
          )}

          <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate aria-labelledby={`${ids}-title`}>
            <FormField id={`${ids}-email`} label="Email" error={emailError}>
              <input
                ref={emailInput}
                id={`${ids}-email`}
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setServerFields((f) => ({ ...f, email: undefined }));
                }}
                // Empty fields are only flagged on submit, so tabbing past (or switching modes) isn't scolded.
                onBlur={() => email.trim() && setTouched((t) => ({ ...t, email: true }))}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? `${ids}-email-error` : undefined}
                placeholder="you@example.com"
              />
            </FormField>

            {mode === "signup" && (
              <div className="auth-extra">
                <FormField id={`${ids}-name`} label="Your name" optional>
                  <input
                    id={`${ids}-name`}
                    type="text"
                    autoComplete="name"
                    maxLength={60}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="What should we call you?"
                  />
                </FormField>
              </div>
            )}

            <FormField id={`${ids}-password`} label="Password" error={passwordError}>
              <div className="password-wrap">
                <input
                  ref={passwordInput}
                  id={`${ids}-password`}
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={PASSWORD_MAX * 2}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setServerFields((f) => ({ ...f, password: undefined }));
                  }}
                  onKeyDown={onPasswordKey}
                  onKeyUp={onPasswordKey}
                  onBlur={() => {
                    if (password) setTouched((t) => ({ ...t, password: true }));
                    setCapsLock(false);
                  }}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={
                    [passwordError && `${ids}-password-error`, mode === "signup" && `${ids}-strength`, capsLock && `${ids}-caps`]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                />
                <button
                  type="button"
                  className="password-peek"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-controls={`${ids}-password`}
                >
                  <Icon name={showPassword ? "eye-off" : "eye"} />
                </button>
              </div>
              {capsLock && (
                <p className="caps-warning" id={`${ids}-caps`} role="status">
                  <Icon name="alert" /> Caps Lock is on
                </p>
              )}
              {mode === "signup" && (
                <div className="strength" id={`${ids}-strength`}>
                  <div
                    className="strength-bar"
                    data-score={password ? strength.score : -1}
                    role="meter"
                    aria-label="Password strength"
                    aria-valuemin={0}
                    aria-valuemax={4}
                    aria-valuenow={strength.score}
                    aria-valuetext={strength.label || "Not set"}
                  >
                    {[1, 2, 3, 4].map((step) => (
                      <span key={step} className={password && strength.score >= step ? "is-on" : ""} />
                    ))}
                  </div>
                  <p className="strength-hint">
                    {strength.label && <strong>{strength.label}. </strong>}
                    {strength.hint}
                  </p>
                </div>
              )}
            </FormField>

            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span className="remember-box" aria-hidden="true">
                <Icon name="check" />
              </span>
              <span>
                Keep me signed in <span className="hint-inline">for 30 days on this device</span>
              </span>
            </label>

            <div className="auth-error" role="alert" aria-live="assertive">
              {error && (
                <p className="form-error">
                  <Icon name="alert" />
                  {error}
                </p>
              )}
            </div>

            <button type="submit" className="btn btn-primary btn-block auth-submit" disabled={busy} aria-busy={phase === "busy"}>
              {phase === "busy" && <span className="spinner" aria-hidden="true" />}
              {phase === "success" && (
                <span className="submit-tick" aria-hidden="true">
                  <Icon name="check" />
                </span>
              )}
              <span>{phase === "busy" ? copy.busy : phase === "success" ? copy.done : copy.submit}</span>
              {phase === "idle" && <Icon name="arrow" />}
            </button>
            <p className="visually-hidden" role="status" aria-live="polite">
              {phase === "busy" ? copy.busy : phase === "success" ? copy.done : ""}
            </p>
          </form>

          {mode === "signin" ? (
            <p className="auth-foot">
              Forgot your password? Password reset by email isn&apos;t available yet; if you can&apos;t sign in, create a new account.
            </p>
          ) : (
            <p className="auth-foot">
              We only use your email to sign you in. Your recipes stay private to your account.
            </p>
          )}

          {config.demo_login && (
            <div className="auth-demo">
              <button type="button" className="btn btn-ghost btn-block" onClick={() => void tryDemo()} disabled={busy}>
                Try the shared demo
              </button>
              <p className="hint-inline">Public: anyone can see and change the demo box. It resets every day.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function FormField({ id, label, error, optional, children }: {
  id: string; label: string; error?: string; optional?: boolean; children: ReactNode;
}) {
  return (
    <div className={`field auth-field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="hint-inline"> (optional)</span>}
      </label>
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

const SAMPLE_CARDS: Array<{ id: number; title: string; category: Category; meta: string }> = [
  { id: 101, title: "Masala Omelette", category: "Breakfast", meta: "15 min" },
  { id: 202, title: "Lemon Herb Grain Bowl", category: "Lunch", meta: "20 min" },
  { id: 303, title: "Chicken Tikka Curry", category: "Dinner", meta: "45 min" },
  { id: 404, title: "Warm Apple Crumble", category: "Dessert", meta: "50 min" },
];

const RECEIPT = [
  ["2", "onions"],
  ["7", "eggs"],
  ["2 5/8 cups", "milk"],
  ["4 cloves", "garlic"],
  ["1 7/8 cups", "butter"],
];

/** The brand side: logo, tagline and a gently moving still life of recipe cards and a receipt. */
function BrandPanel() {
  return (
    <aside className="auth-brand" aria-label="About CartChef">
      <div className="auth-brand-top">
        <span className="brand">
          <span className="brand-mark">
            <Icon name="hat" />
          </span>
          <span className="brand-name">
            Cart<span>Chef</span>
          </span>
        </span>
      </div>
      <div className="auth-pitch">
        <p className="auth-tagline">
          Every recipe.
          <br />
          <em>One list.</em>
        </p>
        <p className="auth-sub">
          Save recipes, scale them for the crowd, and turn a week of meals into one tidy shopping list.
        </p>
      </div>
      <div className="auth-stage" aria-hidden="true">
        {SAMPLE_CARDS.map((card, index) => (
          <div key={card.id} className={`stage-card stage-card-${index + 1}`}>
            <RecipeCover recipe={{ id: card.id, title: card.title, category: card.category }} size="card" />
            <div className="stage-card-body">
              <strong>{card.title}</strong>
              <span className="num">{card.meta}</span>
            </div>
          </div>
        ))}
        <div className="stage-receipt">
          <p className="stage-receipt-head">CARTCHEF · LIST</p>
          {RECEIPT.map(([qty, name]) => (
            <p key={name} className="stage-receipt-line">
              <span className="num">{qty}</span>
              {name}
            </p>
          ))}
          <p className="stage-receipt-total">
            <span>ITEMS</span>
            <span className="num">5</span>
          </p>
        </div>
        <span className="stage-chef">
          <ChefMark />
        </span>
      </div>
      <ul className="auth-cats" aria-label="Recipe categories">
        {SAMPLE_CARDS.map((card) => (
          <li key={card.category} className={`cat-block cat-${card.category.toLowerCase()}`}>
            {card.category}
          </li>
        ))}
      </ul>
    </aside>
  );
}

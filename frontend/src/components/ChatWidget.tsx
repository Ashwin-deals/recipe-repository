import { Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import { useChat } from "../hooks/useChat";
import { useRecipeChanges } from "../hooks/useRecipeLibrary";
import { ChefMark } from "./ChefMark";
import { Icon } from "./Icon";

// The panel (messages, proposals, forms) loads on first open; the launcher is all that ships up front.
const ChatPanel = lazy(() => import("./ChatPanel").then((module) => ({ default: module.ChatPanel })));

const HINT_KEY = "cartchef:chat-hint";

function firstVisit(): boolean {
  try {
    if (localStorage.getItem(HINT_KEY)) return false;
    localStorage.setItem(HINT_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** "Ask the chef": one floating launcher on every page, and the chat panel it opens. */
export function ChatWidget() {
  const chat = useChat();
  const { open, recipe, setRecipe, closeChat, openChat } = chat;
  const panelId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [mounted, setMounted] = useState(open);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (open) setMounted(true);
    document.documentElement.classList.toggle("has-chat", open);
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      launcher.current?.focus();
    }
  }, [open]);

  useEffect(() => () => document.documentElement.classList.remove("has-chat"), []);

  // Show the "Ask the chef" label once, on the first visit.
  useEffect(() => {
    if (!firstVisit()) return;
    setHint(true);
    const timer = window.setTimeout(() => setHint(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  // Keep the chat's recipe in step with edits and deletes made anywhere.
  useRecipeChanges((change) => {
    if (!recipe) return;
    if (change.kind === "deleted" && change.id === recipe.id) setRecipe(null);
    if (change.kind === "saved" && change.replaced && change.recipe.id === recipe.id) setRecipe(change.recipe);
  });

  const close = () => {
    returnFocus.current = true;
    closeChat();
  };

  const label = open ? "Close Ask the chef" : chat.unread ? "Ask the chef (new reply)" : "Ask the chef";
  return (
    <div className="chat-widget">
      {mounted && (
        <Suspense fallback={null}>
          <ChatPanel id={panelId} onClose={close} />
        </Suspense>
      )}
      <button
        ref={launcher}
        type="button"
        className="chat-launcher"
        data-state={open ? "open" : "closed"}
        aria-label={label}
        aria-expanded={open}
        aria-controls={mounted ? panelId : undefined}
        onClick={() => (open ? close() : openChat())}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) close();
        }}
      >
        <span className="launcher-face">
          <ChefMark />
        </span>
        <span className="launcher-x">
          <Icon name="close" />
        </span>
        {chat.unread && !open && <span className="launcher-dot" />}
      </button>
      <span className={`launcher-tip${hint && !open ? " is-shown" : ""}`} aria-hidden="true">
        Ask the chef
      </span>
    </div>
  );
}

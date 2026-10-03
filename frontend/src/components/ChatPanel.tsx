import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { createRecipe, updateRecipe } from "../api/endpoints";
import { useChat, type ChatMessage } from "../hooks/useChat";
import { useRecipeLibrary } from "../hooks/useRecipeLibrary";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import type { ChatProposal, Recipe } from "../types";
import { ChefMark } from "./ChefMark";
import { Icon } from "./Icon";

const MAX_MESSAGE = 500;
const DRAG_CLOSE_PX = 110;

const RECIPE_PROMPTS = ["Make it vegan", "What can I use instead of buttermilk?", "Scale for 6 people", "What can I cook with eggs and tomatoes?"];
// "Make it vegan" and "Scale for 6 people" need a recipe, so general mode offers a different starter.
const GENERAL_PROMPTS = ["What can I cook with eggs and tomatoes?", "What can I use instead of buttermilk?", "Quick weeknight dinner ideas"];

interface ChatPanelProps {
  id: string;
  /** Hide the panel and hand focus back to the launcher. */
  onClose: () => void;
}

/**
 * The "Ask the chef" panel: a non-modal dialog that springs out of the launcher (a bottom sheet
 * on phones). The conversation itself lives in ChatProvider, so it survives route changes.
 */
export function ChatPanel({ id, onClose }: ChatPanelProps) {
  const chat = useChat();
  const library = useRecipeLibrary();
  const ids = useId();
  const panel = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ startY: number; dy: number } | null>(null);
  const { open, messages, loading, recipe, focusRequest } = chat;
  const loadRecipes = library.load;

  // A closed panel stays mounted (so it can animate out) but must be unreachable.
  useLayoutEffect(() => {
    panel.current?.toggleAttribute("inert", !open);
  }, [open]);

  useEffect(() => {
    if (open) loadRecipes();
  }, [open, loadRecipes]);

  useEffect(() => {
    if (focusRequest) input.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length, loading, open]);

  // After a reply, keep typing where you were (only if focus is still in the chat).
  const wasLoading = useRef(loading);
  useEffect(() => {
    if (wasLoading.current && !loading && panel.current?.contains(document.activeElement)) input.current?.focus();
    wasLoading.current = loading;
  }, [loading]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void chat.send(chat.draft);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void chat.send(chat.draft);
    }
  }

  function onPanelKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onClose();
    }
  }

  // Phones: drag the sheet's handle or header down to close it.
  function onDragStart(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" || (event.target as HTMLElement).closest("button, select")) return;
    if (!window.matchMedia?.("(max-width: 759px)").matches) return;
    drag.current = { startY: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panel.current?.classList.add("is-dragging");
  }
  function onDragMove(event: PointerEvent<HTMLElement>) {
    if (!drag.current || !panel.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.startY);
    panel.current.style.transform = `translateY(${drag.current.dy}px)`;
  }
  function onDragEnd() {
    if (!drag.current || !panel.current) return;
    const { dy } = drag.current;
    drag.current = null;
    panel.current.classList.remove("is-dragging");
    panel.current.style.transform = "";
    if (dy > DRAG_CLOSE_PX) onClose();
  }

  const choices = withRecipe(library.recipes ?? [], recipe);
  const prompts = recipe ? RECIPE_PROMPTS : GENERAL_PROMPTS;
  const titleId = `${ids}-title`;
  const dragProps = { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd };
  return (
    <section
      ref={panel}
      id={id}
      className="chat-panel"
      data-state={open ? "open" : "closed"}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-hidden={!open || undefined}
      onKeyDown={onPanelKeyDown}
    >
      <div className="chat-handle" aria-hidden="true" {...dragProps} />
      <header className="chat-head" {...dragProps}>
        <span className={`chat-avatar${loading ? " is-busy" : ""}`} aria-hidden="true">
          <ChefMark />
        </span>
        <div className="chat-head-text">
          <h2 id={titleId} className="chat-title">Ask the chef</h2>
          <p className="chat-status">{loading ? "Cooking up ideas…" : "Ready to help"}</p>
        </div>
        <button type="button" className="chat-head-btn" aria-label="Minimize chat" title="Minimize" onClick={onClose}>
          <Icon name="minus" />
        </button>
        <button type="button" className="chat-head-btn" aria-label="Close chat" title="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

      <div className="chat-context-bar">
        <label htmlFor={`${ids}-context`}>About:</label>
        <select
          id={`${ids}-context`}
          className="chat-context-select"
          value={recipe ? String(recipe.id) : ""}
          onChange={(event) => chat.setRecipe(choices.find((r) => String(r.id) === event.target.value) ?? null)}
        >
          <option value="">All recipes</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        <button type="button" className="btn-text chat-clear" onClick={chat.clear} disabled={!messages.length || loading}>
          Clear chat
        </button>
      </div>

      <div ref={log} className="chat-log" role="log" aria-live="polite" aria-label="Conversation">
        <Bubble role="assistant" intro>
          <p className="bubble-text">
            {recipe
              ? `Hi! Ask me to adapt ${recipe.title}, swap an ingredient or change the servings.`
              : "Hi! Tell me what's in your fridge, or ask any cooking question."}
          </p>
        </Bubble>
        {messages.map((m) => {
          if (m.role === "note") {
            return (
              <p key={m.id} className="chat-divider">
                <span>{m.text}</span>
              </p>
            );
          }
          if (m.retry !== undefined) {
            return (
              <Bubble key={m.id} role="assistant" error>
                <div role="alert">
                  <p>{m.text}</p>
                  <button type="button" className="btn btn-quiet" onClick={() => chat.retry(m)} disabled={loading}>
                    Try again
                  </button>
                </div>
              </Bubble>
            );
          }
          return (
            <Bubble key={m.id} role={m.role} fallback={m.fallback}>
              <p className="bubble-text">{m.text}</p>
              {m.proposal && <ProposalCard message={m} proposal={m.proposal} />}
              {m.items && m.items.length > 0 && <ShoppingSuggestions message={m} items={m.items} />}
            </Bubble>
          );
        })}
        {loading && (
          <div className="msg msg-assistant chat-typing" role="status">
            <span className="chat-avatar chat-avatar-sm is-bouncing" aria-hidden="true">
              <ChefMark />
            </span>
            <span className="typing-bubble" aria-hidden="true">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </span>
            <span className="visually-hidden">The chef is typing…</span>
          </div>
        )}
      </div>

      <footer className="chat-foot">
        <div className="chat-prompts" role="group" aria-label="Suggested questions">
          {prompts.map((prompt) => (
            <button key={prompt} type="button" className="chip chat-chip" onClick={() => void chat.send(prompt)} disabled={loading}>
              {prompt}
            </button>
          ))}
        </div>
        <form className="chat-form" onSubmit={onSubmit}>
          <label className="visually-hidden" htmlFor={`${ids}-input`}>
            Message the chef
          </label>
          <textarea
            ref={input}
            id={`${ids}-input`}
            rows={2}
            maxLength={MAX_MESSAGE}
            value={chat.draft}
            placeholder={recipe ? "e.g. make it gluten-free" : "e.g. what can I cook with rice and lentils?"}
            onChange={(event) => chat.setDraft(event.target.value)}
            onKeyDown={onInputKeyDown}
            aria-describedby={`${ids}-count ${ids}-note`}
          />
          <button className="btn btn-primary chat-send" type="submit" disabled={loading || !chat.draft.trim()} aria-label="Send">
            <Icon name="send" />
          </button>
        </form>
        <div className="chat-meta">
          <p id={`${ids}-note`} className="chat-note">AI suggestions can be wrong. Check ingredients for allergies.</p>
          <p id={`${ids}-count`} className="chat-count num" aria-live="off">
            {chat.draft.length}/{MAX_MESSAGE}
          </p>
        </div>
      </footer>
    </section>
  );
}

/** Recipes for the context picker, making sure the current one is listed even before all recipes load. */
function withRecipe(recipes: Recipe[], current: Recipe | null): Recipe[] {
  const list = current && !recipes.some((r) => r.id === current.id) ? [current, ...recipes] : recipes;
  return [...list].sort((a, b) => a.title.localeCompare(b.title));
}

interface BubbleProps {
  role: "user" | "assistant";
  intro?: boolean;
  error?: boolean;
  fallback?: boolean;
  children: ReactNode;
}

/** One message: the chef's on the left with the avatar, yours on the right. */
function Bubble({ role, intro, error, fallback, children }: BubbleProps) {
  const classes = ["bubble", error ? "bubble-error" : `bubble-${role}`, intro && "bubble-intro", fallback && "bubble-fallback"];
  return (
    <div className={`msg msg-${role}`}>
      {role === "assistant" && (
        <span className="chat-avatar chat-avatar-sm" aria-hidden="true">
          <ChefMark />
        </span>
      )}
      <div className={classes.filter(Boolean).join(" ")}>
        <span className="visually-hidden">{role === "user" ? "You:" : "Chef:"}</span>
        {children}
      </div>
    </div>
  );
}

const normalise = (line: string) => line.trim().toLowerCase();

/** Before/after view of a proposed recipe. Nothing is saved until a button is pressed. */
function ProposalCard({ message, proposal }: { message: ChatMessage; proposal: ChatProposal }) {
  const chat = useChat();
  const library = useRecipeLibrary();
  const toast = useToast();
  const prepId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState(proposal.prep_time === null ? "" : String(proposal.prep_time));
  const original = message.about ?? null;
  const outcome = message.outcome;

  if (outcome?.kind === "dismissed") return <p className="proposal-dismissed">Suggestion dismissed.</p>;

  const before = new Set((original?.lines ?? []).map(normalise));
  const after = new Set(proposal.ingredients.map(normalise));
  const removed = (original?.lines ?? []).filter((line) => !after.has(normalise(line)));

  async function save(replace: boolean) {
    if (saving) return;
    if (!prep.trim()) {
      setError("Add a prep time first.");
      return;
    }
    setSaving(true);
    setError(null);
    const input = { title: proposal.title, prep_time: prep, category: proposal.category, ingredients: proposal.ingredients.join("\n") };
    try {
      const { recipe } = replace && original ? await updateRecipe(original.id, input) : await createRecipe(input);
      const text = replace ? `Updated “${recipe.title}”.` : `Saved “${recipe.title}” as a new recipe.`;
      chat.patchMessage(message.id, { outcome: { kind: "saved", text, recipeId: recipe.id } });
      toast.show(text);
      library.notify({ kind: "saved", recipe, replaced: replace });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const done = outcome?.kind === "saved";
  return (
    <section className="proposal" aria-label={`Proposed recipe: ${proposal.title}`}>
      <p className="proposal-kicker">Proposed recipe</p>
      <dl className="proposal-facts">
        <div>
          <dt>Title</dt>
          <dd>
            {original && original.title !== proposal.title && <del>{original.title}</del>} <ins>{proposal.title}</ins>
          </dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>
            {original && original.category !== proposal.category && <del>{original.category}</del>} {proposal.category}
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor={prepId}>Prep (min)</label>
          </dt>
          <dd>
            {original && proposal.prep_time !== null && original.prep_time !== proposal.prep_time && <del className="num">{original.prep_time}</del>}{" "}
            <input id={prepId} className="proposal-prep" type="number" inputMode="numeric" min={0} max={1440} value={prep}
              onChange={(event) => setPrep(event.target.value)} disabled={done} />
          </dd>
        </div>
      </dl>
      <ul className="proposal-lines" aria-label="Ingredients in the proposal">
        {proposal.ingredients.map((line) => (
          <li key={line} className={original && !before.has(normalise(line)) ? "is-added" : undefined}>
            {original && !before.has(normalise(line)) && <span className="visually-hidden">Added: </span>}
            {line}
          </li>
        ))}
        {removed.map((line) => (
          <li key={`removed-${line}`} className="is-removed">
            <span className="visually-hidden">Removed: </span>
            <del>{line}</del>
          </li>
        ))}
      </ul>
      {error && <p className="proposal-error" role="alert">{error}</p>}
      {done ? (
        <p className="proposal-saved" role="status">
          {outcome.text}{" "}
          <Link className="link-arrow" to={`/recipes/${outcome.recipeId}`}>
            Open recipe <Icon name="arrow" />
          </Link>
        </p>
      ) : (
        <div className="proposal-actions">
          <button type="button" className="btn btn-primary" onClick={() => void save(false)} aria-busy={saving}>
            Apply as new recipe
          </button>
          {original && (
            <button type="button" className="btn btn-ghost" onClick={() => void save(true)} aria-busy={saving}>
              Replace this recipe
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => chat.patchMessage(message.id, { outcome: { kind: "dismissed" } })} disabled={saving}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}

/** Items the chef suggests buying; each is added to the list only on click. */
function ShoppingSuggestions({ message, items }: { message: ChatMessage; items: string[] }) {
  const chat = useChat();
  const shopping = useShoppingList();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const added = new Set(message.added ?? []);

  async function add(toAdd: string[]) {
    if (busy) return;
    setBusy(true);
    const done = [...added];
    try {
      for (const item of toAdd) {
        await shopping.addItem(item);
        done.push(item);
        chat.patchMessage(message.id, { added: [...done] });
      }
      toast.show(toAdd.length === 1 ? `Added “${toAdd[0]}” to the list.` : `Added ${toAdd.length} items to the list.`);
    } catch (err) {
      toast.show(errorMessage(err), { error: true });
    } finally {
      setBusy(false);
    }
  }

  const remaining = items.filter((item) => !added.has(item));
  return (
    <section className="chat-items" aria-label="Suggested shopping items">
      <ul>
        {items.map((item) => (
          <li key={item}>
            <span>{item}</span>
            {added.has(item) ? (
              <span className="chat-item-added">Added</span>
            ) : (
              <button type="button" className="btn btn-quiet" onClick={() => void add([item])} aria-busy={busy} aria-label={`Add ${item} to list`}>
                Add to list
              </button>
            )}
          </li>
        ))}
      </ul>
      {remaining.length > 1 && (
        <button type="button" className="btn btn-ink" onClick={() => void add(remaining)} aria-busy={busy}>
          Add all {remaining.length} to list
        </button>
      )}
    </section>
  );
}

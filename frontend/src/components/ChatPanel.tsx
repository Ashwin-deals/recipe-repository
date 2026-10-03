import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createRecipe, sendChat, updateRecipe } from "../api/endpoints";
import { useShoppingList } from "../hooks/useShoppingList";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import type { ChatProposal, ChatTurn, Recipe } from "../types";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

const MAX_MESSAGE = 500;
const HISTORY_TURNS = 8;

const RECIPE_PROMPTS = ["Make it vegan", "No dairy, what can I use?", "Scale for 6 people", "Make it less spicy", "Use fewer ingredients"];
const GENERAL_PROMPTS = ["What can I make with eggs, spinach and feta?", "How do I stop pasta sticking?", "Quick weeknight dinner ideas"];

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  proposal?: ChatProposal | null;
  items?: string[];
  fallback?: boolean;
  /** Set on error bubbles: the message to send again. */
  retry?: string;
}

interface ChatPanelProps {
  recipe: Recipe | null;
  onClose: () => void;
  /** Called after a proposal is saved, so the page can refresh. */
  onRecipeSaved: (recipe: Recipe, replaced: boolean) => void;
}

/** "Ask the chef": a stateless chat; history lives only in this component. */
export function ChatPanel({ recipe, onClose, onRecipeSaved }: ChatPanelProps) {
  const id = useId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView?.({ block: "end", behavior: reduce ? "auto" : "smooth" });
  }, [messages, loading]);

  async function send(text: string, base: Message[] = messages) {
    const message = text.trim();
    if (!message || loading) return;
    const history: ChatTurn[] = base
      .filter((m) => m.retry === undefined)
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, text: m.text }));
    setMessages([...base, { id: nextId.current++, role: "user", text: message }]);
    setInput("");
    setLoading(true);
    try {
      const result = await sendChat(message, recipe?.id ?? null, history);
      setMessages((current) => [
        ...current,
        {
          id: nextId.current++,
          role: "assistant",
          text: result.reply,
          proposal: result.proposal,
          items: result.shopping_items,
          fallback: result.source === "fallback",
        },
      ]);
    } catch (err) {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: errorMessage(err), retry: message }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function retry(failed: Message) {
    // Drop the error bubble and the user message it belongs to, then send that message again.
    const index = messages.indexOf(failed);
    const base = messages.slice(0, Math.max(0, index - 1));
    void send(failed.retry ?? "", base);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  const titleId = `${id}-title`;
  const prompts = recipe ? RECIPE_PROMPTS : GENERAL_PROMPTS;
  return (
    <Sheet labelledBy={titleId} onClose={onClose} side="right" className="chat-sheet">
      <header className="chat-head">
        <div className="chat-head-text">
          <h2 id={titleId} className="chat-title">
            <Icon name="chat" /> Ask the chef
          </h2>
          <p className="chat-context">{recipe ? `About: ${recipe.title}` : "General kitchen help"}</p>
        </div>
        <button type="button" className="btn btn-quiet chat-clear" onClick={() => setMessages([])} disabled={!messages.length || loading}>
          Clear chat
        </button>
        <button type="button" className="drawer-close chat-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

      <div className="chat-log" role="log" aria-live="polite" aria-label="Conversation">
        <div className="bubble bubble-assistant bubble-intro">
          {recipe
            ? `Hi! Ask me to adapt ${recipe.title}, swap an ingredient or change the servings.`
            : "Hi! Tell me what's in your fridge, or ask any cooking question."}
        </div>
        {messages.map((m) =>
          m.retry !== undefined ? (
            <div key={m.id} className="bubble bubble-error" role="alert">
              <p>{m.text}</p>
              <button type="button" className="btn btn-quiet" onClick={() => retry(m)} disabled={loading}>
                Try again
              </button>
            </div>
          ) : (
            <div key={m.id} className={`bubble bubble-${m.role}${m.fallback ? " bubble-fallback" : ""}`}>
              <p className="bubble-text">{m.text}</p>
              {m.proposal && <ProposalCard proposal={m.proposal} original={recipe} onSaved={onRecipeSaved} />}
              {m.items && m.items.length > 0 && <ShoppingSuggestions items={m.items} />}
            </div>
          ),
        )}
        {loading && (
          <div className="bubble bubble-assistant chat-typing" role="status">
            <span className="visually-hidden">The chef is typing…</span>
            <span className="dot" aria-hidden="true" />
            <span className="dot" aria-hidden="true" />
            <span className="dot" aria-hidden="true" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <footer className="chat-foot">
        <div className="chat-prompts" role="group" aria-label="Suggested questions">
          {prompts.map((prompt) => (
            <button key={prompt} type="button" className="chip chat-chip" onClick={() => void send(prompt)} disabled={loading}>
              {prompt}
            </button>
          ))}
        </div>
        <form className="chat-form" onSubmit={onSubmit}>
          <label className="visually-hidden" htmlFor={`${id}-input`}>
            Message the chef
          </label>
          <textarea
            ref={inputRef}
            id={`${id}-input`}
            rows={2}
            maxLength={MAX_MESSAGE}
            value={input}
            placeholder={recipe ? "e.g. make it gluten-free" : "e.g. what can I cook with rice and lentils?"}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby={`${id}-count ${id}-note`}
          />
          <button className="btn btn-primary chat-send" type="submit" disabled={loading || !input.trim()} aria-label="Send">
            <Icon name="send" />
          </button>
        </form>
        <div className="chat-meta">
          <p id={`${id}-note`} className="chat-note">AI suggestions can be wrong. Check ingredients for allergies.</p>
          <p id={`${id}-count`} className="chat-count num" aria-live="off">
            {input.length}/{MAX_MESSAGE}
          </p>
        </div>
      </footer>
    </Sheet>
  );
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; text: string } | { kind: "dismissed" } | { kind: "error"; text: string };

const normalise = (line: string) => line.trim().toLowerCase();

/** Before/after view of a proposed recipe. Nothing is saved until a button is pressed. */
function ProposalCard({ proposal, original, onSaved }: { proposal: ChatProposal; original: Recipe | null; onSaved: (recipe: Recipe, replaced: boolean) => void }) {
  const toast = useToast();
  const prepId = useId();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [prep, setPrep] = useState(proposal.prep_time === null ? "" : String(proposal.prep_time));

  if (state.kind === "dismissed") return <p className="proposal-dismissed">Suggestion dismissed.</p>;

  const before = new Set((original?.lines ?? []).map(normalise));
  const after = new Set(proposal.ingredients.map(normalise));
  const removed = (original?.lines ?? []).filter((line) => !after.has(normalise(line)));

  async function save(replace: boolean) {
    if (!prep.trim()) {
      setState({ kind: "error", text: "Add a prep time first." });
      return;
    }
    setState({ kind: "saving" });
    const input = { title: proposal.title, prep_time: prep, category: proposal.category, ingredients: proposal.ingredients.join("\n") };
    try {
      const { recipe } = replace && original ? await updateRecipe(original.id, input) : await createRecipe(input);
      const text = replace ? `Updated “${recipe.title}”.` : `Saved “${recipe.title}” as a new recipe.`;
      setState({ kind: "saved", text });
      toast.show(text);
      onSaved(recipe, replace);
    } catch (err) {
      setState({ kind: "error", text: errorMessage(err) });
    }
  }

  const done = state.kind === "saved";
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
      {state.kind === "error" && <p className="proposal-error" role="alert">{state.text}</p>}
      {done ? (
        <p className="proposal-saved" role="status">{state.text}</p>
      ) : (
        <div className="proposal-actions">
          <button type="button" className="btn btn-primary" onClick={() => void save(false)} disabled={state.kind === "saving"}>
            Apply as new recipe
          </button>
          {original && (
            <button type="button" className="btn btn-ghost" onClick={() => void save(true)} disabled={state.kind === "saving"}>
              Replace this recipe
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => setState({ kind: "dismissed" })} disabled={state.kind === "saving"}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}

/** Items the chef suggests buying; each is added to the list only on click. */
function ShoppingSuggestions({ items }: { items: string[] }) {
  const shopping = useShoppingList();
  const toast = useToast();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function add(toAdd: string[]) {
    setBusy(true);
    try {
      for (const item of toAdd) {
        await shopping.addItem(item);
        setAdded((current) => new Set(current).add(item));
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
              <button type="button" className="btn btn-quiet" onClick={() => void add([item])} disabled={busy} aria-label={`Add ${item} to list`}>
                Add to list
              </button>
            )}
          </li>
        ))}
      </ul>
      {remaining.length > 1 && (
        <button type="button" className="btn btn-ink" onClick={() => void add(remaining)} disabled={busy}>
          Add all {remaining.length} to list
        </button>
      )}
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { sendChat } from "../api/endpoints";
import { ChatContext, type ChatApi, type ChatMessage } from "../hooks/useChat";
import { errorMessage } from "../lib/errors";
import type { ChatTurn, Recipe } from "../types";

const HISTORY_TURNS = 8;
const KEEP_MESSAGES = 60;
const STORAGE_KEY = "cartchef:chat";
const ROLES = new Set(["user", "assistant", "note"]);

interface Saved {
  open: boolean;
  messages: ChatMessage[];
  recipe: Recipe | null;
}

const isMessage = (value: unknown): value is ChatMessage => {
  const m = value as Partial<ChatMessage> | null;
  return typeof m?.id === "number" && typeof m.text === "string" && ROLES.has(m.role ?? "");
};

/** The conversation is kept for this browser tab only (sessionStorage), and never sent anywhere else. */
function loadSaved(): Saved {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    if (data && Array.isArray(data.messages)) {
      return { open: data.open === true, messages: data.messages.filter(isMessage), recipe: data.recipe ?? null };
    }
  } catch {
    // Storage blocked or corrupt: start a fresh conversation.
  }
  return { open: false, messages: [], recipe: null };
}

function save(state: Saved) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, messages: state.messages.slice(-KEEP_MESSAGES) }));
  } catch {
    // Storage full or blocked: the chat still works for this page.
  }
}

/** "Ask the chef" state, shared by the floating widget and every page that opens it. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(loadSaved);
  const [open, setOpen] = useState(initial.open);
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [recipe, setRecipeState] = useState<Recipe | null>(initial.recipe);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const nextId = useRef(Math.max(0, ...initial.messages.map((m) => m.id)) + 1);
  const latest = useRef({ open, messages, recipe, loading });

  useEffect(() => {
    latest.current = { open, messages, recipe, loading };
  });

  useEffect(() => {
    save({ open, messages, recipe });
  }, [open, messages, recipe]);

  const send = useCallback(async (text: string, base?: ChatMessage[]) => {
    const message = text.trim();
    if (!message || latest.current.loading) return;
    const current = base ?? latest.current.messages;
    const history: ChatTurn[] = current
      .filter((m) => m.role !== "note" && m.retry === undefined)
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role as ChatTurn["role"], text: m.text }));
    const about = latest.current.recipe;
    latest.current.loading = true;
    setMessages([...current, { id: nextId.current++, role: "user", text: message }]);
    setDraft("");
    setLoading(true);
    let reply: ChatMessage;
    try {
      const result = await sendChat(message, about?.id ?? null, history);
      reply = {
        id: nextId.current++,
        role: "assistant",
        text: result.reply,
        proposal: result.proposal,
        items: result.shopping_items,
        fallback: result.source === "fallback",
        about,
      };
    } catch (err) {
      reply = { id: nextId.current++, role: "assistant", text: errorMessage(err), retry: message };
    }
    setMessages((list) => [...list, reply]);
    if (!latest.current.open) setUnread(true);
    latest.current.loading = false;
    setLoading(false);
  }, []);

  const retry = useCallback(
    (failed: ChatMessage) => {
      // Drop the error bubble and the message it answered, then send that message again.
      const list = latest.current.messages;
      const index = list.findIndex((m) => m.id === failed.id);
      let asked = index - 1;
      while (asked >= 0 && list[asked]?.role !== "user") asked -= 1;
      void send(failed.retry ?? "", list.filter((_, i) => i !== index && i !== asked));
    },
    [send],
  );

  const setRecipe = useCallback((next: Recipe | null) => {
    const previous = latest.current.recipe;
    setRecipeState(next);
    if (previous?.id === next?.id || !latest.current.messages.length) return;
    const text = next ? `Now asking about ${next.title}.` : "Now asking about all recipes.";
    setMessages((list) => [...list, { id: nextId.current++, role: "note", text }]);
  }, []);

  const openChat = useCallback(
    (options: { recipe?: Recipe | null; draft?: string } = {}) => {
      setOpen(true);
      setUnread(false);
      setFocusRequest((n) => n + 1);
      if (options.recipe !== undefined) setRecipe(options.recipe);
      if (options.draft !== undefined) setDraft(options.draft);
    },
    [setRecipe],
  );

  const closeChat = useCallback(() => setOpen(false), []);
  const clear = useCallback(() => setMessages([]), []);
  const patchMessage = useCallback((id: number, patch: Partial<ChatMessage>) => {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const value = useMemo<ChatApi>(
    () => ({
      open, messages, loading, recipe, draft, unread, focusRequest,
      openChat, closeChat, setRecipe, setDraft, send: (text) => send(text), retry, clear, patchMessage,
    }),
    [open, messages, loading, recipe, draft, unread, focusRequest, openChat, closeChat, setRecipe, send, retry, clear, patchMessage],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

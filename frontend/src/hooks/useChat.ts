import { createContext, useContext } from "react";
import type { ChatProposal, Recipe } from "../types";

export interface ChatMessage {
  id: number;
  /** "note" marks a context change in the log; notes are never sent to the model. */
  role: "user" | "assistant" | "note";
  text: string;
  proposal?: ChatProposal | null;
  items?: string[];
  fallback?: boolean;
  /** Set on error bubbles: the message to send again. */
  retry?: string;
  /** The recipe the chat was about when this reply arrived (the proposal's "before"). */
  about?: Recipe | null;
  /** What happened to the proposal, so it isn't offered again after a reload. */
  outcome?: { kind: "saved"; text: string; recipeId: number } | { kind: "dismissed" };
  /** Suggested shopping items already added to the list. */
  added?: string[];
}

export interface ChatApi {
  open: boolean;
  messages: ChatMessage[];
  loading: boolean;
  /** The recipe the chat is about, or null for general kitchen help. */
  recipe: Recipe | null;
  draft: string;
  /** The chef replied while the panel was closed. */
  unread: boolean;
  /** Goes up each time something asks to open the chat, so the panel can move focus to its input. */
  focusRequest: number;
  /** Open the panel. Passing `recipe` (even null) changes the context; `draft` pre-fills the input. */
  openChat: (options?: { recipe?: Recipe | null; draft?: string }) => void;
  closeChat: () => void;
  setRecipe: (recipe: Recipe | null) => void;
  setDraft: (text: string) => void;
  send: (text: string) => Promise<void>;
  retry: (failed: ChatMessage) => void;
  clear: () => void;
  patchMessage: (id: number, patch: Partial<ChatMessage>) => void;
}

export const ChatContext = createContext<ChatApi | null>(null);

export function useChat(): ChatApi {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat must be used inside <ChatProvider>");
  return value;
}

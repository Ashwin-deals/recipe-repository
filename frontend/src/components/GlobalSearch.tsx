import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useChat } from "../hooks/useChat";
import { useDebounced } from "../hooks/useDebounced";
import { useRecipeLibrary } from "../hooks/useRecipeLibrary";
import { useShoppingList } from "../hooks/useShoppingList";
import { MAX_QUERY, highlight, searchItems, searchRecipes, type RecipeHit } from "../lib/search";
import type { ListItem } from "../types";
import { Icon } from "./Icon";

const DEBOUNCE_MS = 150;
const MAX_RECIPES = 6;
const MAX_ITEMS = 5;

type Option =
  | { kind: "recipe"; hit: RecipeHit }
  | { kind: "all"; count: number }
  | { kind: "item"; item: ListItem }
  | { kind: "ask" };

const FIELD_LABEL = { ingredient: "Ingredient", tag: "Tag", category: "Category" } as const;

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
    </>
  );
}

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable]")));

/**
 * Header search over recipes (title, ingredients, category, diet tags) and the shopping list,
 * filtered in the browser. On the Recipes page the query also lives in the URL (?q=) and filters
 * the grid. A combobox with a grouped listbox; "/" focuses it from anywhere.
 */
export function GlobalSearch() {
  const ids = useId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const library = useRecipeLibrary();
  const shopping = useShoppingList();
  const { openChat } = useChat();
  const onRecipesPage = pathname === "/";
  const urlQuery = onRecipesPage ? (params.get("q") ?? "") : "";

  const [text, setText] = useState(urlQuery);
  const query = useDebounced(text, DEBOUNCE_MS).trim();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const focusInput = useRef(false);
  // The last query written to (or read from) the URL, and whether the user has typed since.
  const synced = useRef(urlQuery);
  const typed = useRef(false);

  // Back/forward, "Clear search" on the page, or leaving the Recipes page: show what the URL says.
  useEffect(() => {
    if (urlQuery === synced.current) return;
    synced.current = urlQuery;
    typed.current = false;
    setText(urlQuery);
  }, [urlQuery]);

  // Typing on the Recipes page filters the grid through ?q= (replacing history, not pushing).
  useEffect(() => {
    if (!onRecipesPage || !typed.current || query === synced.current) return;
    typed.current = false;
    synced.current = query;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (query) next.set("q", query);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [query, onRecipesPage, setParams]);

  // "/" focuses the search from anywhere, unless you're typing or a dialog is open.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || document.documentElement.classList.contains("has-drawer")) return;
      event.preventDefault();
      focusInput.current = true;
      setExpanded(true);
      input.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // In the compact (phone) header the field only exists once expanded, so focus it after rendering.
  useEffect(() => {
    if (expanded && focusInput.current) {
      focusInput.current = false;
      input.current?.focus();
    }
  }, [expanded]);

  const items = useMemo(() => shopping.groups.flatMap((group) => group.items), [shopping.groups]);
  const recipeHits = useMemo(() => searchRecipes(library.recipes ?? [], query), [library.recipes, query]);
  const itemHits = useMemo(() => searchItems(items, query).slice(0, MAX_ITEMS), [items, query]);
  const recipesLoading = library.recipes === null && library.status !== "error";

  const recipeOptions: Option[] = recipeHits.slice(0, MAX_RECIPES).map((hit) => ({ kind: "recipe", hit }));
  if (recipeHits.length > 0 && (!onRecipesPage || recipeHits.length > MAX_RECIPES)) {
    recipeOptions.push({ kind: "all", count: recipeHits.length });
  }
  const itemOptions: Option[] = itemHits.map((hit) => ({ kind: "item", item: hit.item }));
  const empty = query !== "" && !recipesLoading && recipeOptions.length === 0 && itemOptions.length === 0;
  const options: Option[] = empty ? [{ kind: "ask" }] : [...recipeOptions, ...itemOptions];
  const showPanel = open && query !== "";

  useEffect(() => {
    setActive(-1);
  }, [query]);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${ids}-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, ids]);

  function change(value: string) {
    typed.current = true;
    setText(value);
    setOpen(true);
    library.load();
  }

  function collapse() {
    setOpen(false);
    setExpanded(false);
    toggle.current?.focus();
  }

  function clear() {
    change("");
    setOpen(false);
    input.current?.focus();
  }

  function choose(option: Option) {
    setOpen(false);
    if (option.kind === "recipe") library.openRecipe(option.hit.recipe);
    else if (option.kind === "all") navigate(`/?q=${encodeURIComponent(query)}`);
    else if (option.kind === "item") navigate("/shopping", { state: { highlightItem: option.item.id } });
    else openChat({ draft: text.trim() });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!showPanel) {
        if (text.trim()) {
          setOpen(true);
          library.load();
        }
        return;
      }
      if (!options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current < 0 && step < 0 ? options.length - 1 : (current + step + options.length) % options.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = showPanel ? options[active] : undefined;
      if (option) choose(option);
      else if (text.trim() && !onRecipesPage) navigate(`/?q=${encodeURIComponent(text.trim())}`);
      else setOpen(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (text) {
        change("");
        setOpen(false);
      } else if (expanded) {
        collapse();
      } else {
        setOpen(false);
      }
    }
  }

  const activeId = showPanel && active >= 0 ? `${ids}-opt-${active}` : undefined;
  const listId = `${ids}-list`;
  let index = -1;
  const renderOption = (option: Option) => {
    index += 1;
    const optionIndex = index;
    const props = {
      id: `${ids}-opt-${optionIndex}`,
      role: "option",
      "aria-selected": optionIndex === active,
      className: `search-option${optionIndex === active ? " is-active" : ""}`,
      onMouseDown: (event: MouseEvent) => event.preventDefault(),
      onMouseMove: () => setActive(optionIndex),
      onClick: () => choose(option),
    } as const;

    if (option.kind === "recipe") {
      const { recipe, detail } = option.hit;
      return (
        <div key={`r-${recipe.id}`} {...props}>
          <span className="search-option-main">
            <span className="search-option-title">
              <Highlighted text={recipe.title} query={query} />
            </span>
            {detail && (
              <span className="search-option-detail">
                {FIELD_LABEL[detail.field]} · <Highlighted text={detail.text} query={query} />
              </span>
            )}
          </span>
          <span className="search-option-meta">
            <span className={`search-cat cat-${recipe.category.toLowerCase()}`}>{recipe.category}</span>
            <span className="num">{recipe.prep_time} min</span>
          </span>
        </div>
      );
    }
    if (option.kind === "all") {
      return (
        <div key="all" {...props} className={`${props.className} search-option-all`}>
          See all {option.count} matching recipes <Icon name="arrow" />
        </div>
      );
    }
    if (option.kind === "item") {
      const { item } = option;
      return (
        <div key={`i-${item.id}`} {...props}>
          <span className="search-option-main">
            <span className={`search-option-title${item.checked ? " is-checked" : ""}`}>
              <Highlighted text={item.name} query={query} />
            </span>
            <span className="search-option-detail">
              {item.aisle}
              {item.checked ? " · ticked off" : ""}
            </span>
          </span>
          {item.amount && <span className="search-option-meta num">{item.amount}</span>}
        </div>
      );
    }
    return (
      <div key="ask" {...props} className={`${props.className} search-option-ask`}>
        <Icon name="chat" /> Try Ask the chef!
      </div>
    );
  };

  const summary = !showPanel
    ? ""
    : recipesLoading
      ? "Searching…"
      : empty
        ? "No matches."
        : `${recipeHits.length} ${recipeHits.length === 1 ? "recipe" : "recipes"} and ${itemHits.length} list ${itemHits.length === 1 ? "item" : "items"} found.`;

  return (
    <div
      ref={root}
      className="search"
      role="search"
      data-expanded={expanded || undefined}
      onBlur={(event) => {
        if (root.current?.contains(event.relatedTarget as Node | null)) return;
        setOpen(false);
        if (!text) setExpanded(false);
      }}
    >
      <button
        ref={toggle}
        type="button"
        className="search-toggle"
        aria-label="Search"
        aria-expanded={expanded}
        onClick={() => {
          focusInput.current = true;
          setExpanded(true);
        }}
      >
        <Icon name="search" />
      </button>
      <div className="search-field">
        <Icon name="search" />
        <input
          ref={input}
          type="text"
          className="search-input"
          role="combobox"
          aria-label="Search recipes, ingredients, tags and your list"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-keyshortcuts="/"
          placeholder="Search recipes, ingredients, tags..."
          maxLength={MAX_QUERY}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={text}
          onChange={(event) => change(event.target.value)}
          onClick={() => {
            if (text.trim()) {
              setOpen(true);
              library.load();
            }
          }}
          onKeyDown={onKeyDown}
        />
        {text ? (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={clear}>
            <Icon name="close" />
          </button>
        ) : (
          <>
            <kbd className="search-kbd" aria-hidden="true">/</kbd>
            <button type="button" className="search-clear search-collapse" aria-label="Close search" onClick={collapse}>
              <Icon name="close" />
            </button>
          </>
        )}
      </div>

      <div className="search-panel" hidden={!showPanel}>
        <div role="listbox" id={listId} aria-label="Search results">
          {recipeOptions.length > 0 && (
            <div role="group" aria-labelledby={`${ids}-g-recipes`}>
              <div id={`${ids}-g-recipes`} role="presentation" className="search-group">Recipes</div>
              {recipeOptions.map(renderOption)}
            </div>
          )}
          {itemOptions.length > 0 && (
            <div role="group" aria-labelledby={`${ids}-g-items`}>
              <div id={`${ids}-g-items`} role="presentation" className="search-group">On your list</div>
              {itemOptions.map(renderOption)}
            </div>
          )}
          {empty && (
            <div role="group" aria-labelledby={`${ids}-g-empty`}>
              <div id={`${ids}-g-empty`} role="presentation" className="search-empty">No matches.</div>
              {options.map(renderOption)}
            </div>
          )}
        </div>
        {recipesLoading && (
          <p className="search-loading">
            <span className="spinner" aria-hidden="true" /> Searching recipes…
          </p>
        )}
        {library.status === "error" && library.recipes === null && <p className="search-loading">Couldn't load recipes to search.</p>}
      </div>
      <p className="visually-hidden" role="status">
        {summary}
      </p>
    </div>
  );
}

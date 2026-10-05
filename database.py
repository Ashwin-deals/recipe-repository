"""SQLite schema, connections and queries. All SQL is parameterized.

Every recipe, list item, plan entry and event belongs to one user. Every query here takes the
owner's id and filters on it, so a caller can't read or change another user's rows by id.
"""
from __future__ import annotations

import json
import logging
import secrets
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import ingredients
from ingredients import CATEGORIES

log = logging.getLogger("cartchef")

DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MULTIPLIERS = (1, 2, 3, 4)
TITLE_MAX = 120
PREP_TIME_MAX = 1440

# Tables that hold a user's data. Before accounts existed they had no owner column.
OWNED_TABLES = ("meal_plan", "shopping_list", "recipes", "events")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    display_name  TEXT    NOT NULL,
    is_demo       INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    remember   INTEGER NOT NULL DEFAULT 0 CHECK (remember IN (0, 1)),
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT    NOT NULL,
    last_seen  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

-- Failed sign-ins, keyed by a hash of the email (and client), for the lockout.
CREATE TABLE IF NOT EXISTS auth_failures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_failures ON auth_failures (key, created_at);

CREATE TABLE IF NOT EXISTS recipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    prep_time   INTEGER NOT NULL CHECK (prep_time BETWEEN 0 AND 1440),
    category    TEXT    NOT NULL CHECK (category IN ('Breakfast', 'Lunch', 'Dinner', 'Dessert')),
    ingredients TEXT    NOT NULL,
    nutrition   TEXT,
    diet_tags   TEXT    NOT NULL DEFAULT '[]',
    created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes (user_id, created_at);

CREATE TABLE IF NOT EXISTS shopping_list (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    item_key   TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    unit       TEXT,
    qty        TEXT,
    aisle      TEXT    NOT NULL DEFAULT 'Other',
    checked    INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
    sources    TEXT    NOT NULL DEFAULT '[]',
    -- 1 when every addition to this row is recorded in list_contributions. Rows added before
    -- contributions were tracked stay 0 and fall back to matching by source title.
    tracked    INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0, 1)),
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shopping_user_key ON shopping_list (user_id, item_key, checked);

-- What each recipe (or a hand-typed line, recipe_id NULL) added to a list row, in the units it
-- was added in, so deleting a recipe can take back exactly its share of a merged item.
CREATE TABLE IF NOT EXISTS list_contributions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    item_id    INTEGER NOT NULL REFERENCES shopping_list (id) ON DELETE CASCADE,
    recipe_id  INTEGER REFERENCES recipes (id) ON DELETE CASCADE,
    qty        TEXT,
    unit       TEXT,
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contributions_item ON list_contributions (item_id);
CREATE INDEX IF NOT EXISTS idx_contributions_recipe ON list_contributions (user_id, recipe_id);

CREATE TABLE IF NOT EXISTS meal_plan (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day        TEXT    NOT NULL CHECK (day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday',
                                               'Friday', 'Saturday', 'Sunday')),
    recipe_id  INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    multiplier INTEGER NOT NULL DEFAULT 1 CHECK (multiplier BETWEEN 1 AND 4)
);
CREATE INDEX IF NOT EXISTS idx_meal_plan_user ON meal_plan (user_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_recipe ON meal_plan (recipe_id);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_user ON events (user_id, type, created_at);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Connection(sqlite3.Connection):
    """Connection that hands logged events to ``on_commit`` once they are committed.

    This keeps the BigQuery mirror from seeing events of a rolled-back request.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pending_events: list[dict] = []
        self.on_commit = None

    def commit(self):
        super().commit()
        events, self.pending_events = self.pending_events, []
        if events and self.on_commit:
            self.on_commit(events)

    def rollback(self):
        super().rollback()
        self.pending_events = []


def connect(path: str) -> Connection:
    conn = sqlite3.connect(path, factory=Connection, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        drop_ownerless_tables(conn)
        conn.executescript(SCHEMA)
        add_missing_columns(conn)
        conn.commit()
    finally:
        conn.close()


def _columns(conn: sqlite3.Connection, table: str) -> set[str] | None:
    """Column names of a table, or None if it doesn't exist."""
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()  # table names are constants
    return {row["name"] for row in rows} if rows else None


def drop_ownerless_tables(conn: sqlite3.Connection) -> dict[str, int]:
    """Migrate a database from before accounts: its rows have no owner, so they are deleted.

    Shared rows must never be shown to anyone once accounts exist, and new accounts get their
    own copy of the starter recipes. Old tables are dropped (SQLite can't add a NOT NULL
    foreign key column) and SCHEMA recreates them. Ids keep counting up so an old link or
    cached id can never point at a new user's row. Safe to run on every start.

    Returns the number of rows deleted per table (empty when there was nothing to migrate).
    """
    stale = [t for t in OWNED_TABLES if (cols := _columns(conn, t)) is not None and "user_id" not in cols]
    if not stale:
        return {}
    if conn.in_transaction:
        conn.commit()
    has_sequence = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
    ).fetchone()
    sequences = dict(conn.execute("SELECT name, seq FROM sqlite_sequence").fetchall()) if has_sequence else {}
    removed: dict[str, int] = {}
    conn.execute("BEGIN IMMEDIATE")
    try:
        for table in OWNED_TABLES:  # children first, so no foreign key points at a dropped table
            if table in stale:
                removed[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                conn.execute(f"DROP TABLE {table}")
        if _columns(conn, "meta"):
            conn.execute("DELETE FROM meta WHERE key = 'seeded'")  # demo data is now per user
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    conn.executescript(SCHEMA)
    for table in stale:
        if sequences.get(table):
            conn.execute("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", (table, sequences[table]))
    conn.commit()
    log.warning("Removed data from before accounts existed (it had no owner): %s", removed)
    return removed


def add_missing_columns(conn: sqlite3.Connection) -> list[str]:
    """Add columns introduced after a table was first created. Safe to run on every start.

    Existing shopping_list rows get tracked = 0: their history isn't in list_contributions.
    """
    added = []
    if "tracked" not in (_columns(conn, "shopping_list") or {"tracked"}):
        conn.execute("ALTER TABLE shopping_list ADD COLUMN tracked INTEGER NOT NULL DEFAULT 0 "
                     "CHECK (tracked IN (0, 1))")
        added.append("shopping_list.tracked")
    return added


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def get_or_create_secret_key(path: str) -> str:
    """A stable development secret shared by all workers and restarts (it is stored in the DB).

    Only used outside production; production must set SECRET_KEY.
    """
    conn = connect(path)
    try:
        key = get_meta(conn, "secret_key")
        if key is None:
            key = secrets.token_hex(32)
            conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('secret_key', ?)", (key,))
            conn.commit()
            key = get_meta(conn, "secret_key")
        return key
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Events
# --------------------------------------------------------------------------

def log_event(conn: Connection, user_id: int, event_type: str, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False)
    conn.execute("INSERT INTO events (user_id, type, payload) VALUES (?, ?, ?)", (user_id, event_type, body))
    if isinstance(conn, Connection):
        conn.pending_events.append({
            "user_id": user_id,
            "type": event_type,
            "payload": body,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })


# --------------------------------------------------------------------------
# Recipes
# --------------------------------------------------------------------------

def validate_recipe(title, prep_time, category, ingredient_text) -> tuple[dict, dict]:
    """Return (clean data, errors by field). Errors is empty when the input is valid."""
    errors: dict[str, str] = {}
    title = " ".join(str(title or "").split())
    if not title:
        errors["title"] = "Give the recipe a title."
    elif len(title) > TITLE_MAX:
        errors["title"] = f"Keep the title under {TITLE_MAX} characters."

    try:
        prep = int(str(prep_time).strip())
        if not 0 <= prep <= PREP_TIME_MAX:
            raise ValueError
    except (TypeError, ValueError):
        prep = None
        errors["prep_time"] = f"Prep time must be a whole number of minutes from 0 to {PREP_TIME_MAX}."

    if category not in CATEGORIES:
        errors["category"] = "Pick Breakfast, Lunch, Dinner or Dessert."

    raw_lines = [line for line in str(ingredient_text or "").splitlines() if line.strip()]
    lines = ingredients.split_lines(str(ingredient_text or ""))
    if not lines:
        errors["ingredients"] = "Add at least one ingredient, one per line."
    elif len(raw_lines) > ingredients.MAX_LINES:
        errors["ingredients"] = f"Keep it to {ingredients.MAX_LINES} ingredients or fewer."
    elif any(len(line.strip()) > ingredients.MAX_LINE_LENGTH for line in raw_lines):
        errors["ingredients"] = f"Each ingredient line must be under {ingredients.MAX_LINE_LENGTH} characters."

    data = {"title": title, "prep_time": prep, "category": category, "ingredients": lines}
    return data, errors


def create_recipe(conn: sqlite3.Connection, user_id: int, data: dict) -> int:
    lines = data["ingredients"]
    cursor = conn.execute(
        """INSERT INTO recipes (user_id, title, prep_time, category, ingredients, diet_tags)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (user_id, data["title"], data["prep_time"], data["category"], "\n".join(lines),
         json.dumps(ingredients.keyword_diet_tags(lines))),
    )
    return cursor.lastrowid


def seed_recipes(conn: sqlite3.Connection, user_id: int) -> int:
    """Give a user their own copy of the starter recipes. Returns how many were added."""
    for recipe in SEED_RECIPES:
        create_recipe(conn, user_id, recipe)
    return len(SEED_RECIPES)


def update_recipe(conn: sqlite3.Connection, user_id: int, recipe_id: int, data: dict) -> bool:
    """Replace a recipe's content. Nutrition is cleared because the ingredients may have changed."""
    lines = data["ingredients"]
    cursor = conn.execute(
        """UPDATE recipes SET title = ?, prep_time = ?, category = ?, ingredients = ?, diet_tags = ?, nutrition = NULL
           WHERE id = ? AND user_id = ?""",
        (data["title"], data["prep_time"], data["category"], "\n".join(lines),
         json.dumps(ingredients.keyword_diet_tags(lines)), recipe_id, user_id),
    )
    return cursor.rowcount > 0


def _recipe_from_row(row: sqlite3.Row) -> dict:
    recipe = dict(row)
    del recipe["user_id"]  # the owner is always the caller; no need to echo it
    recipe["lines"] = recipe["ingredients"].splitlines()
    recipe["diet_tags"] = json.loads(recipe["diet_tags"] or "[]")
    recipe["nutrition"] = json.loads(recipe["nutrition"]) if recipe["nutrition"] else None
    return recipe


def list_recipes(conn: sqlite3.Connection, user_id: int, category: str | None = None) -> list[dict]:
    if category:
        rows = conn.execute(
            "SELECT * FROM recipes WHERE user_id = ? AND category = ? ORDER BY created_at DESC, id DESC",
            (user_id, category),
        )
    else:
        rows = conn.execute("SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC, id DESC", (user_id,))
    return [_recipe_from_row(row) for row in rows]


def get_recipe(conn: sqlite3.Connection, user_id: int, recipe_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM recipes WHERE id = ? AND user_id = ?", (recipe_id, user_id)).fetchone()
    return _recipe_from_row(row) if row else None


def delete_recipe(conn: sqlite3.Connection, user_id: int, recipe_id: int) -> bool:
    return conn.execute("DELETE FROM recipes WHERE id = ? AND user_id = ?", (recipe_id, user_id)).rowcount > 0


def save_nutrition(conn: sqlite3.Connection, user_id: int, recipe_id: int, nutrition: dict | None,
                   diet_tags: list[str]) -> None:
    conn.execute(
        "UPDATE recipes SET nutrition = ?, diet_tags = ? WHERE id = ? AND user_id = ?",
        (json.dumps(nutrition) if nutrition else None, json.dumps(diet_tags), recipe_id, user_id),
    )


# --------------------------------------------------------------------------
# Meal planner
# --------------------------------------------------------------------------

def list_plan(conn: sqlite3.Connection, user_id: int) -> dict[str, list[dict]]:
    rows = conn.execute(
        """SELECT meal_plan.id, meal_plan.day, meal_plan.multiplier, recipes.id AS recipe_id,
                  recipes.title, recipes.category, recipes.prep_time
           FROM meal_plan JOIN recipes ON recipes.id = meal_plan.recipe_id AND recipes.user_id = meal_plan.user_id
           WHERE meal_plan.user_id = ?
           ORDER BY meal_plan.id""",
        (user_id,),
    ).fetchall()
    plan: dict[str, list[dict]] = {day: [] for day in DAYS}
    for row in rows:
        plan[row["day"]].append(dict(row))
    return plan


def add_to_plan(conn: sqlite3.Connection, user_id: int, day: str, recipe_id: int, multiplier: int) -> int | None:
    """Plan one of the user's own recipes. Returns None if they have no recipe with that id."""
    cursor = conn.execute(
        """INSERT INTO meal_plan (user_id, day, recipe_id, multiplier)
           SELECT ?, ?, id, ? FROM recipes WHERE id = ? AND user_id = ?""",
        (user_id, day, multiplier, recipe_id, user_id),
    )
    return cursor.lastrowid if cursor.rowcount else None


def remove_from_plan(conn: sqlite3.Connection, user_id: int, entry_id: int) -> bool:
    return conn.execute("DELETE FROM meal_plan WHERE id = ? AND user_id = ?", (entry_id, user_id)).rowcount > 0


def clear_plan(conn: sqlite3.Connection, user_id: int) -> int:
    return conn.execute("DELETE FROM meal_plan WHERE user_id = ?", (user_id,)).rowcount


# --------------------------------------------------------------------------
# AI usage caps
# --------------------------------------------------------------------------

AI_CALL_EVENT = "ai_call"


def ai_calls_today(conn: sqlite3.Connection, user_id: int | None = None, day: date | None = None) -> int:
    """AI calls made today (UTC): by one user, or by everyone when user_id is None."""
    day = day or datetime.now(timezone.utc).date()
    start = f"{day.isoformat()} 00:00:00"
    end = f"{(day + timedelta(days=1)).isoformat()} 00:00:00"
    sql = "SELECT COUNT(*) FROM events WHERE type = ? AND created_at >= ? AND created_at < ?"
    params: tuple = (AI_CALL_EVENT, start, end)
    if user_id is not None:
        sql += " AND user_id = ?"
        params += (user_id,)
    return conn.execute(sql, params).fetchone()[0]


def consume_ai_call(conn: Connection, user_id: int, daily_cap: int, user_cap: int, *,
                    feature: str = "unknown") -> str | None:
    """Record one AI call. Returns None if it may go ahead, or which cap is used up: "user" or "all".

    Both caps count per UTC day: ``user_cap`` for this user, ``daily_cap`` for everyone together.
    BEGIN IMMEDIATE takes the write lock before counting, so concurrent requests can't both
    squeeze under a cap.
    """
    if daily_cap <= 0:
        return "all"
    if user_cap <= 0:
        return "user"
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if ai_calls_today(conn) >= daily_cap:
            conn.rollback()
            return "all"
        if ai_calls_today(conn, user_id) >= user_cap:
            conn.rollback()
            return "user"
        log_event(conn, user_id, AI_CALL_EVENT, {"feature": feature})
        conn.commit()
        return None
    except Exception:
        conn.rollback()
        raise


# --------------------------------------------------------------------------
# Insights (one user's own activity)
# --------------------------------------------------------------------------

def _bars(rows) -> list[dict]:
    rows = [dict(row) for row in rows]
    top = max((row["count"] for row in rows), default=0)
    for row in rows:
        row["percent"] = round(100 * row["count"] / top) if top else 0
    return rows


def insights(conn: sqlite3.Connection, user_id: int) -> dict:
    top_recipes = conn.execute(
        """SELECT json_extract(payload, '$.title') AS label, COUNT(*) AS count
           FROM events WHERE user_id = ? AND type = 'list_added'
           GROUP BY json_extract(payload, '$.recipe_id')
           ORDER BY count DESC, label LIMIT 8""",
        (user_id,),
    ).fetchall()
    top_items = conn.execute(
        """SELECT MAX(json_extract(payload, '$.name')) AS label, COUNT(*) AS count
           FROM events WHERE user_id = ? AND type = 'item_checked' AND json_extract(payload, '$.checked') = 1
           GROUP BY json_extract(payload, '$.item_key')
           ORDER BY count DESC, label LIMIT 10""",
        (user_id,),
    ).fetchall()
    added_by_category = {
        row["category"]: row["count"]
        for row in conn.execute(
            """SELECT json_extract(payload, '$.category') AS category, COUNT(*) AS count
               FROM events WHERE user_id = ? AND type = 'list_added' GROUP BY category""",
            (user_id,),
        )
    }
    recent_by_category = {
        row["category"]: row["count"]
        for row in conn.execute(
            """SELECT json_extract(payload, '$.category') AS category, COUNT(*) AS count
               FROM events WHERE user_id = ? AND type = 'list_added' AND created_at >= datetime('now', '-7 days')
               GROUP BY category""",
            (user_id,),
        )
    }
    saved_by_category = {
        row["category"]: row["count"]
        for row in conn.execute(
            "SELECT category, COUNT(*) AS count FROM recipes WHERE user_id = ? GROUP BY category", (user_id,)
        )
    }
    top_category = max([*added_by_category.values(), *saved_by_category.values(), 0])
    categories = [
        {
            "label": category,
            "saved": saved_by_category.get(category, 0),
            "added": added_by_category.get(category, 0),
            "recent": recent_by_category.get(category, 0),
            "saved_percent": round(100 * saved_by_category.get(category, 0) / top_category) if top_category else 0,
            "added_percent": round(100 * added_by_category.get(category, 0) / top_category) if top_category else 0,
        }
        for category in CATEGORIES
    ]
    counts = conn.execute(
        """SELECT (SELECT COUNT(*) FROM recipes WHERE user_id = :u) AS recipes,
                  (SELECT COUNT(*) FROM shopping_list WHERE user_id = :u AND checked = 0) AS open_items,
                  (SELECT COUNT(*) FROM events WHERE user_id = :u AND type = 'list_added') AS lists_built,
                  (SELECT COUNT(*) FROM events WHERE user_id = :u AND type = 'list_cleared') AS trips""",
        {"u": user_id},
    ).fetchone()
    return {
        "top_recipes": _bars(top_recipes),
        "top_items": _bars(top_items),
        "categories": categories,
        "counts": dict(counts),
    }


# --------------------------------------------------------------------------
# Demo data: overlapping onion, eggs, milk, flour, butter and garlic show off merging.
# --------------------------------------------------------------------------

SEED_RECIPES = (
    {"title": "Fluffy Buttermilk-Style Pancakes", "prep_time": 20, "category": "Breakfast", "ingredients": [
        "2 cups flour", "2 tbsp sugar", "2 tsp baking powder", "1/2 tsp salt", "2 eggs",
        "1 1/2 cups milk", "1 tbsp lemon juice", "3 tbsp butter, melted",
    ]},
    {"title": "Masala Omelette", "prep_time": 15, "category": "Breakfast", "ingredients": [
        "3 large eggs", "1 small onion, finely chopped", "1 green chili, chopped", "2 tbsp milk",
        "1 tbsp butter", "¼ tsp turmeric", "2 tbsp fresh coriander, chopped", "salt to taste",
    ]},
    {"title": "Creamy Garlic Mushroom Pasta", "prep_time": 25, "category": "Dinner", "ingredients": [
        "250 g spaghetti", "2 cups mushrooms, sliced", "4 cloves garlic, minced", "1 onion, diced",
        "2 tbsp butter", "1 cup milk", "1 tbsp flour", "½ cup parmesan, grated", "black pepper to taste",
    ]},
    {"title": "Chicken Tikka Curry", "prep_time": 45, "category": "Dinner", "ingredients": [
        "500 g chicken thighs", "2 onions, chopped", "3 garlic cloves, minced",
        "2-inch piece ginger, grated", "1 (14 oz) can chopped tomatoes", "1 cup plain yogurt",
        "2 tsp garam masala", "1 tsp ground cumin", "1-2 tbsp oil", "½ cup cream", "1 1/2 tsp salt",
    ]},
    {"title": "Chewy Chocolate Chip Cookies", "prep_time": 30, "category": "Dessert", "ingredients": [
        "2 1/4 cups flour", "1 tsp baking soda", "1 cup butter, softened", "3/4 cup sugar",
        "3/4 cup brown sugar", "2 eggs", "2 tsp vanilla extract", "2 cups chocolate chips",
        "1/2 cup walnuts, chopped",
    ]},
    {"title": "Warm Apple Crumble", "prep_time": 50, "category": "Dessert", "ingredients": [
        "6 apples, peeled and sliced", "1 tbsp lemon juice", "½ cup sugar", "1 tsp cinnamon",
        "1 cup flour", "½ cup butter, cold", "½ cup rolled oats", "a pinch of salt",
    ]},
)

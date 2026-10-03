"""SQLite schema, connections and queries. All SQL is parameterized."""
from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import ingredients
from ingredients import CATEGORIES

DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MULTIPLIERS = (1, 2, 3, 4)
TITLE_MAX = 120
PREP_TIME_MAX = 1440

RECIPES_TABLE = """
CREATE TABLE IF NOT EXISTS {name} (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    prep_time   INTEGER NOT NULL CHECK (prep_time BETWEEN 0 AND 1440),
    category    TEXT    NOT NULL CHECK (category IN ('Breakfast', 'Lunch', 'Dinner', 'Dessert')),
    ingredients TEXT    NOT NULL,
    nutrition   TEXT,
    diet_tags   TEXT    NOT NULL DEFAULT '[]',
    created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

SCHEMA = RECIPES_TABLE.format(name="recipes") + """
CREATE TABLE IF NOT EXISTS shopping_list (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_key   TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    unit       TEXT,
    qty        TEXT,
    aisle      TEXT    NOT NULL DEFAULT 'Other',
    checked    INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
    sources    TEXT    NOT NULL DEFAULT '[]',
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shopping_key ON shopping_list (item_key, checked);

CREATE TABLE IF NOT EXISTS meal_plan (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    day        TEXT    NOT NULL CHECK (day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday',
                                               'Friday', 'Saturday', 'Sunday')),
    recipe_id  INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    multiplier INTEGER NOT NULL DEFAULT 1 CHECK (multiplier BETWEEN 1 AND 4)
);

CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type, created_at);

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


def init_db(path: str, *, seed: bool = True) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        _allow_every_category(conn)
        if seed and get_meta(conn, "seeded") is None:
            for recipe in SEED_RECIPES:
                create_recipe(conn, recipe)
            set_meta(conn, "seeded", "1")
        conn.commit()
    finally:
        conn.close()


def _allow_every_category(conn: sqlite3.Connection) -> None:
    """Rebuild a recipes table whose CHECK predates a category (e.g. Lunch); SQLite can't alter a CHECK.

    Follows SQLite's create-copy-drop-rename recipe with foreign keys off, so meal_plan rows
    are not cascade-deleted and their recipe_id references stay valid.
    """
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'recipes'").fetchone()[0]
    if all(f"'{category}'" in sql for category in CATEGORIES):
        return
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        row = conn.execute("SELECT seq FROM sqlite_sequence WHERE name = 'recipes'").fetchone()
        conn.execute("BEGIN")
        conn.execute(RECIPES_TABLE.format(name="recipes_new"))
        conn.execute("INSERT INTO recipes_new SELECT id, title, prep_time, category, ingredients, nutrition, "
                     "diet_tags, created_at FROM recipes")
        conn.execute("DROP TABLE recipes")
        conn.execute("ALTER TABLE recipes_new RENAME TO recipes")
        if row:  # keep ids of deleted recipes from being reused
            conn.execute("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'recipes'", (row[0],))
        if conn.execute("PRAGMA foreign_key_check").fetchall():
            raise sqlite3.IntegrityError("recipes migration broke a foreign key")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def get_or_create_secret_key(path: str) -> str:
    """A stable secret shared by all workers and restarts (it is backed up with the DB)."""
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

def log_event(conn: Connection, event_type: str, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False)
    conn.execute("INSERT INTO events (type, payload) VALUES (?, ?)", (event_type, body))
    if isinstance(conn, Connection):
        conn.pending_events.append({
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


def create_recipe(conn: sqlite3.Connection, data: dict) -> int:
    lines = data["ingredients"]
    cursor = conn.execute(
        "INSERT INTO recipes (title, prep_time, category, ingredients, diet_tags) VALUES (?, ?, ?, ?, ?)",
        (data["title"], data["prep_time"], data["category"], "\n".join(lines),
         json.dumps(ingredients.keyword_diet_tags(lines))),
    )
    return cursor.lastrowid


def update_recipe(conn: sqlite3.Connection, recipe_id: int, data: dict) -> bool:
    """Replace a recipe's content. Nutrition is cleared because the ingredients may have changed."""
    lines = data["ingredients"]
    cursor = conn.execute(
        """UPDATE recipes SET title = ?, prep_time = ?, category = ?, ingredients = ?, diet_tags = ?, nutrition = NULL
           WHERE id = ?""",
        (data["title"], data["prep_time"], data["category"], "\n".join(lines),
         json.dumps(ingredients.keyword_diet_tags(lines)), recipe_id),
    )
    return cursor.rowcount > 0


def _recipe_from_row(row: sqlite3.Row) -> dict:
    recipe = dict(row)
    recipe["lines"] = recipe["ingredients"].splitlines()
    recipe["diet_tags"] = json.loads(recipe["diet_tags"] or "[]")
    recipe["nutrition"] = json.loads(recipe["nutrition"]) if recipe["nutrition"] else None
    return recipe


def list_recipes(conn: sqlite3.Connection, category: str | None = None) -> list[dict]:
    if category:
        rows = conn.execute(
            "SELECT * FROM recipes WHERE category = ? ORDER BY created_at DESC, id DESC", (category,)
        )
    else:
        rows = conn.execute("SELECT * FROM recipes ORDER BY created_at DESC, id DESC")
    return [_recipe_from_row(row) for row in rows]


def get_recipe(conn: sqlite3.Connection, recipe_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    return _recipe_from_row(row) if row else None


def delete_recipe(conn: sqlite3.Connection, recipe_id: int) -> bool:
    return conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,)).rowcount > 0


def save_nutrition(conn: sqlite3.Connection, recipe_id: int, nutrition: dict | None, diet_tags: list[str]) -> None:
    conn.execute(
        "UPDATE recipes SET nutrition = ?, diet_tags = ? WHERE id = ?",
        (json.dumps(nutrition) if nutrition else None, json.dumps(diet_tags), recipe_id),
    )


# --------------------------------------------------------------------------
# Meal planner
# --------------------------------------------------------------------------

def list_plan(conn: sqlite3.Connection) -> dict[str, list[dict]]:
    rows = conn.execute(
        """SELECT meal_plan.id, meal_plan.day, meal_plan.multiplier, recipes.id AS recipe_id,
                  recipes.title, recipes.category, recipes.prep_time
           FROM meal_plan JOIN recipes ON recipes.id = meal_plan.recipe_id
           ORDER BY meal_plan.id"""
    ).fetchall()
    plan: dict[str, list[dict]] = {day: [] for day in DAYS}
    for row in rows:
        plan[row["day"]].append(dict(row))
    return plan


def add_to_plan(conn: sqlite3.Connection, day: str, recipe_id: int, multiplier: int) -> int:
    cursor = conn.execute(
        "INSERT INTO meal_plan (day, recipe_id, multiplier) VALUES (?, ?, ?)", (day, recipe_id, multiplier)
    )
    return cursor.lastrowid


def remove_from_plan(conn: sqlite3.Connection, entry_id: int) -> bool:
    return conn.execute("DELETE FROM meal_plan WHERE id = ?", (entry_id,)).rowcount > 0


def clear_plan(conn: sqlite3.Connection) -> int:
    return conn.execute("DELETE FROM meal_plan").rowcount


# --------------------------------------------------------------------------
# AI usage cap
# --------------------------------------------------------------------------

AI_CALL_EVENT = "ai_call"


def ai_calls_today(conn: sqlite3.Connection, day: date | None = None) -> int:
    day = day or datetime.now(timezone.utc).date()
    start = f"{day.isoformat()} 00:00:00"
    end = f"{(day + timedelta(days=1)).isoformat()} 00:00:00"
    return conn.execute(
        "SELECT COUNT(*) FROM events WHERE type = ? AND created_at >= ? AND created_at < ?",
        (AI_CALL_EVENT, start, end),
    ).fetchone()[0]


def consume_ai_call(conn: Connection, daily_cap: int, *, feature: str = "unknown") -> bool:
    """Record one AI call in the events table. Returns False once today's (UTC) cap is reached.

    BEGIN IMMEDIATE takes the write lock before counting, so concurrent requests can't both
    squeeze under the cap.
    """
    if daily_cap <= 0:
        return False
    if conn.in_transaction:
        conn.commit()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if ai_calls_today(conn) >= daily_cap:
            conn.rollback()
            return False
        log_event(conn, AI_CALL_EVENT, {"feature": feature})
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise


# --------------------------------------------------------------------------
# Insights
# --------------------------------------------------------------------------

def _bars(rows) -> list[dict]:
    rows = [dict(row) for row in rows]
    top = max((row["count"] for row in rows), default=0)
    for row in rows:
        row["percent"] = round(100 * row["count"] / top) if top else 0
    return rows


def insights(conn: sqlite3.Connection) -> dict:
    top_recipes = conn.execute(
        """SELECT json_extract(payload, '$.title') AS label, COUNT(*) AS count
           FROM events WHERE type = 'list_added'
           GROUP BY json_extract(payload, '$.recipe_id')
           ORDER BY count DESC, label LIMIT 8"""
    ).fetchall()
    top_items = conn.execute(
        """SELECT MAX(json_extract(payload, '$.name')) AS label, COUNT(*) AS count
           FROM events WHERE type = 'item_checked' AND json_extract(payload, '$.checked') = 1
           GROUP BY json_extract(payload, '$.item_key')
           ORDER BY count DESC, label LIMIT 10"""
    ).fetchall()
    added_by_category = {
        row["category"]: row["count"]
        for row in conn.execute(
            """SELECT json_extract(payload, '$.category') AS category, COUNT(*) AS count
               FROM events WHERE type = 'list_added' GROUP BY category"""
        )
    }
    recent_by_category = {
        row["category"]: row["count"]
        for row in conn.execute(
            """SELECT json_extract(payload, '$.category') AS category, COUNT(*) AS count
               FROM events WHERE type = 'list_added' AND created_at >= datetime('now', '-7 days')
               GROUP BY category"""
        )
    }
    saved_by_category = {
        row["category"]: row["count"]
        for row in conn.execute("SELECT category, COUNT(*) AS count FROM recipes GROUP BY category")
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
        """SELECT (SELECT COUNT(*) FROM recipes) AS recipes,
                  (SELECT COUNT(*) FROM shopping_list WHERE checked = 0) AS open_items,
                  (SELECT COUNT(*) FROM events WHERE type = 'list_added') AS lists_built,
                  (SELECT COUNT(*) FROM events WHERE type = 'list_cleared') AS trips"""
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

"""Shopping list: add lines with smart merging, check items, clear, and group by aisle."""
from __future__ import annotations

import json
import sqlite3
from fractions import Fraction

import database
import ingredients as ing

MAX_SOURCES = 10


def _merge_amounts(old_qty: Fraction, old_unit: str | None, qty: Fraction, unit: str | None):
    total = old_qty + ing.convert(qty, unit, old_unit) if old_unit else old_qty + qty
    return ing.normalize(total, old_unit, compound=True)


def _find_target(rows, qty: Fraction | None, unit: str | None):
    """Pick the unchecked row this line should merge into, or None to insert a new row."""
    if qty is None:
        return rows[0] if rows else None
    for row in rows:
        if row["qty"] is not None and ing.units_compatible(row["unit"], unit):
            return row
    return next((row for row in rows if row["qty"] is None), None)


def add_line(conn: sqlite3.Connection, line: str, *, multiplier: int = 1, source: str | None = None) -> str | None:
    """Add one ingredient line. Returns 'added', 'merged', or None if the line was empty."""
    parsed = ing.parse_line(line)
    key = ing.merge_key(parsed.text)
    if not key:
        return None
    qty, unit = parsed.shopping_qty, parsed.unit
    if qty is not None:
        qty, unit = ing.normalize(qty * multiplier, unit, compound=True)

    rows = conn.execute(
        "SELECT * FROM shopping_list WHERE item_key = ? AND checked = 0 ORDER BY id", (key,)
    ).fetchall()
    target = _find_target(rows, qty, unit)

    if target is None:
        conn.execute(
            """INSERT INTO shopping_list (item_key, name, unit, qty, aisle, sources)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (key, ing.clean_name(parsed.text), unit, str(qty) if qty is not None else None,
             ing.aisle_for(key, unit), json.dumps([source] if source else [])),
        )
        return "added"

    new_qty, new_unit = target["qty"], target["unit"]
    if qty is not None:
        if target["qty"] is None:
            new_qty, new_unit = qty, unit
        else:
            merged_qty, new_unit = _merge_amounts(Fraction(target["qty"]), target["unit"], qty, unit)
            new_qty = str(merged_qty)
    sources = json.loads(target["sources"] or "[]")
    if source and source not in sources and len(sources) < MAX_SOURCES:
        sources.append(source)
    conn.execute(
        "UPDATE shopping_list SET qty = ?, unit = ?, sources = ? WHERE id = ?",
        (str(new_qty) if new_qty is not None else None, new_unit, json.dumps(sources), target["id"]),
    )
    return "merged"


def add_lines(conn: sqlite3.Connection, lines: list[str], *, multiplier: int = 1,
              source: str | None = None, recipe_id: int | None = None) -> dict:
    stats = {"added": 0, "merged": 0}
    for line in lines:
        outcome = add_line(conn, line, multiplier=multiplier, source=source)
        if outcome:
            stats[outcome] += 1
            database.log_event(conn, "ingredient_added", {
                "line": line, "item_key": ing.merge_key(ing.parse_line(line).text),
                "recipe_id": recipe_id, "multiplier": multiplier, "merged": outcome == "merged",
            })
    return stats


def add_recipe(conn: sqlite3.Connection, recipe: dict, multiplier: int, *, via: str = "dashboard") -> dict:
    stats = add_lines(conn, recipe["lines"], multiplier=multiplier, source=recipe["title"],
                      recipe_id=recipe["id"])
    database.log_event(conn, "list_added", {
        "recipe_id": recipe["id"], "title": recipe["title"], "category": recipe["category"],
        "multiplier": multiplier, "via": via, **stats,
    })
    return stats


def set_checked(conn: sqlite3.Connection, item_id: int, checked: bool) -> dict | None:
    row = conn.execute("SELECT * FROM shopping_list WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        return None
    if bool(row["checked"]) != checked:
        conn.execute("UPDATE shopping_list SET checked = ? WHERE id = ?", (int(checked), item_id))
        database.log_event(conn, "item_checked", {
            "item_id": item_id, "item_key": row["item_key"], "name": row["name"], "checked": checked,
        })
    return {"id": item_id, "checked": checked}


def clear(conn: sqlite3.Connection, *, only_checked: bool = False) -> int:
    if only_checked:
        removed = conn.execute("DELETE FROM shopping_list WHERE checked = 1").rowcount
    else:
        removed = conn.execute("DELETE FROM shopping_list").rowcount
    database.log_event(conn, "list_cleared", {"scope": "checked" if only_checked else "all", "removed": removed})
    return removed


def _view(row: sqlite3.Row) -> dict:
    qty = Fraction(row["qty"]) if row["qty"] is not None else None
    amount = ing.format_amount(qty, row["unit"])
    name = ing.display_name(row["name"], qty, row["unit"])
    return {
        "id": row["id"],
        "label": f"{amount} {name}".strip(),
        "amount": amount,
        "name": name,
        "aisle": row["aisle"],
        "checked": bool(row["checked"]),
        "sources": json.loads(row["sources"] or "[]"),
    }


def grouped_items(conn: sqlite3.Connection) -> list[dict]:
    """Items grouped by aisle in store order; unchecked items first within each aisle."""
    rows = conn.execute("SELECT * FROM shopping_list ORDER BY checked, name, id").fetchall()
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row["aisle"], []).append(_view(row))
    return [
        {"aisle": aisle, "items": groups[aisle]}
        for aisle in sorted(groups, key=ing.aisle_order)
    ]


def counts(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT COUNT(*) AS total, COALESCE(SUM(checked), 0) AS checked FROM shopping_list"
    ).fetchone()
    return {"total": row["total"], "checked": row["checked"], "open": row["total"] - row["checked"]}

"""Shopping list: add lines with smart merging, check items, clear, and group by aisle.

Every function works on one user's list: rows are always filtered by ``user_id``.
"""
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


def _record_contribution(conn: sqlite3.Connection, user_id: int, item_id: int, recipe_id: int | None,
                         qty: Fraction | None, unit: str | None) -> None:
    conn.execute(
        "INSERT INTO list_contributions (user_id, item_id, recipe_id, qty, unit) VALUES (?, ?, ?, ?, ?)",
        (user_id, item_id, recipe_id, str(qty) if qty is not None else None, unit),
    )


def add_line(conn: sqlite3.Connection, user_id: int, line: str, *, multiplier: int = 1,
             source: str | None = None, recipe_id: int | None = None) -> str | None:
    """Add one ingredient line. Returns 'added', 'merged', or None if the line was empty.

    What the line added is recorded in list_contributions (recipe_id None for hand-typed lines),
    so deleting a recipe later can take back exactly its share.
    """
    parsed = ing.parse_line(line)
    key = ing.merge_key(parsed.text)
    if not key:
        return None
    qty, unit = parsed.shopping_qty, parsed.unit
    if qty is not None:
        qty, unit = ing.normalize(qty * multiplier, unit, compound=True)

    rows = conn.execute(
        "SELECT * FROM shopping_list WHERE user_id = ? AND item_key = ? AND checked = 0 ORDER BY id", (user_id, key)
    ).fetchall()
    target = _find_target(rows, qty, unit)

    if target is None:
        cursor = conn.execute(
            """INSERT INTO shopping_list (user_id, item_key, name, unit, qty, aisle, sources, tracked)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
            (user_id, key, ing.clean_name(parsed.text), unit, str(qty) if qty is not None else None,
             ing.aisle_for(key, unit), json.dumps([source] if source else [])),
        )
        _record_contribution(conn, user_id, cursor.lastrowid, recipe_id, qty, unit)
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
        "UPDATE shopping_list SET qty = ?, unit = ?, sources = ? WHERE id = ? AND user_id = ?",
        (str(new_qty) if new_qty is not None else None, new_unit, json.dumps(sources), target["id"], user_id),
    )
    _record_contribution(conn, user_id, target["id"], recipe_id, qty, unit)
    return "merged"


def add_lines(conn: sqlite3.Connection, user_id: int, lines: list[str], *, multiplier: int = 1,
              source: str | None = None, recipe_id: int | None = None) -> dict:
    stats = {"added": 0, "merged": 0}
    for line in lines:
        outcome = add_line(conn, user_id, line, multiplier=multiplier, source=source, recipe_id=recipe_id)
        if outcome:
            stats[outcome] += 1
            database.log_event(conn, user_id, "ingredient_added", {
                "line": line, "item_key": ing.merge_key(ing.parse_line(line).text),
                "recipe_id": recipe_id, "multiplier": multiplier, "merged": outcome == "merged",
            })
    return stats


def add_recipe(conn: sqlite3.Connection, user_id: int, recipe: dict, multiplier: int, *,
               via: str = "dashboard") -> dict:
    """Add a recipe the caller already loaded for this user (see database.get_recipe)."""
    stats = add_lines(conn, user_id, recipe["lines"], multiplier=multiplier, source=recipe["title"],
                      recipe_id=recipe["id"])
    database.log_event(conn, user_id, "list_added", {
        "recipe_id": recipe["id"], "title": recipe["title"], "category": recipe["category"],
        "multiplier": multiplier, "via": via, **stats,
    })
    return stats


def _own_row(conn: sqlite3.Connection, user_id: int, item_id: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM shopping_list WHERE id = ? AND user_id = ?", (item_id, user_id)
    ).fetchone()


def set_checked(conn: sqlite3.Connection, user_id: int, item_id: int, checked: bool) -> dict | None:
    row = _own_row(conn, user_id, item_id)
    if row is None:
        return None
    if bool(row["checked"]) != checked:
        conn.execute("UPDATE shopping_list SET checked = ? WHERE id = ? AND user_id = ?",
                     (int(checked), item_id, user_id))
        database.log_event(conn, user_id, "item_checked", {
            "item_id": item_id, "item_key": row["item_key"], "name": row["name"], "checked": checked,
        })
    return {"id": item_id, "checked": checked}


def _share_in_unit(contributions, unit: str | None) -> Fraction:
    """The total of some contributions expressed in ``unit``; ones that can't convert count as 0."""
    total = Fraction(0)
    for c in contributions:
        if c["qty"] is not None and ing.units_compatible(c["unit"], unit):
            total += ing.convert(Fraction(c["qty"]), c["unit"], unit) if unit else Fraction(c["qty"])
    return total


def remove_recipe_items(conn: sqlite3.Connection, user_id: int, recipe: dict, *, apply: bool = True) -> dict:
    """Take a recipe's ingredients back off the user's list (ticked or not). Returns counts.

    For each row the recipe contributed to:
      * nothing else contributed -> the row is deleted ("removed");
      * other recipes or hand-typed lines contributed too -> only this recipe's quantity is
        subtracted (converted into the row's unit) and its title leaves the sources ("reduced").

    Rows added before contributions were tracked (tracked = 0) are matched by the recipe's
    title in their sources: if it is the only source the row is deleted; otherwise the title is
    removed and the amount kept, because that old share can't be known.

    With ``apply=False`` nothing is written: the counts preview what deleting would do.
    The caller owns the transaction. Every query is scoped to ``user_id``.
    """
    recipe_id, title = recipe["id"], recipe["title"]
    rows = conn.execute(
        """SELECT * FROM shopping_list WHERE user_id = ? AND (
               id IN (SELECT item_id FROM list_contributions WHERE user_id = ? AND recipe_id = ?)
               OR (tracked = 0 AND EXISTS (SELECT 1 FROM json_each(sources) WHERE value = ?)))
           ORDER BY id""",
        (user_id, user_id, recipe_id, title),
    ).fetchall()
    removed = reduced = 0
    for row in rows:
        contributions = conn.execute(
            """SELECT list_contributions.*, recipes.title AS recipe_title FROM list_contributions
               LEFT JOIN recipes ON recipes.id = list_contributions.recipe_id AND recipes.user_id = ?
               WHERE list_contributions.user_id = ? AND list_contributions.item_id = ?""",
            (user_id, user_id, row["id"]),
        ).fetchall()
        mine = [c for c in contributions if c["recipe_id"] == recipe_id]
        others = [c for c in contributions if c["recipe_id"] != recipe_id]
        sources = json.loads(row["sources"] or "[]")
        other_titles = [s for s in sources if s != title]
        shared = bool(others) or (not row["tracked"] and bool(other_titles))
        if not shared:
            removed += 1
            if apply:
                conn.execute("DELETE FROM shopping_list WHERE id = ? AND user_id = ?", (row["id"], user_id))
            continue

        reduced += 1
        if not apply:
            continue
        qty, unit = row["qty"], row["unit"]
        share = _share_in_unit(mine, unit) if qty is not None else Fraction(0)
        if share:
            rest = Fraction(qty) - share
            if rest > 0:
                rest, unit = ing.normalize(rest, unit, compound=True)
                qty = str(rest)
            elif row["tracked"] and not any(c["qty"] is not None for c in others):
                qty = unit = None  # only unquantified lines ("salt to taste") are left
            # Otherwise the amount was edited below this recipe's share: keep what the user typed.
        # Keep the title if another recipe with the same title still contributes to this row.
        if not any(c["recipe_title"] == title for c in others):
            sources = other_titles
        conn.execute(
            "UPDATE shopping_list SET qty = ?, unit = ?, aisle = ?, sources = ? WHERE id = ? AND user_id = ?",
            (qty, unit, ing.aisle_for(row["item_key"], unit), json.dumps(sources), row["id"], user_id),
        )
        conn.execute("DELETE FROM list_contributions WHERE user_id = ? AND item_id = ? AND recipe_id = ?",
                     (user_id, row["id"], recipe_id))
    return {"removed": removed, "reduced": reduced}


class AmountError(ValueError):
    """The text typed as a new amount isn't one ("lots", "0", "2 cups sugar" on the flour line)."""


def set_amount(conn: sqlite3.Connection, user_id: int, item_id: int, amount: str) -> dict | None:
    """Replace an item's amount with what the user typed: "1", "2 cups", "1 apple" or "" for none.

    Returns the updated item, or None if it no longer exists. Raises AmountError for bad input.
    """
    row = _own_row(conn, user_id, item_id)
    if row is None:
        return None
    text = ing.normalize_line(amount)
    qty = unit = None
    if text:
        parsed = ing.parse_line(text)
        # The item's own name may follow the amount ("1 apple"), but nothing else.
        if parsed.shopping_qty is None or (parsed.text and ing.merge_key(parsed.text) != row["item_key"]):
            raise AmountError(f"Type an amount like 1, 2 cups or 1/2 tsp for {row['name']}.")
        qty, unit = ing.normalize(parsed.shopping_qty, parsed.unit, compound=True)
    conn.execute(
        "UPDATE shopping_list SET qty = ?, unit = ?, aisle = ? WHERE id = ? AND user_id = ?",
        (str(qty) if qty is not None else None, unit, ing.aisle_for(row["item_key"], unit), item_id, user_id),
    )
    database.log_event(conn, user_id, "item_amount_changed", {
        "item_id": item_id, "item_key": row["item_key"], "qty": str(qty) if qty is not None else None, "unit": unit,
    })
    return _view(_own_row(conn, user_id, item_id))


def remove(conn: sqlite3.Connection, user_id: int, item_id: int) -> bool:
    row = _own_row(conn, user_id, item_id)
    if row is None:
        return False
    conn.execute("DELETE FROM shopping_list WHERE id = ? AND user_id = ?", (item_id, user_id))
    database.log_event(conn, user_id, "item_removed", {"item_id": item_id, "item_key": row["item_key"]})
    return True


def clear(conn: sqlite3.Connection, user_id: int, *, only_checked: bool = False) -> int:
    if only_checked:
        removed = conn.execute("DELETE FROM shopping_list WHERE user_id = ? AND checked = 1", (user_id,)).rowcount
    else:
        removed = conn.execute("DELETE FROM shopping_list WHERE user_id = ?", (user_id,)).rowcount
    database.log_event(conn, user_id, "list_cleared", {"scope": "checked" if only_checked else "all", "removed": removed})
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


def grouped_items(conn: sqlite3.Connection, user_id: int) -> list[dict]:
    """The user's items grouped by aisle in store order; unchecked items first within each aisle."""
    rows = conn.execute(
        "SELECT * FROM shopping_list WHERE user_id = ? ORDER BY checked, name, id", (user_id,)
    ).fetchall()
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row["aisle"], []).append(_view(row))
    return [
        {"aisle": aisle, "items": groups[aisle]}
        for aisle in sorted(groups, key=ing.aisle_order)
    ]


def counts(conn: sqlite3.Connection, user_id: int) -> dict:
    row = conn.execute(
        "SELECT COUNT(*) AS total, COALESCE(SUM(checked), 0) AS checked FROM shopping_list WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return {"total": row["total"], "checked": row["checked"], "open": row["total"] - row["checked"]}

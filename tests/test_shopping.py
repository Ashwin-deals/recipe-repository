import json

import database
import shopping


def labels(db):
    return [item["label"] for group in shopping.grouped_items(db) for item in group["items"]]


def rows(db):
    return db.execute("SELECT * FROM shopping_list ORDER BY id").fetchall()


def test_adds_one_row_per_line(db):
    stats = shopping.add_lines(db, ["2 cups flour", "1 cup milk", "salt to taste"])
    assert stats == {"added": 3, "merged": 0}
    assert sorted(labels(db)) == ["1 cup milk", "2 cups flour", "salt"]


def test_quantities_are_stored_as_exact_fractions(db):
    shopping.add_line(db, "1 1/3 cups sugar")
    row = rows(db)[0]
    assert (row["qty"], row["unit"], row["item_key"]) == ("4/3", "cup", "sugar")


def test_same_unit_merges_and_sums(db):
    shopping.add_line(db, "1 cup flour", source="A")
    assert shopping.add_line(db, "2 cups flour, sifted", source="B") == "merged"
    assert labels(db) == ["3 cups flour"]
    assert json.loads(rows(db)[0]["sources"]) == ["A", "B"]


def test_convertible_units_merge(db):
    shopping.add_line(db, "1 cup butter")
    shopping.add_line(db, "2 tbsp butter")
    assert labels(db) == ["1 1/8 cups butter"]
    shopping.add_line(db, "500 g sugar")
    shopping.add_line(db, "1 kg sugar")
    assert "1 1/2 kg sugar" in labels(db)
    shopping.add_line(db, "250 ml milk")
    shopping.add_line(db, "1 l milk")
    assert "1 1/4 L milk" in labels(db)
    shopping.add_line(db, "1 kg rice")
    shopping.add_line(db, "300 g rice")
    assert "1 kg + 300 g rice" in labels(db)


def test_awkward_merged_amounts_read_as_compound(db):
    shopping.add_line(db, "1 tbsp flour")
    shopping.add_line(db, "2 cups flour")
    assert labels(db) == ["2 cups + 1 tbsp flour"]


def test_incompatible_units_stay_separate(db):
    shopping.add_line(db, "1 cup tomatoes")
    shopping.add_line(db, "1 can tomatoes")
    shopping.add_line(db, "200 g tomatoes")
    assert len(rows(db)) == 3


def test_counts_merge_and_pluralize(db):
    shopping.add_line(db, "1 onion, diced")
    shopping.add_line(db, "2 onions, chopped")
    shopping.add_line(db, "1 small onion")
    assert labels(db) == ["4 onions"]


def test_eggs_merge_across_descriptions(db):
    shopping.add_lines(db, ["2 eggs", "3 large eggs", "1 egg, beaten"])
    assert labels(db) == ["6 eggs"]


def test_garlic_cloves_merge_in_either_word_order(db):
    shopping.add_lines(db, ["4 cloves garlic, minced", "3 garlic cloves"])
    assert labels(db) == ["7 cloves garlic"]


def test_unquantified_line_is_absorbed_by_existing_item(db):
    shopping.add_line(db, "1 tsp salt")
    assert shopping.add_line(db, "salt to taste") == "merged"
    assert labels(db) == ["1 tsp salt"]


def test_quantified_line_fills_in_unquantified_item(db):
    shopping.add_line(db, "salt to taste")
    shopping.add_line(db, "1 tsp salt")
    assert labels(db) == ["1 tsp salt"]


def test_ranges_shop_for_the_upper_bound(db):
    shopping.add_line(db, "1-2 tbsp oil")
    assert labels(db) == ["2 tbsp oil"]


def test_multiplier_scales_before_merging(db):
    shopping.add_line(db, "1 cup milk", multiplier=3)
    shopping.add_line(db, "1/2 cup milk", multiplier=2)
    assert labels(db) == ["4 cups milk"]


def test_unscalable_lines_are_added_unscaled(db):
    shopping.add_line(db, "2-inch piece ginger", multiplier=4)
    assert labels(db) == ["2-inch piece ginger"]


def test_never_merges_into_checked_items(db):
    shopping.add_line(db, "2 eggs")
    first = rows(db)[0]["id"]
    shopping.set_checked(db, first, True)
    assert shopping.add_line(db, "3 eggs") == "added"
    assert len(rows(db)) == 2
    assert rows(db)[0]["qty"] == "2"


def test_empty_lines_are_ignored(db):
    assert shopping.add_line(db, "   ") is None
    assert shopping.add_lines(db, ["", "2"]) == {"added": 0, "merged": 0}


def test_add_recipe_logs_events(db):
    recipe = {"id": 7, "title": "Toast", "category": "Breakfast", "lines": ["2 slices bread", "1 tbsp butter"]}
    stats = shopping.add_recipe(db, recipe, 2)
    assert stats == {"added": 2, "merged": 0}
    types = [r["type"] for r in db.execute("SELECT type FROM events ORDER BY id")]
    assert types == ["ingredient_added", "ingredient_added", "list_added"]
    payload = json.loads(db.execute("SELECT payload FROM events WHERE type = 'list_added'").fetchone()[0])
    assert payload["title"] == "Toast" and payload["multiplier"] == 2
    assert labels(db) == ["2 tbsp butter", "4 slices bread"]


def test_set_checked_toggles_and_only_logs_changes(db):
    shopping.add_line(db, "2 eggs")
    item_id = rows(db)[0]["id"]
    assert shopping.set_checked(db, item_id, True) == {"id": item_id, "checked": True}
    shopping.set_checked(db, item_id, True)  # repeat (e.g. offline resync) is a no-op
    assert rows(db)[0]["checked"] == 1
    shopping.set_checked(db, item_id, False)
    assert rows(db)[0]["checked"] == 0
    assert db.execute("SELECT COUNT(*) FROM events WHERE type = 'item_checked'").fetchone()[0] == 2
    assert shopping.set_checked(db, 9999, True) is None


def test_clear_all_and_clear_checked(db):
    shopping.add_lines(db, ["2 eggs", "1 cup milk", "1 lemon"])
    shopping.set_checked(db, rows(db)[0]["id"], True)
    assert shopping.clear(db, only_checked=True) == 1
    assert len(rows(db)) == 2
    assert shopping.clear(db) == 2
    assert rows(db) == []
    assert shopping.counts(db) == {"total": 0, "checked": 0, "open": 0}


def test_grouped_items_follow_aisle_order_with_checked_last(db):
    shopping.add_lines(db, ["1 tsp salt", "2 eggs", "1 onion", "1 cup milk", "1 lemon"])
    lemon = next(r["id"] for r in rows(db) if r["item_key"] == "lemon")
    shopping.set_checked(db, lemon, True)
    groups = shopping.grouped_items(db)
    assert [g["aisle"] for g in groups] == ["Produce", "Dairy & Eggs", "Spices"]
    produce = [item["label"] for item in groups[0]["items"]]
    assert produce == ["1 onion", "1 lemon"]
    assert groups[0]["items"][1]["checked"] is True


def test_seed_recipes_demonstrate_merging(tmp_path):
    path = str(tmp_path / "seed.db")
    database.init_db(path, seed=True)
    conn = database.connect(path)
    try:
        for recipe in database.list_recipes(conn):
            shopping.add_recipe(conn, recipe, 1)
        found = labels(conn)
        for expected in ("7 eggs", "4 onions", "7 cloves garlic", "2 5/8 cups milk", "1 7/8 cups butter"):
            assert expected in found
        assert any(label.endswith("flour") for label in found)
    finally:
        conn.close()

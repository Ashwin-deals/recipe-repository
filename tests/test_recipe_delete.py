"""Deleting a recipe also takes its ingredients back off the shopping list, in one transaction."""
import json

import pytest

import database
import shopping
from conftest import user_id

PANCAKES = {"title": "Pancakes", "prep_time": 20, "category": "Breakfast",
            "ingredients": "2 eggs\n1 cup milk\n1 tbsp sugar"}
OMELETTE = {"title": "Omelette", "prep_time": 10, "category": "Breakfast",
            "ingredients": "3 eggs\n2 tbsp milk\nsalt to taste"}


def items(client):
    return {i["name"]: i for g in client.get("/api/list").json["groups"] for i in g["items"]}


def labels(client):
    return sorted(i["label"] for i in items(client).values())


def save(client, body):
    return client.post("/api/recipes", json=body).json["recipe"]["id"]


def add(client, recipe_id, multiplier=1):
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": multiplier}).status_code == 200


def test_items_only_from_this_recipe_are_removed(client):
    pancakes = save(client, PANCAKES)
    add(client, pancakes)
    client.post("/api/list/items", json={"line": "1 lemon"})  # unrelated, typed by hand
    assert client.get(f"/api/recipes/{pancakes}/list-impact").json == {"removed": 3, "reduced": 0}

    response = client.delete(f"/api/recipes/{pancakes}")
    assert response.status_code == 200
    assert (response.json["list_removed"], response.json["list_reduced"]) == (3, 0)
    assert response.json["counts"]["total"] == 1
    assert labels(client) == ["1 lemon"]
    assert client.get(f"/api/recipes/{pancakes}").status_code == 404


def test_merged_items_keep_the_other_recipes_share(client):
    pancakes, omelette = save(client, PANCAKES), save(client, OMELETTE)
    add(client, pancakes, 2)  # 4 eggs, 2 cups milk, 2 tbsp sugar
    add(client, omelette)  # + 3 eggs, + 2 tbsp milk, salt
    assert labels(client) == ["2 1/8 cups milk", "2 tbsp sugar", "7 eggs", "salt"]
    assert client.get(f"/api/recipes/{pancakes}/list-impact").json == {"removed": 1, "reduced": 2}

    response = client.delete(f"/api/recipes/{pancakes}")
    assert (response.json["list_removed"], response.json["list_reduced"]) == (1, 2)
    assert labels(client) == ["2 tbsp milk", "3 eggs", "salt"]
    found = items(client)
    assert found["eggs"]["sources"] == ["Omelette"] and found["milk"]["sources"] == ["Omelette"]

    # Deleting the other recipe now empties the list completely.
    client.delete(f"/api/recipes/{omelette}")
    assert labels(client) == []


def test_hand_typed_share_is_kept(client):
    pancakes = save(client, PANCAKES)
    add(client, pancakes)
    client.post("/api/list/items", json={"line": "6 eggs"})
    client.delete(f"/api/recipes/{pancakes}")
    found = items(client)
    assert list(found) == ["eggs"] and found["eggs"]["label"] == "6 eggs"
    assert found["eggs"]["sources"] == ["Added by hand"]


def test_ticked_items_are_removed_too(client, db, uid):
    pancakes = save(client, PANCAKES)
    add(client, pancakes)
    for item in items(client).values():
        client.post(f"/api/list/{item['id']}/check", json={"checked": True})
    response = client.delete(f"/api/recipes/{pancakes}")
    assert response.json["list_removed"] == 3 and labels(client) == []
    assert db.execute("SELECT COUNT(*) FROM list_contributions WHERE user_id = ?", (uid,)).fetchone()[0] == 0


def test_a_ticked_row_and_a_new_row_for_the_same_item_are_both_handled(client):
    pancakes, omelette = save(client, PANCAKES), save(client, OMELETTE)
    add(client, pancakes)
    eggs = items(client)["eggs"]["id"]
    client.post(f"/api/list/{eggs}/check", json={"checked": True})  # ticked rows are never merged into
    add(client, omelette)  # so 3 eggs become a second row
    client.delete(f"/api/recipes/{pancakes}")
    remaining = [i for g in client.get("/api/list").json["groups"] for i in g["items"] if i["name"] == "eggs"]
    assert [(i["label"], i["checked"]) for i in remaining] == [("3 eggs", False)]


def test_an_amount_edited_below_the_share_is_kept(client):
    pancakes, omelette = save(client, PANCAKES), save(client, OMELETTE)
    add(client, pancakes)
    add(client, omelette)  # 5 eggs
    eggs = items(client)["eggs"]["id"]
    client.post(f"/api/list/{eggs}/amount", json={"amount": "1"})  # shopper only wants 1
    client.delete(f"/api/recipes/{pancakes}")
    found = items(client)["egg"]  # one egg: the name is singular now
    assert found["label"] == "1 egg" and found["sources"] == ["Omelette"]


def test_planner_entries_for_the_recipe_are_removed(client):
    pancakes, omelette = save(client, PANCAKES), save(client, OMELETTE)
    client.post("/api/planner", json={"day": "Monday", "recipe_id": pancakes})
    client.post("/api/planner", json={"day": "Tuesday", "recipe_id": omelette})
    client.delete(f"/api/recipes/{pancakes}")
    plan = client.get("/api/planner").json["plan"]
    assert plan["Monday"] == [] and plan["Tuesday"][0]["title"] == "Omelette"


def test_another_users_recipe_and_list_are_untouched(app):
    alice, bob = app.test_client(email="alice@example.com"), app.test_client(email="bob@example.com")
    alice_recipe = save(alice, PANCAKES)
    add(alice, alice_recipe)
    bob_recipe = save(bob, PANCAKES)  # same title and ingredients
    add(bob, bob_recipe)
    assert bob.delete(f"/api/recipes/{alice_recipe}").status_code == 404
    assert bob.get(f"/api/recipes/{alice_recipe}/list-impact").status_code == 404
    assert len(items(alice)) == 3 and alice.get(f"/api/recipes/{alice_recipe}").status_code == 200

    bob.delete(f"/api/recipes/{bob_recipe}")
    assert labels(bob) == [] and len(items(alice)) == 3  # Bob's delete never reaches Alice's list


def test_failure_rolls_everything_back(client, monkeypatch):
    pancakes = save(client, PANCAKES)
    add(client, pancakes)
    before = labels(client)

    def boom(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(database, "delete_recipe", boom)  # fails after the list was already cleaned up
    assert client.delete(f"/api/recipes/{pancakes}").status_code == 500
    monkeypatch.undo()
    assert labels(client) == before
    assert client.get(f"/api/recipes/{pancakes}").status_code == 200
    assert client.get(f"/api/recipes/{pancakes}/list-impact").json == {"removed": 3, "reduced": 0}


def test_one_event_with_counts_and_no_text(client, db):
    pancakes, omelette = save(client, PANCAKES), save(client, OMELETTE)
    add(client, pancakes)
    add(client, omelette)
    client.delete(f"/api/recipes/{pancakes}")
    rows = db.execute("SELECT payload FROM events WHERE type = 'recipe_deleted'").fetchall()
    assert len(rows) == 1
    assert json.loads(rows[0][0]) == {"recipe_id": pancakes, "list_removed": 1, "list_reduced": 2}


# ---------- items added before contributions were tracked: match by title ----------

def legacy_row(db, uid, name, key, qty, unit, sources, checked=0):
    db.execute(
        """INSERT INTO shopping_list (user_id, item_key, name, unit, qty, aisle, checked, sources, tracked)
           VALUES (?, ?, ?, ?, ?, 'Other', ?, ?, 0)""",
        (uid, key, name, unit, qty, checked, json.dumps(sources)),
    )
    db.commit()


def test_old_items_fall_back_to_the_source_title(client, db, uid):
    pancakes = save(client, PANCAKES)
    legacy_row(db, uid, "flour", "flour", "2", "cup", ["Pancakes"])  # only this recipe: removed
    legacy_row(db, uid, "butter", "butter", "3", "tbsp", ["Pancakes"], checked=1)  # ticked: removed
    legacy_row(db, uid, "egg", "egg", "5", None, ["Pancakes", "Omelette"])  # shared: title dropped, amount kept
    legacy_row(db, uid, "rice", "rice", "1", "cup", ["Risotto"])  # not this recipe: untouched
    assert client.get(f"/api/recipes/{pancakes}/list-impact").json == {"removed": 2, "reduced": 1}

    response = client.delete(f"/api/recipes/{pancakes}")
    assert (response.json["list_removed"], response.json["list_reduced"]) == (2, 1)
    found = items(client)
    assert sorted(found) == ["eggs", "rice"]
    assert found["eggs"]["label"] == "5 eggs" and found["eggs"]["sources"] == ["Omelette"]
    assert found["rice"]["sources"] == ["Risotto"]


def test_old_item_that_later_got_a_tracked_merge(client, db, uid):
    omelette = save(client, OMELETTE)
    legacy_row(db, uid, "egg", "egg", "2", None, ["Pancakes"])  # from a recipe added before tracking
    add(client, omelette)  # + 3 eggs, tracked
    assert items(client)["eggs"]["label"] == "5 eggs"
    client.delete(f"/api/recipes/{omelette}")
    found = items(client)["eggs"]
    assert found["label"] == "2 eggs" and found["sources"] == ["Pancakes"]


def test_existing_database_gets_the_new_column_and_table(tmp_path):
    path = str(tmp_path / "before.db")
    conn = database.connect(path)
    conn.executescript(database.SCHEMA.replace(
        "    tracked    INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0, 1)),\n", ""))
    conn.execute("DROP TABLE list_contributions")
    conn.execute("INSERT INTO users (email, password_hash, display_name) VALUES ('a@example.com', '!', 'A')")
    conn.execute("INSERT INTO shopping_list (user_id, item_key, name, sources) VALUES (1, 'egg', 'egg', '[\"X\"]')")
    conn.commit()
    conn.close()

    database.init_db(path)
    database.init_db(path)  # a second start is a no-op
    conn = database.connect(path)
    assert conn.execute("SELECT tracked FROM shopping_list").fetchone()[0] == 0  # old rows: title fallback
    assert database.add_missing_columns(conn) == []
    shopping.add_line(conn, 1, "2 eggs", recipe_id=None)
    assert conn.execute("SELECT COUNT(*) FROM list_contributions").fetchone()[0] == 1
    conn.close()


@pytest.mark.parametrize("line", ["salt to taste", "1 tsp salt"])
def test_unquantified_leftovers(client, line):
    pancakes = save(client, {**PANCAKES, "ingredients": "1 tsp salt"})
    omelette = save(client, {**OMELETTE, "ingredients": "salt to taste"})
    add(client, pancakes)
    add(client, omelette)
    client.delete(f"/api/recipes/{pancakes}")
    assert labels(client) == ["salt"]  # the measured share went with Pancakes


def test_uid_fixture_matches(client, db, uid):
    assert user_id(db) == uid

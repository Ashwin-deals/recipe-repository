"""Two users, A and B: B must never see, change or use anything of A's, by any route."""
import json

import pytest

import database
from conftest import API_KEY_CONFIG, user_id

RECIPE = {"title": "Alice's Secret Curry", "prep_time": 30, "category": "Dinner",
          "ingredients": "2 onions\n1 cup secret paste"}


@pytest.fixture
def ai_app(make_app):
    return make_app(**API_KEY_CONFIG, SEED_DEMO_DATA=False)


@pytest.fixture
def alice(ai_app):
    return ai_app.test_client(email="alice@example.com")


@pytest.fixture
def bob(ai_app):
    return ai_app.test_client(email="bob@example.com")


@pytest.fixture
def alices(alice):
    """Alice's recipe, list item and plan entry ids."""
    recipe = alice.post("/api/recipes", json=RECIPE).json["recipe"]
    alice.post(f"/api/recipes/{recipe['id']}/add-to-list", json={"multiplier": 1})
    entry = alice.post("/api/planner", json={"day": "Monday", "recipe_id": recipe["id"]}).json["entry_id"]
    item = alice.get("/api/list").json["groups"][0]["items"][0]
    return {"recipe": recipe["id"], "item": item["id"], "entry": entry}


def test_b_cannot_reach_a_recipe_by_id(alice, bob, alices):
    rid = alices["recipe"]
    attempts = [
        bob.get(f"/api/recipes/{rid}"),
        bob.put(f"/api/recipes/{rid}", json={**RECIPE, "title": "Hacked"}),
        bob.delete(f"/api/recipes/{rid}"),
        bob.get(f"/api/recipes/{rid}/scaled?x=2"),
        bob.get(f"/api/recipes/{rid}/list-impact"),
        bob.post(f"/api/recipes/{rid}/add-to-list", json={"multiplier": 1}),
        bob.post(f"/api/recipes/{rid}/nutrition"),
        bob.post("/api/planner", json={"day": "Tuesday", "recipe_id": rid}),
        bob.post("/api/chat", json={"message": "What's in it?", "recipe_id": rid}),
        bob.post("/api/substitute", json={"ingredient": "onion", "recipe_id": rid}),
    ]
    assert [r.status_code for r in attempts] == [404] * len(attempts)
    # Same answer as an id that doesn't exist at all, so existence isn't revealed.
    assert attempts[0].json == bob.get("/api/recipes/99999").json
    assert all("Secret" not in r.get_data(as_text=True) for r in attempts)
    # Alice's recipe is untouched.
    assert alice.get(f"/api/recipes/{rid}").json["recipe"]["title"] == RECIPE["title"]


def test_b_cannot_touch_a_list_item_or_plan_entry(alice, bob, alices):
    item, entry = alices["item"], alices["entry"]
    attempts = [
        bob.post(f"/api/list/{item}/check", json={"checked": True}),
        bob.post(f"/api/list/{item}/amount", json={"amount": "99"}),
        bob.delete(f"/api/list/{item}"),
        bob.delete(f"/api/planner/{entry}"),
    ]
    assert [r.status_code for r in attempts] == [404] * 4
    groups = alice.get("/api/list").json["groups"]
    items = [i for g in groups for i in g["items"]]
    assert len(items) == 2 and not any(i["checked"] for i in items)
    assert alice.get("/api/planner").json["plan"]["Monday"][0]["id"] == entry


def test_collections_only_show_your_own_data(alice, bob, alices):
    bob.post("/api/list/items", json={"line": "3 bananas"})
    bob.post("/api/list/clear", json={"scope": "all"})  # clears only Bob's list
    bob.post("/api/planner/clear")  # clears only Bob's plan
    assert bob.post("/api/planner/build").status_code == 400  # Bob has nothing planned

    assert bob.get("/api/recipes").json["recipes"] == []
    assert bob.get("/api/recipes?category=Dinner").json["recipes"] == []
    assert bob.get("/api/list").json == {"groups": [], "counts": {"total": 0, "checked": 0, "open": 0}}
    assert all(not meals for meals in bob.get("/api/planner").json["plan"].values())
    insights = bob.get("/api/insights").json
    assert insights["top_recipes"] == [] and insights["counts"]["recipes"] == 0
    assert insights["counts"]["lists_built"] == 0

    assert len(alice.get("/api/recipes").json["recipes"]) == 1
    assert alice.get("/api/list").json["counts"]["total"] == 2
    assert alice.post("/api/planner/build").json["meals"] == 1
    assert alice.get("/api/insights").json["top_recipes"][0]["label"] == RECIPE["title"]


def test_same_item_names_never_merge_across_users(alice, bob):
    alice.post("/api/list/items", json={"line": "2 lemons"})
    bob.post("/api/list/items", json={"line": "1 lemon"})
    assert alice.get("/api/list").json["groups"][0]["items"][0]["label"] == "2 lemons"
    assert bob.get("/api/list").json["groups"][0]["items"][0]["label"] == "1 lemon"


def test_chat_and_ai_only_use_the_callers_recipe(ai_app, alice, bob, alices, monkeypatch):
    import gcp
    prompts = []
    monkeypatch.setattr(gcp, "generate_text", lambda config, prompt, **kw: prompts.append(prompt) or '{"reply": "ok"}')
    own = bob.post("/api/recipes", json={**RECIPE, "title": "Bob's Toast", "ingredients": "1 slice bread"})
    bob_recipe = own.json["recipe"]["id"]
    assert bob.post("/api/chat", json={"message": "Hi", "recipe_id": bob_recipe}).status_code == 200
    assert all("Secret" not in p for p in prompts) and "Bob's Toast" in prompts[-1]


def test_events_and_ai_usage_are_per_user(ai_app, alice, bob, alices):
    conn = database.connect(ai_app.config["DATABASE_PATH"])
    alice_id, bob_id = user_id(conn, "alice@example.com"), user_id(conn, "bob@example.com")
    owners = {row[0] for row in conn.execute("SELECT DISTINCT user_id FROM events")}
    assert owners == {alice_id}
    database.consume_ai_call(conn, alice_id, 100, 100)
    assert database.ai_calls_today(conn, bob_id) == 0
    conn.close()
    assert bob.get("/api/insights").json["ai_calls"] == 0


def test_bigquery_rows_carry_a_salted_user_hash_never_the_email(make_app, monkeypatch):
    import gcp
    mirrored = []
    monkeypatch.setattr(gcp, "mirror_events", lambda config, events: mirrored.extend(events))
    app = make_app()
    alice = app.test_client(email="alice@example.com")
    bob = app.test_client(email="bob@example.com")
    alice.post("/api/list/items", json={"line": "2 lemons"})
    bob.post("/api/list/items", json={"line": "2 lemons"})
    hashes = [json.loads(row["payload"])["user_hash"] for row in mirrored]
    assert len(hashes) == 2 and hashes[0] != hashes[1] and all(len(h) == 32 for h in hashes)
    text = json.dumps(mirrored)
    assert "alice@" not in text and "bob@" not in text and "user_id" not in text


def test_guessed_ids_get_404_not_403(alice, bob, alices):
    for rid in range(1, 20):
        response = bob.get(f"/api/recipes/{rid}")
        assert response.status_code == 404


def test_signed_out_requests_get_nothing(ai_app, alices):
    anon = ai_app.test_client(email=None)
    for method, path in [("get", "/api/recipes"), ("get", f"/api/recipes/{alices['recipe']}"), ("get", "/api/list"),
                         ("get", "/api/planner"), ("get", "/api/insights"), ("post", "/api/chat"),
                         ("post", "/api/import"), ("post", "/api/substitute"), ("post", "/api/list/clear")]:
        response = getattr(anon, method)(path, json={})
        assert response.status_code == 401, path
        assert "Secret" not in response.get_data(as_text=True)


# Every /api route must appear here (and in the tests above). A new route fails this test until
# its isolation is considered.
COVERED_ROUTES = {
    "/api/csrf", "/api/config", "/api/auth/me", "/api/auth/signup", "/api/auth/login", "/api/auth/logout",
    "/api/auth/account", "/api/auth/demo",
    "/api/recipes", "/api/recipes/<int:recipe_id>", "/api/recipes/<int:recipe_id>/scaled",
    "/api/recipes/<int:recipe_id>/list-impact",
    "/api/recipes/<int:recipe_id>/add-to-list", "/api/recipes/<int:recipe_id>/nutrition",
    "/api/list", "/api/list/items", "/api/list/<int:item_id>/check", "/api/list/<int:item_id>/amount",
    "/api/list/<int:item_id>", "/api/list/clear",
    "/api/planner", "/api/planner/<int:entry_id>", "/api/planner/clear", "/api/planner/build",
    "/api/insights", "/api/import", "/api/substitute", "/api/chat",
}


def test_every_api_route_is_covered(app):
    routes = {rule.rule for rule in app.url_map.iter_rules() if rule.rule.startswith("/api/")}
    assert routes == COVERED_ROUTES


# ---------- migrating a database from before accounts ----------

OLD_SCHEMA = """
CREATE TABLE recipes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, prep_time INTEGER NOT NULL,
    category TEXT NOT NULL, ingredients TEXT NOT NULL, nutrition TEXT, diet_tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shopping_list (id INTEGER PRIMARY KEY AUTOINCREMENT, item_key TEXT NOT NULL, name TEXT NOT NULL,
    unit TEXT, qty TEXT, aisle TEXT NOT NULL DEFAULT 'Other', checked INTEGER NOT NULL DEFAULT 0,
    sources TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE meal_plan (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL,
    recipe_id INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE, multiplier INTEGER NOT NULL DEFAULT 1);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO recipes (title, prep_time, category, ingredients) VALUES ('Shared Old Pie', 10, 'Dessert', '1 apple');
INSERT INTO recipes (title, prep_time, category, ingredients) VALUES ('Shared Old Soup', 10, 'Dinner', '1 leek');
INSERT INTO shopping_list (item_key, name) VALUES ('apple', 'apple');
INSERT INTO meal_plan (day, recipe_id) VALUES ('Monday', 1);
INSERT INTO events (type) VALUES ('list_added');
INSERT INTO meta (key, value) VALUES ('seeded', '1'), ('secret_key', 'kept');
"""


def test_migration_removes_ownerless_rows_and_is_idempotent(make_app, tmp_path):
    path = tmp_path / "old.db"
    conn = database.connect(str(path))
    conn.executescript(OLD_SCHEMA)
    conn.close()

    app = make_app(DATABASE_PATH=str(path), SEED_DEMO_DATA=True)
    make_app(DATABASE_PATH=str(path), SEED_DEMO_DATA=True)  # a second start is a no-op
    client = app.test_client()
    recipes = client.get("/api/recipes").json["recipes"]
    assert len(recipes) == 6 and not any(r["title"].startswith("Shared Old") for r in recipes)
    assert min(r["id"] for r in recipes) > 2  # old ids are never reused
    assert client.get("/api/list").json["counts"]["total"] == 0
    assert client.get("/api/recipes/1").status_code == 404

    conn = database.connect(str(path))
    for table in ("recipes", "shopping_list", "meal_plan", "events"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id IS NULL").fetchone()[0] == 0
        notnull = {row["name"]: row["notnull"] for row in conn.execute(f"PRAGMA table_info({table})")}
        assert notnull["user_id"] == 1, table
    assert database.get_meta(conn, "secret_key") == "kept" and database.get_meta(conn, "seeded") is None
    assert database.drop_ownerless_tables(conn) == {}
    conn.close()


def test_rows_must_have_an_owner(db):
    with pytest.raises(Exception):
        db.execute("INSERT INTO recipes (title, prep_time, category, ingredients) VALUES ('x', 1, 'Lunch', 'y')")
    with pytest.raises(Exception):
        db.execute("INSERT INTO recipes (user_id, title, prep_time, category, ingredients) "
                   "VALUES (999, 'x', 1, 'Lunch', 'y')")  # no such user

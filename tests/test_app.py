import database
import shopping


def recipe_body(**overrides):
    body = {"title": "Lemon Rice", "prep_time": 25, "category": "Dinner",
            "ingredients": "1 cup rice\n1 lemon\nsalt to taste"}
    body.update(overrides)
    return body


def labels(db):
    return sorted(i["label"] for g in shopping.grouped_items(db) for i in g["items"])


# ---------- basics ----------

def test_healthz(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json == {"status": "ok"}


def test_security_headers(client):
    headers = client.get("/api/list").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    assert headers["Cache-Control"] == "no-store"


def test_config(client):
    data = client.get("/api/config").json
    assert data["ai_enabled"] is False
    assert data["categories"] == ["Breakfast", "Lunch", "Dinner", "Dessert"]
    assert data["multipliers"] == [1, 2, 3, 4]
    assert data["days"][0] == "Monday" and len(data["days"]) == 7


def test_errors_are_json(client):
    for response in (client.get("/api/recipes/999"), client.get("/api/nope"), client.put("/api/list")):
        assert response.is_json and response.json["error"], response.status_code
    assert client.get("/api/recipes/999").status_code == 404
    assert client.get("/api/nope").status_code == 404
    assert client.put("/api/list").status_code == 405


def test_demo_recipes_are_seeded_once(make_app):
    app = make_app(SEED_DEMO_DATA=True)
    make_app(SEED_DEMO_DATA=True)  # second start must not duplicate
    conn = database.connect(app.config["DATABASE_PATH"])
    try:
        assert len(database.list_recipes(conn)) == len(database.SEED_RECIPES) == 6
    finally:
        conn.close()


# ---------- serving the React build ----------

def make_dist(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>")
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)")
    (dist / "sw.js").write_text("self.addEventListener('fetch', () => {})")
    return dist


def test_spa_routes_return_index_html(make_app, tmp_path):
    client = make_app(FRONTEND_DIST=str(make_dist(tmp_path))).test_client()
    for path in ("/", "/shopping", "/planner", "/insights", "/recipes/3"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert b'id=root' in response.data
        assert response.headers["Cache-Control"] == "no-cache"


def test_fingerprinted_assets_are_cached_forever(make_app, tmp_path):
    client = make_app(FRONTEND_DIST=str(make_dist(tmp_path))).test_client()
    asset = client.get("/assets/index-abc123.js")
    assert asset.status_code == 200 and "immutable" in asset.headers["Cache-Control"]
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and sw.headers["Cache-Control"] == "no-cache"


def test_missing_files_and_api_paths_are_not_swallowed_by_the_spa(make_app, tmp_path):
    client = make_app(FRONTEND_DIST=str(make_dist(tmp_path))).test_client()
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/api/unknown").status_code == 404
    assert client.get("/../app.py").status_code == 404


def test_unbuilt_frontend_gives_a_clear_message(make_app, tmp_path):
    client = make_app(FRONTEND_DIST=str(tmp_path / "nowhere")).test_client()
    response = client.get("/planner")
    assert response.status_code == 503 and "npm run build" in response.json["error"]


# ---------- recipes ----------

def test_create_recipe(client, db):
    response = client.post("/api/recipes", json=recipe_body())
    assert response.status_code == 201
    recipe = response.json["recipe"]
    assert recipe["title"] == "Lemon Rice"
    assert recipe["lines"] == ["1 cup rice", "1 lemon", "salt to taste"]
    assert "vegetarian" in recipe["diet_tags"]
    assert db.execute("SELECT COUNT(*) FROM events WHERE type = 'recipe_saved'").fetchone()[0] == 1


def test_create_recipe_accepts_a_list_and_trims(client):
    response = client.post("/api/recipes", json=recipe_body(
        title="  Spaced   Title ", prep_time="10", ingredients=[" 2 eggs ", "", "- 1 cup milk"]))
    recipe = response.json["recipe"]
    assert recipe["title"] == "Spaced Title" and recipe["prep_time"] == 10
    assert recipe["lines"] == ["2 eggs", "1 cup milk"]


def test_create_recipe_validation(client, db):
    cases = {
        "title": [recipe_body(title=""), recipe_body(title="x" * 121), recipe_body(title=None)],
        "prep_time": [recipe_body(prep_time=""), recipe_body(prep_time=-5), recipe_body(prep_time="abc"),
                      recipe_body(prep_time=1441), recipe_body(prep_time="2.5")],
        "category": [recipe_body(category="Brunch"), recipe_body(category="lunch"), recipe_body(category="")],
        "ingredients": [recipe_body(ingredients=""), recipe_body(ingredients="  \n "),
                        recipe_body(ingredients="\n".join(["1 egg"] * 61)), recipe_body(ingredients="x" * 201)],
    }
    for field, bodies in cases.items():
        for body in bodies:
            response = client.post("/api/recipes", json=body)
            assert response.status_code == 400, (field, body)
            assert field in response.json["fields"] and response.json["error"]
    for bad in (recipe_body(ingredients=5), recipe_body(ingredients=["ok", 3])):
        assert client.post("/api/recipes", json=bad).status_code == 400
    assert client.post("/api/recipes", data="not json").status_code == 400
    assert database.list_recipes(db) == []


def test_get_and_delete_recipe_cascades_to_planner(client, db, add_recipe):
    recipe_id = add_recipe()
    assert client.get(f"/api/recipes/{recipe_id}").json["recipe"]["title"] == "Test Pancakes"
    database.add_to_plan(db, "Monday", recipe_id, 1)
    db.commit()
    response = client.delete(f"/api/recipes/{recipe_id}")
    assert response.status_code == 200 and response.json == {"deleted": recipe_id}
    assert database.get_recipe(db, recipe_id) is None
    assert db.execute("SELECT COUNT(*) FROM meal_plan").fetchone()[0] == 0
    assert client.delete(f"/api/recipes/{recipe_id}").status_code == 404


def test_category_filter(client, add_recipe):
    add_recipe(title="Morning Oats", category="Breakfast")
    add_recipe(title="Club Sandwich", category="Lunch")
    add_recipe(title="Night Curry", category="Dinner")
    add_recipe(title="Sweet Pie", category="Dessert")

    def titles(query=""):
        return [r["title"] for r in client.get(f"/api/recipes{query}").json["recipes"]]

    assert titles("?category=Lunch") == ["Club Sandwich"]
    assert titles("?category=Dinner") == ["Night Curry"]
    assert titles("?category=Dessert") == ["Sweet Pie"]
    assert sorted(titles()) == ["Club Sandwich", "Morning Oats", "Night Curry", "Sweet Pie"]
    assert client.get("/api/recipes?category=Brunch").status_code == 400


# ---------- scaling ----------

def test_scaled_ingredients(client, add_recipe):
    recipe_id = add_recipe(lines=["1 1/2 cups flour", "1 egg", "salt to taste", "2-inch piece ginger"])
    response = client.get(f"/api/recipes/{recipe_id}/scaled?x=2")
    assert response.status_code == 200
    assert response.json == {"multiplier": 2, "lines": ["3 cups flour", "2 eggs", "salt to taste", "2-inch piece ginger"]}


def test_scaled_rejects_bad_multipliers(client, add_recipe):
    recipe_id = add_recipe()
    for bad in ("0", "5", "abc", "2.5", "-1", ""):
        response = client.get(f"/api/recipes/{recipe_id}/scaled?x={bad}")
        assert response.status_code == 400, bad
        assert response.json["error"]
    assert client.get("/api/recipes/999/scaled?x=2").status_code == 404


# ---------- shopping list ----------

def test_add_recipe_to_list(client, db, add_recipe):
    recipe_id = add_recipe(lines=["1 cup milk", "2 eggs"])
    response = client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 2})
    assert response.status_code == 200
    assert response.json["added"] == 2 and response.json["counts"]["open"] == 2
    response = client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 1})
    assert response.json["merged"] == 2
    assert labels(db) == ["3 cups milk", "6 eggs"]


def test_add_recipe_to_list_validation(client, add_recipe):
    recipe_id = add_recipe()
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", data="nope").status_code == 400
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", json=[1]).status_code == 400
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 7}).status_code == 400
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": True}).status_code == 400
    assert client.post("/api/recipes/999/add-to-list", json={"multiplier": 1}).status_code == 404


def test_list_is_grouped_by_aisle(client, db):
    shopping.add_lines(db, ["2 eggs", "1 onion"])
    db.commit()
    data = client.get("/api/list").json
    assert [g["aisle"] for g in data["groups"]] == ["Produce", "Dairy & Eggs"]
    item = data["groups"][0]["items"][0]
    assert set(item) == {"id", "label", "amount", "name", "aisle", "checked", "sources"}
    assert data["counts"] == {"total": 2, "checked": 0, "open": 2}


def test_check_and_uncheck_persist(client, db):
    shopping.add_line(db, "2 eggs")
    db.commit()
    item_id = db.execute("SELECT id FROM shopping_list").fetchone()[0]
    response = client.post(f"/api/list/{item_id}/check", json={"checked": True})
    assert response.status_code == 200 and response.json["checked"] is True
    assert response.json["counts"] == {"total": 1, "checked": 1, "open": 0}
    assert client.get("/api/list").json["groups"][0]["items"][0]["checked"] is True
    # setting the same state again (an offline replay) is harmless
    assert client.post(f"/api/list/{item_id}/check", json={"checked": True}).status_code == 200
    client.post(f"/api/list/{item_id}/check", json={"checked": False})
    assert db.execute("SELECT checked FROM shopping_list").fetchone()[0] == 0


def test_change_an_items_amount(client, db):
    shopping.add_line(db, "6 apples")
    db.commit()
    item_id = db.execute("SELECT id FROM shopping_list").fetchone()[0]
    response = client.post(f"/api/list/{item_id}/amount", json={"amount": "1"})
    assert response.status_code == 200
    assert response.json["item"]["label"] == "1 apple" and response.json["counts"]["total"] == 1
    assert client.get("/api/list").json["groups"][0]["items"][0]["label"] == "1 apple"

    bad = client.post(f"/api/list/{item_id}/amount", json={"amount": "lots"})
    assert bad.status_code == 400 and "apples" in bad.json["error"]
    assert client.post(f"/api/list/{item_id}/amount", json={"amount": 1}).status_code == 400
    assert client.post(f"/api/list/{item_id}/amount", json={"amount": "1" * 201}).status_code == 400
    assert client.post("/api/list/999/amount", json={"amount": "1"}).status_code == 404


def test_remove_one_item(client, db):
    shopping.add_lines(db, ["6 apples", "1 cup milk"])
    db.commit()
    item_id = db.execute("SELECT id FROM shopping_list WHERE item_key = 'apple'").fetchone()[0]
    response = client.delete(f"/api/list/{item_id}")
    assert response.status_code == 200 and response.json["counts"]["total"] == 1
    assert client.delete(f"/api/list/{item_id}").status_code == 404


def test_check_validation(client, db):
    shopping.add_line(db, "2 eggs")
    db.commit()
    item_id = db.execute("SELECT id FROM shopping_list").fetchone()[0]
    assert client.post(f"/api/list/{item_id}/check", json={"checked": "yes"}).status_code == 400
    assert client.post(f"/api/list/{item_id}/check", json={}).status_code == 400
    assert client.post("/api/list/999/check", json={"checked": True}).status_code == 404


def test_clear_list(client, db):
    shopping.add_lines(db, ["2 eggs", "1 cup milk", "1 lemon"])
    db.commit()
    first = db.execute("SELECT id FROM shopping_list ORDER BY id").fetchone()[0]
    client.post(f"/api/list/{first}/check", json={"checked": True})

    response = client.post("/api/list/clear", json={"scope": "checked"})
    assert response.json == {"removed": 1, "scope": "checked", "counts": {"total": 2, "checked": 0, "open": 2}}
    response = client.post("/api/list/clear", json={})
    assert response.json["removed"] == 2 and response.json["counts"]["total"] == 0
    assert client.post("/api/list/clear", json={"scope": "everything"}).status_code == 400
    assert db.execute("SELECT COUNT(*) FROM events WHERE type = 'list_cleared'").fetchone()[0] == 2


def test_add_single_item(client, db):
    response = client.post("/api/list/items", json={"line": "2 lemons"})
    assert response.status_code == 201 and response.json["added"] == 1
    response = client.post("/api/list/items", json={"line": "1 lemon"})
    assert response.json["merged"] == 1
    assert labels(db) == ["3 lemons"]
    for bad in ({"line": ""}, {"line": "   "}, {"line": 5}, {}, {"line": "x" * 201}):
        assert client.post("/api/list/items", json=bad).status_code == 400, bad


# ---------- planner ----------

def test_planner_add_remove_and_build(client, db, add_recipe):
    pancakes = add_recipe(title="Pancakes", lines=["1 cup milk", "2 eggs"])
    omelette = add_recipe(title="Omelette", lines=["3 eggs", "1/2 cup milk"])
    response = client.post("/api/planner", json={"day": "Monday", "recipe_id": pancakes, "multiplier": 2})
    assert response.status_code == 201
    assert response.json["plan"]["Monday"][0]["title"] == "Pancakes"
    assert response.json["plan"]["Monday"][0]["multiplier"] == 2
    client.post("/api/planner", json={"day": "Tuesday", "recipe_id": str(omelette)})

    plan = client.get("/api/planner").json
    assert plan["days"][0] == "Monday" and plan["plan"]["Tuesday"][0]["multiplier"] == 1

    response = client.post("/api/planner/build")
    assert response.status_code == 200
    assert response.json["meals"] == 2 and response.json["counts"]["open"] == 2
    assert labels(db) == ["2 1/2 cups milk", "7 eggs"]
    vias = db.execute("SELECT json_extract(payload, '$.via') FROM events WHERE type = 'list_added'").fetchall()
    assert [v[0] for v in vias] == ["planner", "planner"]

    entry_id = plan["plan"]["Tuesday"][0]["id"]
    assert client.delete(f"/api/planner/{entry_id}").json["plan"]["Tuesday"] == []
    assert client.delete(f"/api/planner/{entry_id}").status_code == 404
    response = client.post("/api/planner/clear")
    assert response.json["removed"] == 1
    assert all(not meals for meals in response.json["plan"].values())


def test_planner_validation(client, db, add_recipe):
    recipe_id = add_recipe()
    bad_bodies = [
        {"day": "Funday", "recipe_id": recipe_id, "multiplier": 1},
        {"day": "Monday", "recipe_id": "abc", "multiplier": 1},
        {"day": "Monday", "recipe_id": True, "multiplier": 1},
        {"day": "Monday", "recipe_id": 999, "multiplier": 1},
        {"day": "Monday", "recipe_id": recipe_id, "multiplier": 9},
    ]
    for body in bad_bodies:
        response = client.post("/api/planner", json=body)
        assert response.status_code == 400 and response.json["error"], body
    assert all(not meals for meals in database.list_plan(db).values())


def test_build_with_empty_plan_is_rejected(client, db):
    response = client.post("/api/planner/build")
    assert response.status_code == 400 and "Plan some meals first" in response.json["error"]
    assert shopping.counts(db)["total"] == 0


# ---------- insights ----------

def test_insights_reflect_events(client, db, add_recipe):
    recipe_id = add_recipe(title="Popular Pancakes", lines=["2 eggs"])
    for _ in range(3):
        client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 1})
    item_id = db.execute("SELECT id FROM shopping_list").fetchone()[0]
    client.post(f"/api/list/{item_id}/check", json={"checked": True})
    data = client.get("/api/insights").json
    assert data["top_recipes"][0] == {"label": "Popular Pancakes", "count": 3, "percent": 100}
    assert data["top_items"][0]["count"] == 1
    breakfast = next(c for c in data["categories"] if c["label"] == "Breakfast")
    assert (breakfast["saved"], breakfast["added"], breakfast["recent"]) == (1, 3, 3)
    assert data["counts"]["recipes"] == 1
    assert (data["ai_calls"], data["ai_cap"], data["looker_url"]) == (0, 300, None)


def test_insights_looker_link_only_for_https(make_app):
    url = "https://lookerstudio.google.com/reporting/abc"
    assert make_app(LOOKER_STUDIO_URL=url).test_client().get("/api/insights").json["looker_url"] == url


def test_insights_ignores_non_https_looker_link(make_app):
    client = make_app(LOOKER_STUDIO_URL="javascript:alert(1)").test_client()
    assert client.get("/api/insights").json["looker_url"] is None


# ---------- CSRF ----------

def test_csrf_is_enforced_on_writes(make_app):
    client = make_app(CSRF_ENABLED=True).test_client()
    response = client.post("/api/list/clear", json={"scope": "all"})
    assert response.status_code == 403 and "session" in response.json["error"]
    assert client.post("/api/recipes", json=recipe_body()).status_code == 403
    assert client.delete("/api/recipes/1").status_code == 403

    token = client.get("/api/csrf").json["token"]
    headers = {"X-CSRF-Token": token}
    assert client.post("/api/list/clear", json={"scope": "all"}, headers=headers).status_code == 200
    assert client.post("/api/recipes", json=recipe_body(), headers=headers).status_code == 201
    assert client.post("/api/list/clear", json={}, headers={"X-CSRF-Token": "wrong"}).status_code == 403


def test_csrf_token_is_stable_for_a_session(make_app):
    client = make_app(CSRF_ENABLED=True).test_client()
    assert client.get("/api/csrf").json["token"] == client.get("/api/csrf").json["token"]


def test_database_from_before_lunch_is_migrated_without_losing_data(tmp_path):
    path = str(tmp_path / "old.db")
    old_schema = database.SCHEMA.replace("'Breakfast', 'Lunch', 'Dinner', 'Dessert'", "'Breakfast', 'Dinner', 'Dessert'")
    conn = database.connect(path)
    conn.executescript(old_schema)
    for title in ("Oats", "Gone", "Curry"):
        conn.execute("INSERT INTO recipes (title, prep_time, category, ingredients) VALUES (?, 10, 'Dinner', '[]')",
                     (title,))
    conn.execute("DELETE FROM recipes WHERE title = 'Gone'")
    conn.execute("INSERT INTO meal_plan (day, recipe_id) VALUES ('Monday', 3)")
    conn.commit()
    conn.close()

    database.init_db(path, seed=False)
    database.init_db(path, seed=False)  # a second start is a no-op

    conn = database.connect(path)
    assert [r["title"] for r in database.list_recipes(conn)] == ["Curry", "Oats"]
    assert [tuple(r) for r in conn.execute("SELECT recipe_id FROM meal_plan")] == [(3,)]
    new_id = database.create_recipe(conn, {"title": "Wrap", "prep_time": 5, "category": "Lunch", "ingredients": ["1 wrap"]})
    assert new_id == 4  # the deleted recipe's id is not reused
    assert database.delete_recipe(conn, 3)
    assert conn.execute("SELECT COUNT(*) FROM meal_plan").fetchone()[0] == 0  # cascade still works
    conn.close()

import re

import database
import shopping


def valid_form(**overrides):
    form = {"title": "Lemon Rice", "prep_time": "25", "category": "Dinner",
            "ingredients": "1 cup rice\n1 lemon\nsalt to taste"}
    form.update(overrides)
    return form


# ---------- basics ----------

def test_healthz(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json == {"status": "ok"}


def test_security_headers(client):
    headers = client.get("/").headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    assert client.get("/api/list").headers["Cache-Control"] == "no-store"


def test_pages_render(client, add_recipe):
    recipe_id = add_recipe()
    for url in ("/", "/list", "/planner", "/insights", "/recipes/new", f"/recipes/{recipe_id}"):
        assert client.get(url).status_code == 200, url


def test_missing_pages_return_404(client):
    assert client.get("/recipes/999").status_code == 404
    response = client.get("/api/recipes/999/scaled?x=2")
    assert response.status_code == 404 and "error" in response.json


def test_pwa_files_are_served(client):
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and "javascript" in sw.content_type
    assert sw.headers["Cache-Control"] == "no-cache"
    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200 and manifest.content_type == "application/manifest+json"
    assert client.get("/static/icons/icon-192.png").status_code == 200


def test_demo_recipes_are_seeded_once(make_app, tmp_path):
    app = make_app(SEED_DEMO_DATA=True)
    make_app(SEED_DEMO_DATA=True)  # second start must not duplicate
    conn = database.connect(app.config["DATABASE_PATH"])
    try:
        assert len(database.list_recipes(conn)) == len(database.SEED_RECIPES) == 6
    finally:
        conn.close()


def test_jinja_autoescapes_user_content(client, add_recipe):
    add_recipe(title="<script>alert(1)</script>")
    body = client.get("/").get_data(as_text=True)
    assert "<script>alert(1)</script>" not in body
    assert "&lt;script&gt;" in body


# ---------- recipes ----------

def test_create_recipe(client, db):
    response = client.post("/recipes", data=valid_form())
    assert response.status_code == 302
    recipe = database.list_recipes(db)[0]
    assert recipe["title"] == "Lemon Rice"
    assert recipe["lines"] == ["1 cup rice", "1 lemon", "salt to taste"]
    assert "vegetarian" in recipe["diet_tags"]
    assert db.execute("SELECT COUNT(*) FROM events WHERE type = 'recipe_saved'").fetchone()[0] == 1


def test_create_recipe_trims_and_splits_lines(client, db):
    client.post("/recipes", data=valid_form(title="  Spaced   Title ", ingredients="\n 2 eggs \r\n\n- 1 cup milk\n"))
    recipe = database.list_recipes(db)[0]
    assert recipe["title"] == "Spaced Title"
    assert recipe["lines"] == ["2 eggs", "1 cup milk"]


def test_create_recipe_validation(client, db):
    cases = {
        "title": [valid_form(title=""), valid_form(title="x" * 121)],
        "prep_time": [valid_form(prep_time=""), valid_form(prep_time="-5"), valid_form(prep_time="abc"),
                      valid_form(prep_time="1441"), valid_form(prep_time="2.5")],
        "category": [valid_form(category="Lunch"), valid_form(category="")],
        "ingredients": [valid_form(ingredients=""), valid_form(ingredients="  \n "),
                        valid_form(ingredients="\n".join(["1 egg"] * 61)), valid_form(ingredients="x" * 201)],
    }
    for field, forms in cases.items():
        for form in forms:
            response = client.post("/recipes", data=form)
            assert response.status_code == 400, (field, form)
            assert f'id="{field}' in response.get_data(as_text=True)
            assert 'aria-invalid="true"' in response.get_data(as_text=True)
    assert database.list_recipes(db) == []


def test_delete_recipe_cascades_to_planner(client, db, add_recipe):
    recipe_id = add_recipe()
    database.add_to_plan(db, "Monday", recipe_id, 1)
    db.commit()
    assert client.post(f"/recipes/{recipe_id}/delete").status_code == 302
    assert database.get_recipe(db, recipe_id) is None
    assert db.execute("SELECT COUNT(*) FROM meal_plan").fetchone()[0] == 0
    assert client.post(f"/recipes/{recipe_id}/delete").status_code == 404


def test_category_filter(client, add_recipe):
    add_recipe(title="Morning Oats", category="Breakfast")
    add_recipe(title="Night Curry", category="Dinner")
    add_recipe(title="Sweet Pie", category="Dessert")
    body = client.get("/?category=Dinner").get_data(as_text=True)
    assert "Night Curry" in body and "Morning Oats" not in body and "Sweet Pie" not in body
    body = client.get("/?category=Dessert").get_data(as_text=True)
    assert "Sweet Pie" in body and "Night Curry" not in body
    unknown = client.get("/?category=Lunch").get_data(as_text=True)  # unknown filter shows everything
    assert all(title in unknown for title in ("Morning Oats", "Night Curry", "Sweet Pie"))


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


# ---------- shopping list API ----------

def test_add_recipe_to_list(client, db, add_recipe):
    recipe_id = add_recipe(lines=["1 cup milk", "2 eggs"])
    response = client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 2})
    assert response.status_code == 200
    assert response.json["added"] == 2 and response.json["counts"]["open"] == 2
    response = client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 1})
    assert response.json["merged"] == 2
    labels = [i["label"] for g in shopping.grouped_items(db) for i in g["items"]]
    assert sorted(labels) == ["3 cups milk", "6 eggs"]


def test_add_recipe_to_list_validation(client, add_recipe):
    recipe_id = add_recipe()
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", data="nope").status_code == 400
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", json=[1]).status_code == 400
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 7}).status_code == 400
    assert client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": True}).status_code == 400
    assert client.post("/api/recipes/999/add-to-list", json={"multiplier": 1}).status_code == 404


def test_check_and_uncheck_persist(client, db):
    shopping.add_line(db, "2 eggs")
    db.commit()
    item_id = db.execute("SELECT id FROM shopping_list").fetchone()[0]
    response = client.post(f"/api/list/{item_id}/check", json={"checked": True})
    assert response.status_code == 200 and response.json["checked"] is True
    assert db.execute("SELECT checked FROM shopping_list").fetchone()[0] == 1
    assert 'class="item is-checked"' in client.get("/list/fragment").get_data(as_text=True)
    client.post(f"/api/list/{item_id}/check", json={"checked": False})
    assert db.execute("SELECT checked FROM shopping_list").fetchone()[0] == 0


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
    assert "3 lemons" in client.get("/list/fragment").get_data(as_text=True)
    for bad in ({"line": ""}, {"line": "   "}, {"line": 5}, {}, {"line": "x" * 201}):
        assert client.post("/api/list/items", json=bad).status_code == 400, bad


def test_api_list_json(client, db):
    shopping.add_lines(db, ["2 eggs", "1 onion"])
    db.commit()
    data = client.get("/api/list").json
    assert [g["aisle"] for g in data["groups"]] == ["Produce", "Dairy & Eggs"]
    assert data["counts"]["open"] == 2


def test_dashboard_shows_both_panes(client, db, add_recipe):
    recipe_id = add_recipe(title="Side By Side")
    client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 1})
    body = client.get("/").get_data(as_text=True)
    assert "Side By Side" in body
    assert "data-list-root" in body and "2 cups flour" in body
    assert re.search(r"data-open-count[^>]*>\s*2\s*<", body)


# ---------- planner ----------

def test_planner_add_remove_and_build(client, db, add_recipe):
    pancakes = add_recipe(title="Pancakes", lines=["1 cup milk", "2 eggs"])
    omelette = add_recipe(title="Omelette", lines=["3 eggs", "1/2 cup milk"])
    assert client.post("/planner", data={"day": "Monday", "recipe_id": pancakes, "multiplier": "2"}).status_code == 302
    client.post("/planner", data={"day": "Tuesday", "recipe_id": omelette, "multiplier": "1"})
    plan = database.list_plan(db)
    assert [e["title"] for e in plan["Monday"]] == ["Pancakes"] and plan["Monday"][0]["multiplier"] == 2

    response = client.post("/planner/build")
    assert response.status_code == 302 and response.headers["Location"].endswith("/list")
    labels = sorted(i["label"] for g in shopping.grouped_items(db) for i in g["items"])
    assert labels == ["2 1/2 cups milk", "7 eggs"]
    vias = db.execute("SELECT json_extract(payload, '$.via') FROM events WHERE type = 'list_added'").fetchall()
    assert [v[0] for v in vias] == ["planner", "planner"]

    entry_id = plan["Tuesday"][0]["id"]
    assert client.post(f"/planner/{entry_id}/delete").status_code == 302
    assert database.list_plan(db)["Tuesday"] == []
    assert client.post(f"/planner/{entry_id}/delete").status_code == 404
    client.post("/planner/clear")
    assert all(not meals for meals in database.list_plan(db).values())


def test_planner_validation(client, db, add_recipe):
    recipe_id = add_recipe()
    bad_forms = [
        {"day": "Funday", "recipe_id": recipe_id, "multiplier": "1"},
        {"day": "Monday", "recipe_id": "abc", "multiplier": "1"},
        {"day": "Monday", "recipe_id": 999, "multiplier": "1"},
        {"day": "Monday", "recipe_id": recipe_id, "multiplier": "9"},
    ]
    for form in bad_forms:
        assert client.post("/planner", data=form).status_code == 400, form
    assert all(not meals for meals in database.list_plan(db).values())


def test_build_with_empty_plan_is_harmless(client, db):
    response = client.post("/planner/build", follow_redirects=True)
    assert response.status_code == 200
    assert "Plan some meals first" in response.get_data(as_text=True)
    assert shopping.counts(db)["total"] == 0


# ---------- insights ----------

def test_insights_reflect_events(client, db, add_recipe):
    recipe_id = add_recipe(title="Popular Pancakes", lines=["2 eggs"])
    for _ in range(3):
        client.post(f"/api/recipes/{recipe_id}/add-to-list", json={"multiplier": 1})
    item_id = db.execute("SELECT id FROM shopping_list").fetchone()[0]
    client.post(f"/api/list/{item_id}/check", json={"checked": True})
    data = database.insights(db)
    assert data["top_recipes"][0] == {"label": "Popular Pancakes", "count": 3, "percent": 100}
    assert data["top_items"][0]["count"] == 1
    breakfast = next(c for c in data["categories"] if c["label"] == "Breakfast")
    assert (breakfast["saved"], breakfast["added"], breakfast["recent"]) == (1, 3, 3)
    body = client.get("/insights").get_data(as_text=True)
    assert "Popular Pancakes" in body and "width: 100%" in body


def test_insights_looker_link_only_for_https(make_app):
    app = make_app(LOOKER_STUDIO_URL="https://lookerstudio.google.com/reporting/abc")
    assert "lookerstudio.google.com/reporting/abc" in app.test_client().get("/insights").get_data(as_text=True)


def test_insights_ignores_non_https_looker_link(make_app):
    app = make_app(LOOKER_STUDIO_URL="javascript:alert(1)")
    assert "javascript:alert" not in app.test_client().get("/insights").get_data(as_text=True)


# ---------- CSRF ----------

def test_csrf_is_enforced_on_writes(make_app):
    client = make_app(CSRF_ENABLED=True).test_client()
    response = client.post("/api/list/clear", json={"scope": "all"})
    assert response.status_code == 403 and "session" in response.json["error"]
    assert client.post("/recipes", data=valid_form()).status_code == 403

    token = client.get("/api/csrf").json["token"]
    assert client.post("/api/list/clear", json={"scope": "all"}, headers={"X-CSRF-Token": token}).status_code == 200
    assert client.post("/recipes", data={**valid_form(), "csrf_token": token}).status_code == 302
    assert client.post("/api/list/clear", json={}, headers={"X-CSRF-Token": "wrong"}).status_code == 403


def test_csrf_token_is_embedded_in_pages(make_app):
    client = make_app(CSRF_ENABLED=True).test_client()
    body = client.get("/recipes/new").get_data(as_text=True)
    token = re.search(r'name="csrf-token" content="([^"]+)"', body).group(1)
    assert f'name="csrf_token" value="{token}"' in body

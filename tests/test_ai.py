from types import SimpleNamespace

import pytest

import database
import gcp
from conftest import AI_CONFIG, PNG


@pytest.fixture
def ai_client(make_app):
    return make_app(**AI_CONFIG).test_client()


# ---------- fallbacks when Gemini is off ----------

def test_nutrition_fallback_gives_keyword_tags(client, db, add_recipe):
    recipe_id = add_recipe(lines=["1 cup rice", "1/2 cup cashews"])
    response = client.post(f"/api/recipes/{recipe_id}/nutrition")
    assert response.status_code == 200
    assert response.json["source"] == "basic" and response.json["nutrition"] is None
    assert response.json["diet_tags"] == ["vegetarian", "vegan", "gluten-free", "dairy-free", "contains nuts"]
    assert "keyword" in response.json["message"]
    assert database.get_recipe(db, recipe_id)["nutrition"] is None


def test_substitute_fallback_uses_builtin_list(client):
    response = client.post("/api/substitute", json={"ingredient": "1 cup buttermilk"})
    assert response.status_code == 200 and response.json["source"] == "basic"
    assert response.json["substitutes"][0]["swap"].startswith("1 cup milk")
    unknown = client.post("/api/substitute", json={"ingredient": "dragonfruit"}).json
    assert unknown["substitutes"] == [] and "No built-in swap" in unknown["message"]


@pytest.mark.parametrize("body", [{}, {"ingredient": ""}, {"ingredient": 12}, {"ingredient": ["egg"]}])
def test_substitute_validation(client, body):
    assert client.post("/api/substitute", json=body).status_code == 400


def test_substitute_rejects_bad_recipe_id(client):
    assert client.post("/api/substitute", json={"ingredient": "egg", "recipe_id": "abc"}).status_code == 400


# ---------- with Gemini (faked) ----------


def test_ai_nutrition_is_saved_and_bounded(make_app, gemini):
    app = make_app(**AI_CONFIG)
    client = app.test_client()
    conn = database.connect(app.config["DATABASE_PATH"])
    recipe_id = database.create_recipe(conn, {"title": "Curry", "prep_time": 30, "category": "Dinner",
                                              "ingredients": ["500 g chicken", "1 cup rice"]})
    conn.commit()
    gemini.answers.append({"servings": 4, "calories": 512.4, "protein_g": 38, "carbs_g": "45", "fat_g": -3,
                           "diet_tags": ["gluten-free", "keto", "dairy-free"]})
    response = client.post(f"/api/recipes/{recipe_id}/nutrition")
    assert response.json["source"] == "ai"
    assert response.json["nutrition"] == {"calories": 512, "estimate": True, "servings": 4,
                                          "protein_g": 38, "carbs_g": 45, "fat_g": None}
    assert response.json["diet_tags"] == ["gluten-free", "dairy-free"]
    saved = database.get_recipe(conn, recipe_id)
    assert saved["nutrition"]["calories"] == 512 and saved["diet_tags"] == ["gluten-free", "dairy-free"]
    assert client.get(f"/api/recipes/{recipe_id}").json["recipe"]["nutrition"]["estimate"] is True
    conn.close()


def test_sanitize_nutrition_rejects_absurd_calories():
    nutrition, tags = gcp.sanitize_nutrition({"calories": 999999, "diet_tags": "vegan"})
    assert nutrition is None and tags == []
    with pytest.raises(gcp.AIError):
        gcp.sanitize_nutrition(["not", "a", "dict"])


def test_ai_substitutes(ai_client, gemini):
    gemini.answers.append({"substitutes": [{"swap": "Greek yogurt", "note": "Same amount."}, "junk",
                                           {"swap": ""}, {"swap": "s" * 300, "note": 5}]})
    response = ai_client.post("/api/substitute", json={"ingredient": "sour cream"})
    assert response.json["source"] == "ai"
    assert response.json["substitutes"][0] == {"swap": "Greek yogurt", "note": "Same amount."}
    assert len(response.json["substitutes"][1]["swap"]) == 80 and response.json["substitutes"][1]["note"] == "5"


def test_ai_substitutes_failure_falls_back(ai_client, gemini):
    gemini.answers.append(gcp.AIError("down"))
    response = ai_client.post("/api/substitute", json={"ingredient": "2 eggs"})
    assert response.json["source"] == "basic" and response.json["substitutes"]


# ---------- guardrails ----------


def test_nutrition_falls_back_when_daily_cap_is_reached(make_app, gemini, add_recipe):
    app = make_app(**AI_CONFIG, AI_DAILY_CAP=1)
    client = app.test_client()
    conn = database.connect(app.config["DATABASE_PATH"])
    recipe_id = database.create_recipe(conn, {"title": "Rice", "prep_time": 5, "category": "Dinner", "ingredients": ["1 cup rice"]})
    conn.commit()
    gemini.answers.append({"calories": 200, "diet_tags": ["vegan"]})
    assert client.post(f"/api/recipes/{recipe_id}/nutrition").json["source"] == "ai"
    second = client.post(f"/api/recipes/{recipe_id}/nutrition").json
    assert second["source"] == "basic" and "limit" in second["message"]
    assert len(gemini.calls) == 1
    conn.close()


def test_ai_endpoints_are_rate_limited(make_app):
    client = make_app(AI_RATE_LIMIT="2/minute").test_client()
    for _ in range(2):
        assert client.post("/api/substitute", json={"ingredient": "egg"}).status_code == 200
    response = client.post("/api/substitute", json={"ingredient": "egg"})
    assert response.status_code == 429
    assert response.json["error"].startswith("Too many requests")
    assert client.get("/api/list").status_code == 200  # non-AI endpoints are not limited


# ---------- the real Gemini wrapper, with a fake client ----------

def test_generate_json_calls_configured_model(monkeypatch):
    captured = {}

    class Models:
        def generate_content(self, *, model, contents, config):
            captured.update(model=model, contents=contents, config=config)
            return SimpleNamespace(text='{"ok": true}')

    monkeypatch.setattr(gcp, "_gemini_client", lambda config: SimpleNamespace(models=Models()))
    config = {**AI_CONFIG, "AI_TIMEOUT_SECONDS": 5}
    assert gcp.generate_json(config, "hello", image=PNG, mime_type="image/png") == {"ok": True}
    assert captured["model"] == "test-model-from-env"
    assert captured["config"].response_mime_type == "application/json"
    assert "untrusted" in captured["config"].system_instruction
    assert captured["contents"][-1] == "hello" and len(captured["contents"]) == 2


@pytest.mark.parametrize("failure", [RuntimeError("network down"), TimeoutError()])
def test_generate_json_wraps_errors(monkeypatch, failure):
    def broken(config):
        raise failure

    monkeypatch.setattr(gcp, "_gemini_client", broken)
    with pytest.raises(gcp.AIError):
        gcp.generate_json({**AI_CONFIG, "AI_TIMEOUT_SECONDS": 5}, "hello")


def test_generate_json_rejects_non_json(monkeypatch):
    class Models:
        def generate_content(self, **kwargs):
            return SimpleNamespace(text="Sure! Here is your recipe")

    monkeypatch.setattr(gcp, "_gemini_client", lambda config: SimpleNamespace(models=Models()))
    with pytest.raises(gcp.AIError):
        gcp.generate_json({**AI_CONFIG, "AI_TIMEOUT_SECONDS": 5}, "hello")


@pytest.mark.parametrize("value, expected", [
    ("a\x00b\x1fc", "a b c"), ("  lots   of\n\nspace ", "lots of space"), (None, ""), (True, ""),
    (["list"], ""), (12, "12"), ("x" * 50, "x" * 10),
])
def test_clean_text(value, expected):
    assert gcp.clean_text(value, 10 if expected == "x" * 10 else 100) == expected

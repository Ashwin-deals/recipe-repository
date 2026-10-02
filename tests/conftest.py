import io

import pytest

import database
import gcp
from app import create_app, limiter

# Every cloud setting is forced off so tests never depend on the developer's environment.
OFFLINE_CONFIG = {
    "LOAD_DOTENV": False,
    "SEED_DEMO_DATA": False,
    "CSRF_ENABLED": False,
    "SECRET_KEY": "test-secret",
    "AI_ENABLED": True,
    "GEMINI_API_KEY": None,
    "GOOGLE_CLOUD_PROJECT": None,
    "GOOGLE_CLOUD_LOCATION": None,
    "GEMINI_MODEL": None,
    "AI_TIMEOUT_SECONDS": 30,
    "GCS_BUCKET": None,
    "BIGQUERY_DATASET": None,
    "LOOKER_STUDIO_URL": None,
    "TRUST_PROXY_HOPS": 0,
    "AI_RATE_LIMIT": "1000/minute",
    "AI_DAILY_CAP": 300,
}

# Vertex AI mode.
AI_CONFIG = {
    "GOOGLE_CLOUD_PROJECT": "test-project",
    "GOOGLE_CLOUD_LOCATION": "us-central1",
    "GEMINI_MODEL": "test-model-from-env",
}

# API-key mode. The key is fake; tests assert it never leaks into responses or logs.
FAKE_API_KEY = "AIzaSyTEST-fake-key-0123456789abcdefXYZ"
API_KEY_CONFIG = {"GEMINI_API_KEY": FAKE_API_KEY, "GEMINI_MODEL": "test-model-from-env"}

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 64


def upload(data, name="photo.jpg", mimetype="image/jpeg"):
    return {"image": (io.BytesIO(data), name, mimetype)}


class FakeGemini:
    """Stands in for gcp.generate_json; queue answers (dicts) or exceptions."""

    def __init__(self):
        self.calls = []
        self.answers = []

    def __call__(self, config, prompt, *, image=None, mime_type=None):
        self.calls.append({"model": config["GEMINI_MODEL"], "prompt": prompt, "image": image, "mime_type": mime_type})
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.fixture
def gemini(monkeypatch):
    fake = FakeGemini()
    monkeypatch.setattr(gcp, "generate_json", fake)
    return fake


@pytest.fixture
def make_app(tmp_path):
    def factory(**overrides):
        config = {**OFFLINE_CONFIG, "DATABASE_PATH": str(tmp_path / "cartchef.db"), **overrides}
        app = create_app(config)
        limiter.reset()  # the limiter is module-level, so clear counts left by earlier tests
        return app

    return factory


@pytest.fixture
def app(make_app):
    return make_app()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def db(app):
    conn = database.connect(app.config["DATABASE_PATH"])
    yield conn
    conn.close()


@pytest.fixture
def add_recipe(db):
    """Insert a recipe directly and return its id."""
    def _add(title="Test Pancakes", category="Breakfast", lines=("2 cups flour", "2 eggs"), prep_time=10):
        recipe_id = database.create_recipe(
            db, {"title": title, "prep_time": prep_time, "category": category, "ingredients": list(lines)}
        )
        db.commit()
        return recipe_id

    return _add

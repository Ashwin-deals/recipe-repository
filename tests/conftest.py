import pytest

import database
from app import create_app, limiter

# Every cloud setting is forced off so tests never depend on the developer's environment.
OFFLINE_CONFIG = {
    "SEED_DEMO_DATA": False,
    "CSRF_ENABLED": False,
    "SECRET_KEY": "test-secret",
    "GOOGLE_CLOUD_PROJECT": None,
    "GOOGLE_CLOUD_LOCATION": None,
    "GEMINI_MODEL": None,
    "GCS_BUCKET": None,
    "BIGQUERY_DATASET": None,
    "LOOKER_STUDIO_URL": None,
    "TRUST_PROXY_HOPS": 0,
    "AI_RATE_LIMIT": "1000/minute",
    "AI_DAILY_CAP": 300,
}

AI_CONFIG = {
    "GOOGLE_CLOUD_PROJECT": "test-project",
    "GOOGLE_CLOUD_LOCATION": "us-central1",
    "GEMINI_MODEL": "test-model-from-env",
}


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

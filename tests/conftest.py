import io

import pytest
from flask.testing import FlaskClient

import auth
import database
import gcp
from app import create_app, limiter

EMAIL = "cook@example.com"
PASSWORD = "correct horse battery"

# Every cloud setting is forced off so tests never depend on the developer's environment.
OFFLINE_CONFIG = {
    "LOAD_DOTENV": False,
    "APP_ENV": "development",
    "SEED_DEMO_DATA": False,
    "CSRF_ENABLED": False,
    "COOKIE_SECURE": False,
    "AUTH_FAILURE_DELAY_MS": 0,
    "DEMO_LOGIN": False,
    "ALLOW_SIGNUPS": True,
    "SECRET_KEY": "test-secret-0123456789abcdef0123456789abcdef",
    "AI_ENABLED": True,
    "GEMINI_API_KEY": None,
    "GOOGLE_CLOUD_PROJECT": None,
    "GOOGLE_CLOUD_LOCATION": None,
    "GEMINI_MODEL": None,
    "AI_TIMEOUT_SECONDS": 30,
    "GCS_BUCKET": None,
    # Long enough that scheduled backups only run when a test calls gcp.flush_backup().
    "GCS_BACKUP_DELAY_SECONDS": 60,
    "BIGQUERY_DATASET": None,
    "LOOKER_STUDIO_URL": None,
    "TRUST_PROXY_HOPS": 0,
    "AI_RATE_LIMIT": "1000/minute",
    "AI_GLOBAL_RATE_LIMIT": "1000/minute",
    "AI_DAILY_CAP": 300,
    "AI_USER_DAILY_CAP": 300,
}


class SignedInClient(FlaskClient):
    """Test client that starts signed in, so existing tests run as a real account.

    ``app.test_client(email=None)`` gives a signed-out client; another email gives another user.
    """

    def __init__(self, *args, email: str | None = EMAIL, password: str = PASSWORD, **kwargs):
        super().__init__(*args, **kwargs)
        self.csrf = None
        if email is None:
            return
        headers = self.csrf_headers()
        body = {"email": email, "password": password}
        response = self.post("/api/auth/signup", json=body, headers=headers)
        if response.status_code == 409:
            response = self.post("/api/auth/login", json=body, headers=headers)
        assert response.status_code in (200, 201), response.json
        self.user = response.json["user"]
        self.csrf = response.json["csrf_token"]

    def csrf_headers(self) -> dict:
        return {"X-CSRF-Token": self.get("/api/csrf").json["token"]}


def user_id(conn, email: str = EMAIL) -> int:
    return conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()[0]


@pytest.fixture(autouse=True)
def fast_password_hashing(monkeypatch):
    """Real scrypt, at a cost low enough that hundreds of test sign-ups stay fast."""
    monkeypatch.setattr(auth, "SCRYPT_N", 2 ** 10)

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


@pytest.fixture(autouse=True)
def no_leftover_backup(monkeypatch):
    """Run any backup a test scheduled while its fakes are still patched in."""
    yield
    gcp.flush_backup()


@pytest.fixture
def make_app(tmp_path):
    def factory(**overrides):
        config = {**OFFLINE_CONFIG, "DATABASE_PATH": str(tmp_path / "cartchef.db"), **overrides}
        app = create_app(config)
        app.test_client_class = SignedInClient
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
def uid(client, db):
    """Id of the signed-in test user (the one ``client`` is signed in as)."""
    return user_id(db)


@pytest.fixture
def add_recipe(db, uid):
    """Insert a recipe for the signed-in user directly and return its id."""
    def _add(title="Test Pancakes", category="Breakfast", lines=("2 cups flour", "2 eggs"), prep_time=10):
        recipe_id = database.create_recipe(
            db, uid, {"title": title, "prep_time": prep_time, "category": category, "ingredients": list(lines)}
        )
        db.commit()
        return recipe_id

    return _add

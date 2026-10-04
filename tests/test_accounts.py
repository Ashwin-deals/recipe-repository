"""Accounts: sign up, sign in, sign out, sessions, CSRF, lockout and deleting an account."""
import logging
import sqlite3

import pytest

import auth
import database
from app import SESSION_COOKIE, create_app
from conftest import EMAIL, OFFLINE_CONFIG, PASSWORD, user_id

STRONG = "plum kettle orbit 42"


def anonymous(app):
    return app.test_client(email=None)


def signup(client, email="new@example.com", password=STRONG, **extra):
    return client.post("/api/auth/signup", json={"email": email, "password": password, **extra})


def login(client, email=EMAIL, password=PASSWORD, **extra):
    return client.post("/api/auth/login", json={"email": email, "password": password, **extra})


def session_cookie(client):
    return client.get_cookie(SESSION_COOKIE)


# ---------- sign up ----------

def test_signup_signs_in_and_returns_only_public_fields(app, db):
    client = anonymous(app)
    response = signup(client, email="  Mixed.Case@Example.COM ", display_name="  Asha  ")
    assert response.status_code == 201
    user = response.json["user"]
    assert user["email"] == "mixed.case@example.com" and user["display_name"] == "Asha" and user["initials"] == "A"
    assert set(user) == {"id", "email", "display_name", "initials", "is_demo", "created_at"}
    assert response.json["csrf_token"]
    assert client.get("/api/auth/me").json["user"]["email"] == "mixed.case@example.com"
    row = db.execute("SELECT * FROM users WHERE email = 'mixed.case@example.com'").fetchone()
    assert row["password_hash"].startswith("scrypt$") and STRONG not in row["password_hash"]
    assert "password" not in response.get_data(as_text=True) and row["password_hash"] not in response.get_data(as_text=True)


def test_display_name_defaults_to_the_email_name(app):
    user = signup(anonymous(app), email="mary.jane_watson@example.com").json["user"]
    assert user["display_name"] == "Mary Jane Watson" and user["initials"] == "MJ"


def test_duplicate_email_is_rejected_case_insensitively(app):
    signup(anonymous(app), email="dup@example.com")
    response = signup(anonymous(app), email="DUP@example.com ")
    assert response.status_code == 409 and "already exists" in response.json["fields"]["email"]


@pytest.mark.parametrize("email", ["", "plain", "a@b", "a b@example.com", "x@example..com", "@example.com",
                                   "a" * 250 + "@example.com", "demo@cartchef.invalid"])
def test_bad_emails_are_rejected(app, email):
    response = signup(anonymous(app), email=email)
    assert response.status_code == 400 and response.json["fields"]["email"]


@pytest.mark.parametrize("password, reason", [
    ("short1", "at least 8"),
    ("x" * 129, "128"),
    ("password", "too easy"),
    ("12345678", "too easy"),
    ("aaaaaaaaaaaa", "too easy"),
    ("newcomer", "too easy"),  # same as the email's name
    (None, "Choose a password"),
])
def test_password_rules(app, password, reason):
    response = signup(anonymous(app), email="newcomer@example.com", password=password)
    assert response.status_code == 400 and reason in response.json["fields"]["password"]


def test_no_composition_rules(app):
    assert signup(anonymous(app), password="all lowercase words").status_code == 201
    assert signup(anonymous(app), email="b@example.com", password="x" * 128).status_code == 400  # one repeated character
    assert signup(anonymous(app), email="c@example.com", password="abc " * 32).status_code == 201  # 128 exactly


def test_signups_can_be_turned_off(make_app):
    app = make_app(ALLOW_SIGNUPS=False)
    response = signup(anonymous(app))
    assert response.status_code == 403 and "closed" in response.json["error"]
    assert anonymous(app).get("/api/config").json["allow_signups"] is False


def test_password_hashes_are_salted_scrypt():
    first, second = auth.hash_password("same password"), auth.hash_password("same password")
    assert first != second and first.startswith("scrypt$")
    assert auth.verify_password("same password", first) and not auth.verify_password("Same password", first)
    assert not auth.verify_password("x", "md5$abc") and not auth.verify_password("x", "!")


# ---------- sign in / sign out ----------

def test_login_and_logout(app):
    client = anonymous(app)
    assert client.get("/api/recipes").status_code == 401
    signup(client, email="cook2@example.com")
    client.post("/api/auth/logout")
    assert client.get("/api/recipes").status_code == 401
    assert client.get("/api/auth/me").json["user"] is None

    response = login(client, email="COOK2@example.com", password=STRONG)
    assert response.status_code == 200 and response.json["user"]["email"] == "cook2@example.com"
    assert client.get("/api/recipes").status_code == 200


def test_login_error_is_generic(app):
    signup(anonymous(app), email="known@example.com")
    wrong_password = login(anonymous(app), email="known@example.com", password="nope nope nope")
    unknown_email = login(anonymous(app), email="unknown@example.com", password="nope nope nope")
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json == unknown_email.json == {"error": "Email or password is incorrect.",
                                                         "code": "bad_credentials"}
    assert login(anonymous(app), email="", password="").status_code == 400


def test_logout_ends_the_session_on_the_server(app):
    client = anonymous(app)
    signup(client)
    stolen = session_cookie(client).value
    client.post("/api/auth/logout")
    thief = anonymous(app)
    thief.set_cookie(SESSION_COOKIE, stolen)
    assert thief.get("/api/recipes").status_code == 401


def test_only_a_hash_of_the_session_token_is_stored(app, db):
    client = anonymous(app)
    signup(client)
    token = session_cookie(client).value
    assert len(token) >= 43  # 256 bits, base64url
    stored = [row[0] for row in db.execute("SELECT token_hash FROM sessions")]
    assert token not in stored and auth.token_hash(token) in stored


def test_cookie_flags(make_app):
    app = make_app(COOKIE_SECURE=True)
    response = signup(anonymous(app))
    cookie = next(h for h in response.headers.getlist("Set-Cookie") if h.startswith(SESSION_COOKIE))
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Secure" in cookie and "Path=/" in cookie
    assert "Expires" not in cookie  # ends with the browser session unless "keep me signed in"

    remembered = login(anonymous(app), email="new@example.com", password=STRONG, remember=True)
    cookie = next(h for h in remembered.headers.getlist("Set-Cookie") if h.startswith(SESSION_COOKIE))
    assert "Expires" in cookie


def test_session_lifetime(app, db):
    client = anonymous(app)
    signup(client, remember=False)
    login(anonymous(app), email="new@example.com", password=STRONG, remember=True)
    days = [row[0] for row in db.execute(
        "SELECT CAST(julianday(expires_at) - julianday(created_at) + 0.5 AS INTEGER) FROM sessions ORDER BY id")]
    assert days == [7, 30]


def test_expired_sessions_are_rejected_and_purged(app, db):
    client = anonymous(app)
    signup(client)
    db.execute("UPDATE sessions SET expires_at = '2000-01-01 00:00:00'")
    db.commit()
    response = client.get("/api/recipes")
    assert response.status_code == 401 and response.json["code"] == "auth"
    assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_signing_in_again_replaces_the_old_session(app, db):
    client = anonymous(app)
    signup(client)
    first = session_cookie(client).value
    login(client, email="new@example.com", password=STRONG)
    assert session_cookie(client).value != first
    assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1


# ---------- lockout and rate limits ----------

def test_lockout_after_five_failures(app):
    signup(anonymous(app), email="target@example.com")
    client = anonymous(app)
    for _ in range(5):
        assert login(client, email="target@example.com", password="wrong guess here").status_code == 401
    locked = login(client, email="target@example.com", password=STRONG)  # even the right password
    assert locked.status_code == 429 and "Try again in 15 minutes" in locked.json["error"]
    # Unknown emails lock the same way, so the lockout doesn't reveal who has an account.
    for _ in range(5):
        login(client, email="ghost@example.com", password="wrong guess here")
    assert login(client, email="ghost@example.com", password="x" * 9).status_code == 429


def test_successful_login_resets_the_failure_count(app):
    signup(anonymous(app), email="forgetful@example.com")
    client = anonymous(app)
    for _ in range(4):
        login(client, email="forgetful@example.com", password="wrong guess here")
    assert login(client, email="forgetful@example.com", password=STRONG).status_code == 200
    for _ in range(4):
        assert login(client, email="forgetful@example.com", password="wrong guess here").status_code == 401


def test_login_is_rate_limited_per_client(make_app):
    app = make_app(LOGIN_RATE_LIMIT="3/minute")
    client = anonymous(app)
    codes = [login(client, email=f"u{i}@example.com", password="whatever pw").status_code for i in range(4)]
    assert codes == [401, 401, 401, 429]


def test_signup_is_rate_limited(make_app):
    app = make_app(SIGNUP_RATE_LIMIT="2/hour")
    client = anonymous(app)
    codes = [signup(client, email=f"s{i}@example.com").status_code for i in range(3)]
    assert codes == [201, 201, 429]


def test_failed_logins_are_slowed_down(make_app, monkeypatch):
    slept = []
    monkeypatch.setattr("app.time.sleep", slept.append)
    app = make_app(AUTH_FAILURE_DELAY_MS=250)
    login(anonymous(app), email="nobody@example.com", password="wrong guess here")
    assert slept == [0.25]


# ---------- CSRF ----------

def test_writes_need_the_sessions_csrf_token(make_app):
    app = make_app(CSRF_ENABLED=True)
    client = app.test_client()  # signs up with a pre-session token, then gets its own
    assert client.post("/api/list/items", json={"line": "2 eggs"}).status_code == 403
    wrong = client.post("/api/list/items", json={"line": "2 eggs"}, headers={"X-CSRF-Token": "forged"})
    assert wrong.status_code == 403 and wrong.json["code"] == "csrf"
    ok = client.post("/api/list/items", json={"line": "2 eggs"}, headers={"X-CSRF-Token": client.csrf})
    assert ok.status_code == 201
    assert client.get("/api/csrf").json["token"] == client.csrf == client.get("/api/auth/me").json["csrf_token"]


def test_csrf_tokens_differ_per_session(make_app):
    app = make_app(CSRF_ENABLED=True)
    first, second = app.test_client(), app.test_client(email="other@example.com")
    assert first.csrf != second.csrf
    stolen = second.post("/api/list/items", json={"line": "1 egg"}, headers={"X-CSRF-Token": first.csrf})
    assert stolen.status_code == 403


def test_sign_in_and_sign_up_need_a_csrf_token_too(make_app):
    app = make_app(CSRF_ENABLED=True)
    client = anonymous(app)
    assert signup(client).status_code == 403
    assert login(client).status_code == 403
    headers = {"X-CSRF-Token": client.get("/api/csrf").json["token"]}
    assert client.post("/api/auth/signup", json={"email": "z@example.com", "password": STRONG},
                       headers=headers).status_code == 201


# ---------- deleting an account ----------

def test_delete_account_needs_the_password_and_removes_everything(app, db):
    alice = app.test_client(email="alice@example.com", password=STRONG)
    bob = app.test_client(email="bob@example.com", password=STRONG)
    for client in (alice, bob):
        recipe = client.post("/api/recipes", json={"title": "Soup", "prep_time": 5, "category": "Lunch",
                                                   "ingredients": "1 onion"}).json["recipe"]
        client.post(f"/api/recipes/{recipe['id']}/add-to-list", json={"multiplier": 1})
        client.post("/api/planner", json={"day": "Monday", "recipe_id": recipe["id"]})
    alice_id = user_id(db, "alice@example.com")

    wrong = alice.delete("/api/auth/account", json={"password": "not my password"})
    assert wrong.status_code == 403 and wrong.json["fields"]["password"]
    assert alice.delete("/api/auth/account", json={}).status_code == 403

    assert alice.delete("/api/auth/account", json={"password": STRONG}).json["deleted"] is True
    assert alice.get("/api/recipes").status_code == 401
    for table in ("users", "sessions", "recipes", "shopping_list", "meal_plan", "events"):
        column = "id" if table == "users" else "user_id"
        assert db.execute(f"SELECT COUNT(*) FROM {table} WHERE {column} = ?", (alice_id,)).fetchone()[0] == 0, table
    assert len(bob.get("/api/recipes").json["recipes"]) == 1
    assert bob.get("/api/list").json["counts"]["total"] == 1
    assert login(anonymous(app), email="alice@example.com", password=STRONG).status_code == 401


# ---------- shared demo ----------

def test_demo_login_is_off_by_default(app):
    client = anonymous(app)
    assert client.post("/api/auth/demo").status_code == 404
    assert client.get("/api/config").json["demo_login"] is False


def test_demo_login_is_shared_resets_daily_and_cannot_be_deleted(make_app, db):
    app = make_app(DEMO_LOGIN=True, SEED_DEMO_DATA=True)
    first = anonymous(app)
    user = first.post("/api/auth/demo").json["user"]
    assert user["is_demo"] is True
    recipes = first.get("/api/recipes").json["recipes"]
    assert len(recipes) == 6
    first.delete(f"/api/recipes/{recipes[0]['id']}")

    second = anonymous(app)
    second.post("/api/auth/demo")
    assert len(second.get("/api/recipes").json["recipes"]) == 5  # shared: same box
    db.execute("UPDATE meta SET value = '2000-01-01' WHERE key = 'demo_reset_day'")
    db.commit()
    anonymous(app).post("/api/auth/demo")
    assert len(second.get("/api/recipes").json["recipes"]) == 6  # reset

    assert second.delete("/api/auth/account", json={"password": ""}).status_code == 403
    assert login(anonymous(app), email=auth.DEMO_EMAIL, password="anything at all").status_code == 401


# ---------- configuration and headers ----------

def test_production_refuses_a_missing_or_default_secret(tmp_path):
    base = {**OFFLINE_CONFIG, "APP_ENV": "production", "DATABASE_PATH": str(tmp_path / "p.db")}
    for secret in (None, "", "changeme", "short-key"):
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            create_app({**base, "SECRET_KEY": secret})
    assert create_app({**base, "SECRET_KEY": "k" * 16 + "0123456789abcdef0123"}).config["SECRET_KEY"]


def test_development_generates_a_secret_when_missing(tmp_path):
    app = create_app({**OFFLINE_CONFIG, "SECRET_KEY": None, "DATABASE_PATH": str(tmp_path / "d.db")})
    assert len(app.config["SECRET_KEY"]) == 64


def test_security_headers_on_auth_responses(app):
    response = signup(anonymous(app))
    headers = response.headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY" and "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    assert headers["Referrer-Policy"] == "same-origin" and headers["Cache-Control"] == "no-store"
    assert "Cookie" in headers["Vary"]


def test_passwords_and_hashes_never_reach_the_logs(make_app, caplog):
    caplog.set_level(logging.DEBUG)
    app = make_app(LOG_LEVEL="DEBUG")
    client = anonymous(app)
    signup(client, email="secretive@example.com")
    login(anonymous(app), email="secretive@example.com", password="a wrong password!")
    client.delete("/api/auth/account", json={"password": STRONG})
    assert STRONG not in caplog.text and "a wrong password!" not in caplog.text and "scrypt$" not in caplog.text


def test_users_table_rejects_duplicate_emails_at_the_database_level(db):
    auth.create_user(db, "unique@example.com", "!", "U", seed=False)
    with pytest.raises(sqlite3.IntegrityError):
        auth.create_user(db, "unique@example.com", "!", "U", seed=False)


def test_unknown_api_paths_need_sign_in_and_public_ones_do_not(app):
    client = anonymous(app)
    for path in ("/api/csrf", "/api/config", "/api/auth/me", "/healthz"):
        assert client.get(path).status_code == 200, path
    assert client.get("/api/insights").status_code == 401

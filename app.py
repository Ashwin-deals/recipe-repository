"""CartChef: Recipe Box & Shopping List Maker.

Flask is a JSON API under /api/*. In production it also serves the built React
app (frontend/dist), returning index.html for any other path so client-side
routes such as /planner survive a refresh.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import secrets
import sqlite3
import time
from urllib.parse import urlparse

from flask import (
    Blueprint, Flask, abort, current_app, g, jsonify, make_response, request, send_from_directory, session,
)
from dotenv import load_dotenv
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

import auth
import database
import gcp
import ingredients
import shopping

log = logging.getLogger("cartchef")
bp = Blueprint("main", __name__)
limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SESSION_COOKIE = "cartchef_session"
# Endpoints that work without signing in. Everything else under /api/ needs an account.
PUBLIC_ENDPOINTS = {
    "main.api_csrf", "main.api_config", "main.api_me", "main.api_login", "main.api_signup",
    "main.api_logout", "main.api_demo", "main.frontend", "main.healthz",
}
# Values people leave SECRET_KEY at; production refuses to start with one of these.
WEAK_SECRETS = {"", "secret", "changeme", "change-me", "dev", "development", "test", "your-secret-key",
                "replace-me", "cartchef"}
LOCKED_OUT = "Too many sign-in attempts. Try again in 15 minutes."
WRONG_LOGIN = "Email or password is incorrect."
FRIENDLY_ERRORS = {
    400: "That request didn't look right.",
    401: "Please sign in to continue.",
    403: "Your session expired. Reload the page and try again.",
    404: "We couldn't find that.",
    405: "That action isn't allowed here.",
    413: "That upload is too large. Photos must be 5 MB or smaller.",
    415: "Use a JPEG, PNG or WebP image.",
    429: "Too many requests. Please wait a minute and try again.",
    500: "Something went wrong on our side.",
}


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

def _env(name: str, default=None):
    value = os.environ.get(name, "").strip()
    return value or default


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, default))
    except ValueError:
        log.warning("Ignoring non-integer %s; using %s", name, default)
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = _env(name)
    return default if value is None else value.lower() in ("1", "true", "yes", "on")


def load_env_file(path: str) -> bool:
    """Load KEY=value pairs from a .env file. Real environment variables always win.

    Returns False (and does nothing) when the file doesn't exist.
    """
    return load_dotenv(path, override=False)


def load_config() -> dict:
    """Read every setting from the environment. Cloud features stay off unless configured."""
    return {
        "DATABASE_PATH": _env("DATABASE_PATH", "instance/cartchef.db"),
        "FRONTEND_DIST": _env("FRONTEND_DIST", "frontend/dist"),
        "APP_ENV": _env("APP_ENV", "production").lower(),
        "SECRET_KEY": _env("SECRET_KEY"),
        "SEED_DEMO_DATA": _env_bool("SEED_DEMO_DATA", True),
        "ALLOW_SIGNUPS": _env_bool("ALLOW_SIGNUPS", True),
        "SESSION_DAYS": _env_int("SESSION_DAYS", 7),
        "REMEMBER_DAYS": _env_int("REMEMBER_DAYS", 30),
        "COOKIE_SECURE": _env_bool("COOKIE_SECURE", True),
        "DEMO_LOGIN": _env_bool("DEMO_LOGIN", False),
        "LOGIN_RATE_LIMIT": _env("LOGIN_RATE_LIMIT", "30/15 minutes"),
        "SIGNUP_RATE_LIMIT": _env("SIGNUP_RATE_LIMIT", "10/hour"),
        "LOGIN_MAX_FAILURES": _env_int("LOGIN_MAX_FAILURES", 5),
        "LOGIN_LOCK_MINUTES": _env_int("LOGIN_LOCK_MINUTES", 15),
        "AUTH_FAILURE_DELAY_MS": _env_int("AUTH_FAILURE_DELAY_MS", 300),
        "TRUST_PROXY_HOPS": _env_int("TRUST_PROXY_HOPS", 0),
        "LOG_LEVEL": _env("LOG_LEVEL", "INFO").upper(),
        "AI_ENABLED": _env_bool("AI_ENABLED", True),
        "GEMINI_API_KEY": _env("GEMINI_API_KEY"),
        "GOOGLE_GENAI_USE_VERTEXAI": _env_bool("GOOGLE_GENAI_USE_VERTEXAI", False),
        "GEMINI_MODEL": _env("GEMINI_MODEL"),
        "GOOGLE_CLOUD_PROJECT": _env("GOOGLE_CLOUD_PROJECT"),
        "GOOGLE_CLOUD_LOCATION": _env("GOOGLE_CLOUD_LOCATION", "global"),
        "AI_DAILY_CAP": _env_int("AI_DAILY_CAP", 300),
        "AI_USER_DAILY_CAP": _env_int("AI_USER_DAILY_CAP", 50),
        "AI_RATE_LIMIT": _env("AI_RATE_LIMIT", "10/minute"),
        "AI_GLOBAL_RATE_LIMIT": _env("AI_GLOBAL_RATE_LIMIT", "60/minute"),
        "CHAT_RATE_LIMIT": _env("CHAT_RATE_LIMIT", "15/minute"),
        "AI_TIMEOUT_SECONDS": _env_int("AI_TIMEOUT_SECONDS", 30),
        "GEMINI_THINKING_BUDGET": _env_int("GEMINI_THINKING_BUDGET", 0),
        "GCS_BUCKET": _env("GCS_BUCKET"),
        "GCS_DB_OBJECT": _env("GCS_DB_OBJECT", "cartchef.db"),
        "GCS_BACKUP_DELAY_SECONDS": _env_int("GCS_BACKUP_DELAY_SECONDS", 2),
        "BIGQUERY_DATASET": _env("BIGQUERY_DATASET"),
        "BIGQUERY_TABLE": _env("BIGQUERY_TABLE", "events"),
        "LOOKER_STUDIO_URL": _env("LOOKER_STUDIO_URL"),
        "CSRF_ENABLED": True,
    }


def create_app(overrides: dict | None = None) -> Flask:
    overrides = overrides or {}
    if overrides.get("LOAD_DOTENV", True):
        load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
    app = Flask(__name__, static_folder=None)
    app.config.update(load_config())
    app.config.update(overrides)
    logging.basicConfig(level=app.config["LOG_LEVEL"], format="%(levelname)s %(name)s: %(message)s")
    # Only the mode is logged, never the key.
    log.info("Gemini mode: %s", gcp.ai_mode_description(app.config))

    for key in ("DATABASE_PATH", "FRONTEND_DIST"):
        if not os.path.isabs(app.config[key]):
            app.config[key] = os.path.join(app.root_path, app.config[key])
    path = app.config["DATABASE_PATH"]
    gcp.restore_db(app.config, path)
    database.init_db(path)

    hops = app.config["TRUST_PROXY_HOPS"]
    app.config.update(
        SECRET_KEY=resolve_secret_key(app),
        # Flask's signed cookie only carries the CSRF token used before signing in.
        SESSION_COOKIE_NAME="cartchef_presession",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=app.config["COOKIE_SECURE"],
        # Room for a 5 MB photo plus form overhead; the photo itself is checked separately.
        MAX_CONTENT_LENGTH=gcp.MAX_IMAGE_BYTES + 256 * 1024,
    )
    if hops > 0:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops)

    if app.config["DEMO_LOGIN"]:
        log.warning("DEMO_LOGIN is on: anyone can use the shared, public demo account.")
    limiter.init_app(app)
    app.register_blueprint(bp)
    app.register_error_handler(HTTPException, handle_http_error)
    app.register_error_handler(Exception, handle_unexpected_error)
    app.teardown_appcontext(close_db)
    return app


def resolve_secret_key(app: Flask) -> str:
    """SECRET_KEY signs cookies and salts analytics ids. Production must set a strong one."""
    secret = app.config["SECRET_KEY"] or ""
    weak = secret.lower() in WEAK_SECRETS or len(secret) < 32
    production = app.config["APP_ENV"] == "production" and not app.debug and not app.testing
    if weak and production:
        raise RuntimeError(
            "SECRET_KEY is missing or too weak. Set it to a long random value, e.g. the output of "
            "`python -c \"import secrets; print(secrets.token_hex(32))\"`. For local development set "
            "APP_ENV=development (or run `flask run --debug`) to use a generated key instead."
        )
    if not secret:
        return database.get_or_create_secret_key(app.config["DATABASE_PATH"])
    if weak:
        log.warning("SECRET_KEY is short or a common default; fine for development, never for production.")
    return secret


# --------------------------------------------------------------------------
# Request plumbing: DB connection, accounts, CSRF, headers, backups, errors
# --------------------------------------------------------------------------

def analytics_rows(secret: str, events: list[dict]) -> list[dict]:
    """Events as sent to BigQuery: the owner becomes a salted hash in the payload (never an email)."""
    rows = []
    for event in events:
        payload = json.loads(event["payload"])
        payload["user_hash"] = auth.analytics_id(secret, event["user_id"])
        rows.append({"type": event["type"], "payload": json.dumps(payload, ensure_ascii=False),
                     "created_at": event["created_at"]})
    return rows


def get_db() -> database.Connection:
    if "db" not in g:
        config = current_app.config
        g.db = database.connect(config["DATABASE_PATH"])
        g.db.on_commit = lambda events: gcp.mirror_events(config, analytics_rows(config["SECRET_KEY"], events))
    return g.db


def current_user_id() -> int:
    """The signed-in user's id, from the server-side session only (never from the request body)."""
    return g.user["id"]


def deny(status: int, message: str, code: str):
    abort(make_response(jsonify(error=message, code=code), status))


def close_db(_exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def presession_csrf() -> str:
    """CSRF token for requests made before signing in (sign in, sign up), in Flask's signed cookie."""
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def csrf_token() -> str:
    if g.get("user") is not None:
        return auth.csrf_for(current_app.config["SECRET_KEY"], g.session_hash)
    return presession_csrf()


@bp.before_app_request
def authenticate():
    """Load the session's user, then require an account and a CSRF token where needed."""
    g.user = g.session_hash = None
    if not request.path.startswith("/api/"):
        return
    row = auth.load_session(get_db(), request.cookies.get(SESSION_COOKIE))
    if row is not None:
        g.user, g.session_hash = row, row["token_hash"]
    if g.user is None and request.endpoint not in PUBLIC_ENDPOINTS:
        deny(401, "Please sign in to continue.", "auth")
    if request.method not in WRITE_METHODS or not current_app.config["CSRF_ENABLED"]:
        return
    expected = csrf_token() if g.user is not None else session.get("csrf_token")
    sent = request.headers.get("X-CSRF-Token")
    if not expected or not sent or not hmac.compare_digest(expected, sent):
        deny(403, "Your session expired. Reload the page and try again.", "csrf")


@bp.after_app_request
def finish_response(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; "
        "base-uri 'self'; form-action 'self'",
    )
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.is_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.vary.add("Cookie")
    config = current_app.config
    if request.method in WRITE_METHODS and response.status_code < 400 and gcp.gcs_enabled(config):
        gcp.schedule_backup(config, config["DATABASE_PATH"])
    return response


def handle_http_error(error: HTTPException):
    # Use our own message from abort(code, "...") if given, else a friendly default.
    custom = error.description != type(error).description and error.code != 429
    message = error.description if custom else FRIENDLY_ERRORS.get(error.code, error.name)
    return jsonify(error=message), error.code


def handle_unexpected_error(error: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.path)
    return jsonify(error=FRIENDLY_ERRORS[500]), 500


# --------------------------------------------------------------------------
# Input helpers
# --------------------------------------------------------------------------

def json_body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, "Send a JSON object.")
    return data


def parse_multiplier(value) -> int:
    text = str(value).strip()
    if isinstance(value, bool) or text not in {str(m) for m in database.MULTIPLIERS}:
        abort(400, "Multiplier must be 1, 2, 3 or 4.")
    return int(text)


def parse_id(value, name: str) -> int:
    if isinstance(value, bool):
        abort(400, f"{name} must be a number.")
    try:
        return int(value)
    except (TypeError, ValueError):
        abort(400, f"{name} must be a number.")


def recipe_or_404(recipe_id: int) -> dict:
    """One of the signed-in user's recipes. Someone else's id gets the same 404 as a missing one."""
    recipe = database.get_recipe(get_db(), current_user_id(), recipe_id)
    if recipe is None:
        abort(404, "That recipe doesn't exist (it may have been deleted).")
    return recipe


def list_payload(db) -> dict:
    uid = current_user_id()
    return {"groups": shopping.grouped_items(db, uid), "counts": shopping.counts(db, uid)}


def list_counts(db) -> dict:
    return shopping.counts(db, current_user_id())


def plan_payload(db) -> dict:
    return {"plan": database.list_plan(db, current_user_id()), "days": list(database.DAYS)}


def looker_url() -> str | None:
    url = current_app.config.get("LOOKER_STUDIO_URL")
    return url if url and urlparse(url).scheme == "https" else None


def client_key() -> str:
    return get_remote_address() or "unknown"


def user_key() -> str:
    """Rate-limit key: the signed-in user, else the client address."""
    user = g.get("user")
    return f"user:{user['id']}" if user is not None else f"ip:{client_key()}"


def email_key() -> str:
    data = request.get_json(silent=True)
    email = auth.normalize_email(data.get("email")) if isinstance(data, dict) else ""
    return f"email:{email}"


def ai_rate_limit() -> str:
    return current_app.config["AI_RATE_LIMIT"]


def ai_global_rate_limit() -> str:
    return current_app.config["AI_GLOBAL_RATE_LIMIT"]


def chat_rate_limit() -> str:
    return current_app.config["CHAT_RATE_LIMIT"]


def login_rate_limit() -> str:
    return current_app.config["LOGIN_RATE_LIMIT"]


def signup_rate_limit() -> str:
    return current_app.config["SIGNUP_RATE_LIMIT"]


# Every AI endpoint shares one limit across all users, on top of each user's own limit.
ai_global_limit = limiter.shared_limit(ai_global_rate_limit, scope="ai-all-users", key_func=lambda: "all")

CAP_MESSAGES = {
    "user": "You've used today's AI allowance for your account",
    "all": "Today's AI limit has been reached",
}


def consume_ai(db, feature: str) -> str | None:
    """Count one AI call against the user's and everyone's daily caps. Returns a reason if over a cap."""
    config = current_app.config
    over = database.consume_ai_call(db, current_user_id(), config["AI_DAILY_CAP"], config["AI_USER_DAILY_CAP"],
                                    feature=feature)
    return CAP_MESSAGES[over] if over else None


def ai_allowed(db, feature: str) -> tuple[bool, str | None]:
    """Whether a Gemini call may be made now, and why not if it can't."""
    if not gcp.ai_enabled(current_app.config):
        return False, "Gemini isn't configured, so CartChef used its built-in fallback."
    over = consume_ai(db, feature)
    if over:
        return False, f"{over}, so CartChef used its built-in fallback."
    return True, None


# --------------------------------------------------------------------------
# App-level endpoints
# --------------------------------------------------------------------------

@bp.get("/healthz")
def healthz():
    try:
        get_db().execute("SELECT 1").fetchone()
    except sqlite3.Error:
        return jsonify(status="error"), 503
    return jsonify(status="ok")


@bp.get("/api/csrf")
def api_csrf():
    return jsonify(token=csrf_token())


@bp.get("/api/config")
def api_config():
    return jsonify(
        allow_signups=current_app.config["ALLOW_SIGNUPS"],
        demo_login=current_app.config["DEMO_LOGIN"],
        ai_enabled=gcp.ai_enabled(current_app.config),
        categories=list(ingredients.CATEGORIES),
        days=list(database.DAYS),
        multipliers=list(database.MULTIPLIERS),
        max_image_bytes=gcp.MAX_IMAGE_BYTES,
    )


# --------------------------------------------------------------------------
# Accounts
# --------------------------------------------------------------------------

def failure_delay() -> None:
    """A small constant pause on failed sign-ins, so guessing is slow."""
    delay = current_app.config["AUTH_FAILURE_DELAY_MS"]
    if delay > 0:
        time.sleep(delay / 1000)


def set_session_cookie(response, token: str, remember: bool, expires) -> None:
    response.set_cookie(
        SESSION_COOKIE, token,
        # Without "keep me signed in" the cookie ends with the browser session (the server
        # session still expires after SESSION_DAYS).
        expires=expires if remember else None,
        httponly=True, samesite="Lax", secure=current_app.config["COOKIE_SECURE"], path="/",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="Lax",
                           secure=current_app.config["COOKIE_SECURE"])


def start_session(db, user_id: int, remember: bool, status: int = 200):
    config = current_app.config
    auth.end_session(db, request.cookies.get(SESSION_COOKIE))  # never reuse a previous session
    days = config["REMEMBER_DAYS"] if remember else config["SESSION_DAYS"]
    token, expires = auth.create_session(db, user_id, days, remember=remember)
    db.commit()
    response = make_response(jsonify(
        user=auth.public_user(auth.get_user(db, user_id)),
        csrf_token=auth.csrf_for(config["SECRET_KEY"], auth.token_hash(token)),
    ), status)
    set_session_cookie(response, token, remember, expires)
    return response


@bp.get("/api/auth/me")
def api_me():
    """Who is signed in (user is null when nobody is), plus the CSRF token to use next."""
    user = auth.public_user(g.user) if g.user is not None else None
    return jsonify(user=user, csrf_token=csrf_token())


@bp.post("/api/auth/signup")
@limiter.limit(signup_rate_limit, key_func=client_key)
@limiter.limit("5/hour", key_func=email_key, scope="signup-email")
def api_signup():
    config = current_app.config
    if not config["ALLOW_SIGNUPS"]:
        deny(403, "New sign-ups are closed right now.", "signups_closed")
    body = json_body()
    email = auth.normalize_email(body.get("email"))
    password = body.get("password")
    fields = {}
    if error := auth.email_error(email):
        fields["email"] = error
    elif email.endswith(".invalid"):
        fields["email"] = "Use a real email address."
    if error := auth.password_error(password, email):
        fields["password"] = error
    if fields:
        return jsonify(error="Please fix the highlighted fields.", fields=fields), 400
    db = get_db()
    message = "An account with this email already exists. Sign in instead."
    if auth.find_user(db, email) is not None:
        failure_delay()
        return jsonify(error=message, fields={"email": message}), 409
    password_hash = auth.hash_password(password)
    try:
        user_id = auth.create_user(db, email, password_hash, auth.clean_display_name(body.get("display_name"), email),
                                   seed=config["SEED_DEMO_DATA"])
    except sqlite3.IntegrityError:
        db.rollback()
        return jsonify(error=message, fields={"email": message}), 409
    return start_session(db, user_id, body.get("remember") is True, status=201)


@bp.post("/api/auth/login")
@limiter.limit(login_rate_limit, key_func=client_key)
def api_login():
    config = current_app.config
    body = json_body()
    email = auth.normalize_email(body.get("email"))
    password = body.get("password")
    if not email or not isinstance(password, str) or not password:
        return jsonify(error="Enter your email and password."), 400
    db = get_db()
    pair_key, email_only_key = auth.failure_keys(config["SECRET_KEY"], email, client_key())
    window, limit = config["LOGIN_LOCK_MINUTES"], config["LOGIN_MAX_FAILURES"]
    # Locked whether or not the account exists, so the lockout can't reveal which emails are registered.
    if (auth.recent_failures(db, pair_key, window) >= limit
            or auth.recent_failures(db, email_only_key, window) >= limit * 4):
        failure_delay()
        return jsonify(error=LOCKED_OUT, code="locked"), 429
    user = auth.find_user(db, email)
    if user is None or user["is_demo"] or len(password) > auth.PASSWORD_MAX:
        auth.burn_password_check(password[:auth.PASSWORD_MAX])
        ok = False
    else:
        ok = auth.verify_password(password, user["password_hash"])
    if not ok:
        auth.record_failure(db, pair_key, email_only_key)
        db.commit()
        failure_delay()
        return jsonify(error=WRONG_LOGIN, code="bad_credentials"), 401
    auth.clear_failures(db, pair_key)
    return start_session(db, user["id"], body.get("remember") is True)


@bp.post("/api/auth/logout")
def api_logout():
    db = get_db()
    auth.end_session(db, request.cookies.get(SESSION_COOKIE))
    db.commit()
    g.user = g.session_hash = None
    session.clear()
    response = make_response(jsonify(signed_out=True, csrf_token=presession_csrf()))
    clear_session_cookie(response)
    return response


@bp.delete("/api/auth/account")
@limiter.limit("5/15 minutes", key_func=user_key)
def api_delete_account():
    """Delete the account and everything in it. Needs the password again."""
    if g.user["is_demo"]:
        deny(403, "The shared demo account can't be deleted.", "demo")
    password = json_body().get("password")
    if not isinstance(password, str) or not auth.verify_password(password[:auth.PASSWORD_MAX * 2],
                                                                  g.user["password_hash"]):
        failure_delay()
        message = "That password is incorrect."
        return jsonify(error=message, fields={"password": message}, code="bad_password"), 403
    db = get_db()
    auth.delete_user(db, current_user_id())
    db.commit()
    g.user = g.session_hash = None
    session.clear()
    response = make_response(jsonify(deleted=True, csrf_token=presession_csrf()))
    clear_session_cookie(response)
    return response


@bp.post("/api/auth/demo")
@limiter.limit(login_rate_limit, key_func=client_key)
def api_demo():
    """Sign in to the shared, public demo account (only when DEMO_LOGIN=1). Reset once a day."""
    if not current_app.config["DEMO_LOGIN"]:
        abort(404, "Unknown API endpoint.")
    db = get_db()
    user = auth.find_user(db, auth.DEMO_EMAIL)
    if user is None:
        try:
            # "!" is not a valid hash, so nobody can sign in to the demo with a password.
            auth.create_user(db, auth.DEMO_EMAIL, "!", "Demo Kitchen", is_demo=True)
        except sqlite3.IntegrityError:
            db.rollback()
        user = auth.find_user(db, auth.DEMO_EMAIL)
    today = auth.utcnow().date().isoformat()
    if database.get_meta(db, "demo_reset_day") != today:
        auth.reset_user_data(db, user["id"])
        database.set_meta(db, "demo_reset_day", today)
    return start_session(db, user["id"], remember=False)


# --------------------------------------------------------------------------
# Recipes
# --------------------------------------------------------------------------

@bp.get("/api/recipes")
def api_recipes():
    category = request.args.get("category") or None
    if category is not None and category not in ingredients.CATEGORIES:
        abort(400, "Category must be Breakfast, Lunch, Dinner or Dessert.")
    return jsonify(recipes=database.list_recipes(get_db(), current_user_id(), category), category=category)


def recipe_input() -> tuple[dict, dict]:
    """Validated recipe fields from the JSON body (shared by create and update)."""
    body = json_body()
    text = body.get("ingredients")
    if isinstance(text, list):
        if not all(isinstance(line, str) for line in text):
            abort(400, "Ingredients must be text, one per line.")
        text = "\n".join(text)
    elif text is not None and not isinstance(text, str):
        abort(400, "Ingredients must be text, one per line.")
    return database.validate_recipe(body.get("title"), body.get("prep_time"), body.get("category"), text)


@bp.post("/api/recipes")
def api_create_recipe():
    data, errors = recipe_input()
    if errors:
        return jsonify(error="Please fix the highlighted fields.", fields=errors), 400
    db = get_db()
    recipe_id = database.create_recipe(db, current_user_id(), data)
    database.log_event(db, current_user_id(), "recipe_saved", {
        "recipe_id": recipe_id, "title": data["title"], "category": data["category"],
        "ingredient_count": len(data["ingredients"]),
    })
    db.commit()
    return jsonify(recipe=database.get_recipe(db, current_user_id(), recipe_id)), 201


@bp.get("/api/recipes/<int:recipe_id>")
def api_recipe(recipe_id: int):
    return jsonify(recipe=recipe_or_404(recipe_id))


@bp.put("/api/recipes/<int:recipe_id>")
def api_update_recipe(recipe_id: int):
    recipe_or_404(recipe_id)
    data, errors = recipe_input()
    if errors:
        return jsonify(error="Please fix the highlighted fields.", fields=errors), 400
    db = get_db()
    database.update_recipe(db, current_user_id(), recipe_id, data)
    database.log_event(db, current_user_id(), "recipe_updated", {
        "recipe_id": recipe_id, "title": data["title"], "category": data["category"],
        "ingredient_count": len(data["ingredients"]),
    })
    db.commit()
    return jsonify(recipe=database.get_recipe(db, current_user_id(), recipe_id))


@bp.get("/api/recipes/<int:recipe_id>/list-impact")
def api_recipe_list_impact(recipe_id: int):
    """How many list items deleting this recipe would remove or reduce (for the confirmation)."""
    recipe = recipe_or_404(recipe_id)
    return jsonify(shopping.remove_recipe_items(get_db(), current_user_id(), recipe, apply=False))


@bp.delete("/api/recipes/<int:recipe_id>")
def api_delete_recipe(recipe_id: int):
    """Delete a recipe and take its ingredients back off the list, in one transaction.

    Its meal_plan entries go too (ON DELETE CASCADE). Either everything happens or nothing does.
    """
    db = get_db()
    uid = current_user_id()
    if db.in_transaction:
        db.commit()
    db.execute("BEGIN IMMEDIATE")  # take the write lock before reading, so nothing changes underneath
    try:
        recipe = database.get_recipe(db, uid, recipe_id)
        if recipe is None:
            db.rollback()
            abort(404, "That recipe doesn't exist (it may have been deleted).")
        result = shopping.remove_recipe_items(db, uid, recipe)
        if not database.delete_recipe(db, uid, recipe_id):
            raise RuntimeError("recipe vanished during delete")
        database.log_event(db, uid, "recipe_deleted", {
            "recipe_id": recipe_id, "list_removed": result["removed"], "list_reduced": result["reduced"],
        })
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise
    return jsonify(deleted=recipe_id, list_removed=result["removed"], list_reduced=result["reduced"],
                   counts=list_counts(db))


@bp.get("/api/recipes/<int:recipe_id>/scaled")
def api_scaled(recipe_id: int):
    multiplier = parse_multiplier(request.args.get("x", "1"))
    recipe = recipe_or_404(recipe_id)
    return jsonify(multiplier=multiplier, lines=[ingredients.scale_line(line, multiplier) for line in recipe["lines"]])


@bp.post("/api/recipes/<int:recipe_id>/add-to-list")
def api_add_recipe(recipe_id: int):
    multiplier = parse_multiplier(json_body().get("multiplier", 1))
    recipe = recipe_or_404(recipe_id)
    db = get_db()
    stats = shopping.add_recipe(db, current_user_id(), recipe, multiplier)
    db.commit()
    return jsonify(**stats, multiplier=multiplier, counts=list_counts(db))


# --------------------------------------------------------------------------
# Shopping list
# --------------------------------------------------------------------------

@bp.get("/api/list")
def api_list():
    return jsonify(list_payload(get_db()))


@bp.post("/api/list/items")
def api_add_item():
    line = json_body().get("line")
    if not isinstance(line, str) or not line.strip():
        abort(400, "Type an item to add, e.g. “2 lemons”.")
    if len(line.strip()) > ingredients.MAX_LINE_LENGTH:
        abort(400, f"Keep items under {ingredients.MAX_LINE_LENGTH} characters.")
    db = get_db()
    stats = shopping.add_lines(db, current_user_id(), [ingredients.normalize_line(line)], source="Added by hand")
    if not stats["added"] and not stats["merged"]:
        abort(400, "That doesn't look like an item name.")
    db.commit()
    return jsonify(**stats, counts=list_counts(db)), 201


@bp.post("/api/list/<int:item_id>/check")
def api_check(item_id: int):
    """Set (not toggle) an item's checked state, so replaying queued offline changes is safe."""
    checked = json_body().get("checked")
    if not isinstance(checked, bool):
        abort(400, "“checked” must be true or false.")
    db = get_db()
    result = shopping.set_checked(db, current_user_id(), item_id, checked)
    if result is None:
        abort(404, "That item is no longer on the list.")
    db.commit()
    return jsonify(**result, counts=list_counts(db))


@bp.post("/api/list/<int:item_id>/amount")
def api_set_amount(item_id: int):
    amount = json_body().get("amount")
    if not isinstance(amount, str):
        abort(400, "“amount” must be text, e.g. “1” or “2 cups”.")
    if len(amount.strip()) > ingredients.MAX_LINE_LENGTH:
        abort(400, f"Keep amounts under {ingredients.MAX_LINE_LENGTH} characters.")
    db = get_db()
    try:
        item = shopping.set_amount(db, current_user_id(), item_id, amount)
    except shopping.AmountError as exc:
        abort(400, str(exc))
    if item is None:
        abort(404, "That item is no longer on the list.")
    db.commit()
    return jsonify(item=item, counts=list_counts(db))


@bp.delete("/api/list/<int:item_id>")
def api_remove_item(item_id: int):
    db = get_db()
    if not shopping.remove(db, current_user_id(), item_id):
        abort(404, "That item is no longer on the list.")
    db.commit()
    return jsonify(removed=item_id, counts=list_counts(db))


@bp.post("/api/list/clear")
def api_clear():
    scope = json_body().get("scope", "all")
    if scope not in ("all", "checked"):
        abort(400, "Scope must be “all” or “checked”.")
    db = get_db()
    removed = shopping.clear(db, current_user_id(), only_checked=scope == "checked")
    db.commit()
    return jsonify(removed=removed, scope=scope, counts=list_counts(db))


# --------------------------------------------------------------------------
# Meal planner
# --------------------------------------------------------------------------

@bp.get("/api/planner")
def api_planner():
    return jsonify(plan_payload(get_db()))


@bp.post("/api/planner")
def api_planner_add():
    body = json_body()
    day = body.get("day")
    if day not in database.DAYS:
        abort(400, "Pick a day of the week.")
    recipe_id = parse_id(body.get("recipe_id"), "recipe_id")
    multiplier = parse_multiplier(body.get("multiplier", 1))
    db = get_db()
    entry_id = database.add_to_plan(db, current_user_id(), day, recipe_id, multiplier)
    if entry_id is None:
        abort(404, "That recipe doesn't exist (it may have been deleted).")
    db.commit()
    return jsonify(entry_id=entry_id, **plan_payload(db)), 201


@bp.delete("/api/planner/<int:entry_id>")
def api_planner_remove(entry_id: int):
    db = get_db()
    if not database.remove_from_plan(db, current_user_id(), entry_id):
        abort(404, "That meal is no longer in the plan.")
    db.commit()
    return jsonify(plan_payload(db))


@bp.post("/api/planner/clear")
def api_planner_clear():
    db = get_db()
    removed = database.clear_plan(db, current_user_id())
    db.commit()
    return jsonify(removed=removed, **plan_payload(db))


@bp.post("/api/planner/build")
def api_planner_build():
    db = get_db()
    uid = current_user_id()
    entries = [entry for day in database.list_plan(db, uid).values() for entry in day]
    if not entries:
        abort(400, "Plan some meals first, then build the list.")
    added = merged = 0
    for entry in entries:
        recipe = database.get_recipe(db, uid, entry["recipe_id"])
        stats = shopping.add_recipe(db, uid, recipe, entry["multiplier"], via="planner")
        added, merged = added + stats["added"], merged + stats["merged"]
    db.commit()
    return jsonify(meals=len(entries), added=added, merged=merged, counts=list_counts(db))


# --------------------------------------------------------------------------
# Insights
# --------------------------------------------------------------------------

@bp.get("/api/insights")
def api_insights():
    db = get_db()
    return jsonify(
        **database.insights(db, current_user_id()),
        ai_calls=database.ai_calls_today(db, current_user_id()),
        ai_cap=current_app.config["AI_USER_DAILY_CAP"],
        looker_url=looker_url(),
    )


# --------------------------------------------------------------------------
# Gemini features, each with a non-AI fallback
# --------------------------------------------------------------------------

NO_RECIPE_FOUND = (
    "We couldn't find a recipe in that. Try a clearer photo, or paste the title and one ingredient per line."
)

# What to tell the user when Gemini fails on a photo, by AIError.kind: (HTTP status, message).
PHOTO_ERRORS = {
    "config": (503, "The AI service isn't set up correctly right now, so photos can't be read. "
                    "Paste the recipe as text instead."),
    "rate_limit": (429, "The AI service is busy or its quota is used up. Wait a minute and try again, "
                        "or paste the recipe as text."),
    "timeout": (504, "The AI service took too long to read that photo. Try again, or use a smaller photo."),
    "unreadable": (422, "We couldn't read a recipe in that photo. Try a clearer, well-lit photo, "
                        "or paste the recipe as text."),
    "error": (502, "Something went wrong while reading that photo. Please try again, or paste the recipe as text."),
}


@bp.post("/api/import")
@limiter.limit(ai_rate_limit, key_func=user_key)
@ai_global_limit
def api_import():
    """Snap-a-recipe: extract a recipe from a photo and/or pasted text to pre-fill the form.

    Nothing is saved here, and the uploaded image is only held in memory for this request.
    """
    db = get_db()
    config = current_app.config
    upload = request.files.get("image")
    image = mime_type = None
    if upload and upload.filename:
        image = upload.read(gcp.MAX_IMAGE_BYTES + 1)
        if len(image) > gcp.MAX_IMAGE_BYTES:
            abort(413, "Photos must be 5 MB or smaller.")
        if not image:
            abort(400, "That file is empty.")
        mime_type = gcp.detect_image_type(image)
        if mime_type is None:
            abort(415, "Use a JPEG, PNG or WebP image.")
    text = (request.form.get("text") or "").strip()
    if len(text) > gcp.MAX_TEXT_CHARS:
        abort(413, f"Keep pasted text under {gcp.MAX_TEXT_CHARS:,} characters.")
    if image is None and not text:
        abort(400, "Choose a photo or paste some recipe text.")

    result, source = None, "fallback"
    if gcp.ai_enabled(config):
        if over := consume_ai(db, "import"):
            return jsonify(error=f"{over}. Try again tomorrow, or type the recipe into the form."), 429
        try:
            result, source = gcp.ai_import_recipe(config, text=text, image=image, mime_type=mime_type), "gemini"
        except gcp.AIError as exc:
            if not text:
                status, message = PHOTO_ERRORS.get(exc.kind, PHOTO_ERRORS["error"])
                return jsonify(error=message), status
    if result is None:
        if not text:
            return jsonify(error="Photo import needs the AI service, which isn't available right now. "
                                 "Paste the recipe as text instead and we'll fill the form."), 503
        result = ingredients.parse_recipe_text(text)
    if not result["title"] or not result["ingredients"]:
        return jsonify(error=NO_RECIPE_FOUND), 422

    database.log_event(db, current_user_id(), "ai_import", {
        "source": source, "kind": "image" if image is not None else "text",
        "ingredients": len(result["ingredients"]),
    })
    db.commit()
    message = ("Imported with AI, please review before saving." if source == "gemini"
               else "Filled in with the basic text parser (AI isn't available), please review before saving.")
    return jsonify(recipe=result, source=source, message=message)


@bp.post("/api/recipes/<int:recipe_id>/nutrition")
@limiter.limit(ai_rate_limit, key_func=user_key)
@ai_global_limit
def api_nutrition(recipe_id: int):
    recipe = recipe_or_404(recipe_id)
    db = get_db()
    allowed, message = ai_allowed(db, "nutrition")
    nutrition, tags, source = None, ingredients.keyword_diet_tags(recipe["lines"]), "basic"
    if allowed:
        try:
            nutrition, tags = gcp.ai_nutrition(current_app.config, recipe["title"], recipe["lines"])
            source = "ai"
            database.save_nutrition(db, current_user_id(), recipe_id, nutrition, tags)
            db.commit()
        except gcp.AIError:
            message = "Gemini didn't answer."
    if source == "basic":
        message = f"{message} Showing keyword-based diet tags only; nutrition estimates need Gemini."
    return jsonify(
        nutrition=nutrition,
        diet_tags=tags,
        source=source,
        message=message or "Estimated by Gemini. Treat these numbers as a rough guide.",
    )


@bp.post("/api/substitute")
@limiter.limit(ai_rate_limit, key_func=user_key)
@ai_global_limit
def api_substitute():
    body = json_body()
    raw = body.get("ingredient")
    ingredient = gcp.clean_text(raw, ingredients.MAX_LINE_LENGTH) if isinstance(raw, str) else ""
    if not ingredient:
        abort(400, "Tell us which ingredient to swap.")
    title = None
    if body.get("recipe_id") is not None:
        title = recipe_or_404(parse_id(body["recipe_id"], "recipe_id"))["title"]

    allowed, message = ai_allowed(get_db(), "substitute")
    substitutes, source = None, "basic"
    if allowed:
        try:
            substitutes, source = gcp.ai_substitutes(current_app.config, ingredient, title), "ai"
        except gcp.AIError:
            message = "Gemini didn't answer, so these come from CartChef's built-in list."
    if substitutes is None:
        substitutes = ingredients.basic_substitutes(ingredient)
        if not substitutes:
            message = "No built-in swap for this one. Gemini can suggest more when it's configured."
    return jsonify(ingredient=ingredient, substitutes=substitutes, source=source, message=message)


# What to tell the user when a chat turn fails, by AIError.kind: (HTTP status, message).
CHAT_ERRORS = {
    "config": (503, "The AI chef isn't set up correctly right now. Please try again later."),
    "rate_limit": (429, "The AI service is busy or its quota is used up. Wait a minute and try again."),
    "timeout": (504, "The AI chef took too long to answer. Please try again."),
    "unreadable": (422, "The AI chef couldn't answer that. Try rephrasing your question."),
    "error": (502, "Something went wrong while asking the chef. Please try again."),
}


def chat_fallback(message: str) -> str:
    """Reply used when Gemini is off: built-in swaps if the message names a known ingredient."""
    swaps = ingredients.substitutes_mentioned(message)
    if not swaps:
        return ("The AI chef isn't available right now. You can still scale recipes, build your list "
                "and use the Swap buttons on a recipe page for built-in substitutions.")
    lines = ["The AI chef isn't available right now, but here are some built-in swaps:"]
    for name, options in swaps:
        lines.append(f"{name.capitalize()}: " + "; ".join(f"{o['swap']} ({o['note'].rstrip('.')})" for o in options))
    lines.append("Check ingredient labels if you're cooking for allergies.")
    return "\n".join(lines)


@bp.post("/api/chat")
@limiter.limit(chat_rate_limit, key_func=user_key)
@ai_global_limit
def api_chat():
    """Ask the chef. Stateless: the client sends recent history; the recipe is loaded here."""
    body = json_body()
    raw = body.get("message")
    if not isinstance(raw, str) or not raw.strip():
        abort(400, "Type a question for the chef.")
    if len(raw.strip()) > gcp.CHAT_MAX_MESSAGE:
        abort(400, f"Keep messages under {gcp.CHAT_MAX_MESSAGE} characters.")
    message = gcp.clean_multiline(raw, gcp.CHAT_MAX_MESSAGE)
    recipe = None
    if body.get("recipe_id") is not None:
        recipe = recipe_or_404(parse_id(body["recipe_id"], "recipe_id"))
    history = gcp.clean_history(body.get("history"))

    db = get_db()
    config = current_app.config
    if not gcp.ai_enabled(config):
        result = {"reply": chat_fallback(message), "proposal": None, "shopping_items": []}
        source = "fallback"
    else:
        if over := consume_ai(db, "chat"):
            return jsonify(error=f"{over}. The chef will be back tomorrow."), 429
        try:
            result = gcp.ai_chat(config, message, history, recipe)
        except gcp.AIError as exc:
            status, error = CHAT_ERRORS.get(exc.kind, CHAT_ERRORS["error"])
            return jsonify(error=error), status
        source = "gemini"
    # Never log message text: only what kind of turn it was.
    database.log_event(db, current_user_id(), "ai_chat", {
        "mode": "recipe" if recipe else "general", "source": source,
        "proposal": result["proposal"] is not None, "shopping_items": len(result["shopping_items"]),
    })
    db.commit()
    return jsonify(**result, source=source)


# --------------------------------------------------------------------------
# React app (production build)
# --------------------------------------------------------------------------

@bp.get("/", defaults={"path": ""})
@bp.get("/<path:path>")
def frontend(path: str):
    if path.startswith("api/"):
        abort(404, "Unknown API endpoint.")
    dist = current_app.config["FRONTEND_DIST"]
    if path and os.path.isfile(os.path.join(dist, path)):
        response = send_from_directory(dist, path)
        if path.startswith("assets/"):
            # Vite fingerprints everything in assets/, so it can be cached forever.
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            # index.html, sw.js, the manifest and icons must revalidate so a redeploy is picked up.
            response.headers["Cache-Control"] = "no-cache"
        return response
    if "." in path.rsplit("/", 1)[-1]:
        abort(404, "File not found.")
    if not os.path.isfile(os.path.join(dist, "index.html")):
        abort(503, "The frontend isn't built yet. Run `npm run build` in frontend/ or use the Vite dev server.")
    response = send_from_directory(dist, "index.html")
    response.headers["Cache-Control"] = "no-cache"
    return response

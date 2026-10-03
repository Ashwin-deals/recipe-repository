"""CartChef: Recipe Box & Shopping List Maker.

Flask is a JSON API under /api/*. In production it also serves the built React
app (frontend/dist), returning index.html for any other path so client-side
routes such as /planner survive a refresh.
"""
from __future__ import annotations

import hmac
import logging
import os
import secrets
import sqlite3
from datetime import timedelta
from urllib.parse import urlparse

from flask import (
    Blueprint, Flask, abort, current_app, g, jsonify, request, send_from_directory, session,
)
from dotenv import load_dotenv
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

import database
import gcp
import ingredients
import shopping

log = logging.getLogger("cartchef")
bp = Blueprint("main", __name__)
limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
FRIENDLY_ERRORS = {
    400: "That request didn't look right.",
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
        "SECRET_KEY": _env("SECRET_KEY"),
        "SEED_DEMO_DATA": _env_bool("SEED_DEMO_DATA", True),
        "TRUST_PROXY_HOPS": _env_int("TRUST_PROXY_HOPS", 0),
        "LOG_LEVEL": _env("LOG_LEVEL", "INFO").upper(),
        "AI_ENABLED": _env_bool("AI_ENABLED", True),
        "GEMINI_API_KEY": _env("GEMINI_API_KEY"),
        "GEMINI_MODEL": _env("GEMINI_MODEL"),
        "GOOGLE_CLOUD_PROJECT": _env("GOOGLE_CLOUD_PROJECT"),
        "GOOGLE_CLOUD_LOCATION": _env("GOOGLE_CLOUD_LOCATION", "global"),
        "AI_DAILY_CAP": _env_int("AI_DAILY_CAP", 300),
        "AI_RATE_LIMIT": _env("AI_RATE_LIMIT", "10/minute"),
        "AI_TIMEOUT_SECONDS": _env_int("AI_TIMEOUT_SECONDS", 30),
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
    log.info("Gemini mode: %s", gcp.ai_mode(app.config))

    for key in ("DATABASE_PATH", "FRONTEND_DIST"):
        if not os.path.isabs(app.config[key]):
            app.config[key] = os.path.join(app.root_path, app.config[key])
    path = app.config["DATABASE_PATH"]
    gcp.restore_db(app.config, path)
    database.init_db(path, seed=app.config["SEED_DEMO_DATA"])

    hops = app.config["TRUST_PROXY_HOPS"]
    app.config.update(
        SECRET_KEY=app.config["SECRET_KEY"] or database.get_or_create_secret_key(path),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=hops > 0,
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        # Room for a 5 MB photo plus form overhead; the photo itself is checked separately.
        MAX_CONTENT_LENGTH=gcp.MAX_IMAGE_BYTES + 256 * 1024,
    )
    if hops > 0:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops)

    limiter.init_app(app)
    app.register_blueprint(bp)
    app.register_error_handler(HTTPException, handle_http_error)
    app.register_error_handler(Exception, handle_unexpected_error)
    app.teardown_appcontext(close_db)
    return app


# --------------------------------------------------------------------------
# Request plumbing: DB connection, CSRF, headers, backups, errors
# --------------------------------------------------------------------------

def get_db() -> database.Connection:
    if "db" not in g:
        config = current_app.config
        g.db = database.connect(config["DATABASE_PATH"])
        g.db.on_commit = lambda events: gcp.mirror_events(config, events)
    return g.db


def close_db(_exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def csrf_token() -> str:
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
        session.permanent = True
    return session["csrf_token"]


@bp.before_app_request
def check_csrf():
    if request.method not in WRITE_METHODS or not current_app.config["CSRF_ENABLED"]:
        return
    expected = session.get("csrf_token")
    sent = request.headers.get("X-CSRF-Token")
    if not expected or not sent or not hmac.compare_digest(expected, sent):
        abort(403, "Your session expired. Reload the page and try again.")


@bp.after_app_request
def finish_response(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; "
        "form-action 'self'",
    )
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
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
    recipe = database.get_recipe(get_db(), recipe_id)
    if recipe is None:
        abort(404, "That recipe doesn't exist (it may have been deleted).")
    return recipe


def list_payload(db) -> dict:
    return {"groups": shopping.grouped_items(db), "counts": shopping.counts(db)}


def plan_payload(db) -> dict:
    return {"plan": database.list_plan(db), "days": list(database.DAYS)}


def looker_url() -> str | None:
    url = current_app.config.get("LOOKER_STUDIO_URL")
    return url if url and urlparse(url).scheme == "https" else None


def ai_rate_limit() -> str:
    return current_app.config["AI_RATE_LIMIT"]


def ai_allowed(db, feature: str) -> tuple[bool, str | None]:
    """Whether a Gemini call may be made now, and why not if it can't."""
    config = current_app.config
    if not gcp.ai_enabled(config):
        return False, "Gemini isn't configured, so CartChef used its built-in fallback."
    if not database.consume_ai_call(db, config["AI_DAILY_CAP"], feature=feature):
        return False, "Today's AI limit has been reached, so CartChef used its built-in fallback."
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
        ai_enabled=gcp.ai_enabled(current_app.config),
        categories=list(ingredients.CATEGORIES),
        days=list(database.DAYS),
        multipliers=list(database.MULTIPLIERS),
        max_image_bytes=gcp.MAX_IMAGE_BYTES,
    )


# --------------------------------------------------------------------------
# Recipes
# --------------------------------------------------------------------------

@bp.get("/api/recipes")
def api_recipes():
    category = request.args.get("category") or None
    if category is not None and category not in ingredients.CATEGORIES:
        abort(400, "Category must be Breakfast, Lunch, Dinner or Dessert.")
    return jsonify(recipes=database.list_recipes(get_db(), category), category=category)


@bp.post("/api/recipes")
def api_create_recipe():
    body = json_body()
    text = body.get("ingredients")
    if isinstance(text, list):
        if not all(isinstance(line, str) for line in text):
            abort(400, "Ingredients must be text, one per line.")
        text = "\n".join(text)
    elif text is not None and not isinstance(text, str):
        abort(400, "Ingredients must be text, one per line.")
    data, errors = database.validate_recipe(body.get("title"), body.get("prep_time"), body.get("category"), text)
    if errors:
        return jsonify(error="Please fix the highlighted fields.", fields=errors), 400
    db = get_db()
    recipe_id = database.create_recipe(db, data)
    database.log_event(db, "recipe_saved", {
        "recipe_id": recipe_id, "title": data["title"], "category": data["category"],
        "ingredient_count": len(data["ingredients"]),
    })
    db.commit()
    return jsonify(recipe=database.get_recipe(db, recipe_id)), 201


@bp.get("/api/recipes/<int:recipe_id>")
def api_recipe(recipe_id: int):
    return jsonify(recipe=recipe_or_404(recipe_id))


@bp.delete("/api/recipes/<int:recipe_id>")
def api_delete_recipe(recipe_id: int):
    recipe_or_404(recipe_id)
    db = get_db()
    database.delete_recipe(db, recipe_id)
    db.commit()
    return jsonify(deleted=recipe_id)


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
    stats = shopping.add_recipe(db, recipe, multiplier)
    db.commit()
    return jsonify(**stats, multiplier=multiplier, counts=shopping.counts(db))


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
    stats = shopping.add_lines(db, [ingredients.normalize_line(line)], source="Added by hand")
    if not stats["added"] and not stats["merged"]:
        abort(400, "That doesn't look like an item name.")
    db.commit()
    return jsonify(**stats, counts=shopping.counts(db)), 201


@bp.post("/api/list/<int:item_id>/check")
def api_check(item_id: int):
    """Set (not toggle) an item's checked state, so replaying queued offline changes is safe."""
    checked = json_body().get("checked")
    if not isinstance(checked, bool):
        abort(400, "“checked” must be true or false.")
    db = get_db()
    result = shopping.set_checked(db, item_id, checked)
    if result is None:
        abort(404, "That item is no longer on the list.")
    db.commit()
    return jsonify(**result, counts=shopping.counts(db))


@bp.post("/api/list/clear")
def api_clear():
    scope = json_body().get("scope", "all")
    if scope not in ("all", "checked"):
        abort(400, "Scope must be “all” or “checked”.")
    db = get_db()
    removed = shopping.clear(db, only_checked=scope == "checked")
    db.commit()
    return jsonify(removed=removed, scope=scope, counts=shopping.counts(db))


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
    if database.get_recipe(db, recipe_id) is None:
        abort(400, "That recipe doesn't exist.")
    entry_id = database.add_to_plan(db, day, recipe_id, multiplier)
    db.commit()
    return jsonify(entry_id=entry_id, **plan_payload(db)), 201


@bp.delete("/api/planner/<int:entry_id>")
def api_planner_remove(entry_id: int):
    db = get_db()
    if not database.remove_from_plan(db, entry_id):
        abort(404, "That meal is no longer in the plan.")
    db.commit()
    return jsonify(plan_payload(db))


@bp.post("/api/planner/clear")
def api_planner_clear():
    db = get_db()
    removed = database.clear_plan(db)
    db.commit()
    return jsonify(removed=removed, **plan_payload(db))


@bp.post("/api/planner/build")
def api_planner_build():
    db = get_db()
    entries = [entry for day in database.list_plan(db).values() for entry in day]
    if not entries:
        abort(400, "Plan some meals first, then build the list.")
    added = merged = 0
    for entry in entries:
        stats = shopping.add_recipe(db, database.get_recipe(db, entry["recipe_id"]), entry["multiplier"], via="planner")
        added, merged = added + stats["added"], merged + stats["merged"]
    db.commit()
    return jsonify(meals=len(entries), added=added, merged=merged, counts=shopping.counts(db))


# --------------------------------------------------------------------------
# Insights
# --------------------------------------------------------------------------

@bp.get("/api/insights")
def api_insights():
    db = get_db()
    return jsonify(
        **database.insights(db),
        ai_calls=database.ai_calls_today(db),
        ai_cap=current_app.config["AI_DAILY_CAP"],
        looker_url=looker_url(),
    )


# --------------------------------------------------------------------------
# Gemini features, each with a non-AI fallback
# --------------------------------------------------------------------------

NO_RECIPE_FOUND = (
    "We couldn't find a recipe in that. Try a clearer photo, or paste the title and one ingredient per line."
)


@bp.post("/api/import")
@limiter.limit(ai_rate_limit)
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
        if not database.consume_ai_call(db, config["AI_DAILY_CAP"], feature="import"):
            return jsonify(error="Today's AI import limit has been reached. Try again tomorrow, "
                                 "or type the recipe into the form."), 429
        try:
            result, source = gcp.ai_import_recipe(config, text=text, image=image, mime_type=mime_type), "gemini"
        except gcp.AIError:
            if not text:
                return jsonify(error="Gemini couldn't read that photo right now. Try again, or paste the recipe as text."), 502
    if result is None:
        if not text:
            return jsonify(error="Photo import needs the AI service, which isn't available right now. "
                                 "Paste the recipe as text instead and we'll fill the form."), 503
        result = ingredients.parse_recipe_text(text)
    if not result["title"] or not result["ingredients"]:
        return jsonify(error=NO_RECIPE_FOUND), 422

    database.log_event(db, "ai_import", {
        "source": source, "kind": "image" if image is not None else "text",
        "ingredients": len(result["ingredients"]),
    })
    db.commit()
    message = ("Imported with AI, please review before saving." if source == "gemini"
               else "Filled in with the basic text parser (AI isn't available), please review before saving.")
    return jsonify(recipe=result, source=source, message=message)


@bp.post("/api/recipes/<int:recipe_id>/nutrition")
@limiter.limit(ai_rate_limit)
def api_nutrition(recipe_id: int):
    recipe = recipe_or_404(recipe_id)
    db = get_db()
    allowed, message = ai_allowed(db, "nutrition")
    nutrition, tags, source = None, ingredients.keyword_diet_tags(recipe["lines"]), "basic"
    if allowed:
        try:
            nutrition, tags = gcp.ai_nutrition(current_app.config, recipe["title"], recipe["lines"])
            source = "ai"
            database.save_nutrition(db, recipe_id, nutrition, tags)
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
@limiter.limit(ai_rate_limit)
def api_substitute():
    body = json_body()
    raw = body.get("ingredient")
    ingredient = gcp.clean_text(raw, ingredients.MAX_LINE_LENGTH) if isinstance(raw, str) else ""
    if not ingredient:
        abort(400, "Tell us which ingredient to swap.")
    title = None
    if body.get("recipe_id") is not None:
        recipe = database.get_recipe(get_db(), parse_id(body["recipe_id"], "recipe_id"))
        title = recipe["title"] if recipe else None

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

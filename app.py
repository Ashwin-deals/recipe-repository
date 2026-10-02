"""CartChef: Recipe Box & Shopping List Maker. Flask app factory, pages and JSON API."""
from __future__ import annotations

import hmac
import logging
import os
import secrets
import sqlite3
from datetime import timedelta
from urllib.parse import urlparse

from flask import (
    Blueprint, Flask, abort, current_app, flash, g, jsonify, redirect, render_template,
    request, send_from_directory, session, url_for,
)
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


def load_config() -> dict:
    """Read every setting from the environment. Cloud features stay off unless configured."""
    return {
        "DATABASE_PATH": _env("DATABASE_PATH", "instance/cartchef.db"),
        "SECRET_KEY": _env("SECRET_KEY"),
        "SEED_DEMO_DATA": _env("SEED_DEMO_DATA", "1").lower() in ("1", "true", "yes", "on"),
        "TRUST_PROXY_HOPS": _env_int("TRUST_PROXY_HOPS", 0),
        "LOG_LEVEL": _env("LOG_LEVEL", "INFO").upper(),
        "GOOGLE_CLOUD_PROJECT": _env("GOOGLE_CLOUD_PROJECT"),
        "GOOGLE_CLOUD_LOCATION": _env("GOOGLE_CLOUD_LOCATION"),
        "GEMINI_MODEL": _env("GEMINI_MODEL"),
        "AI_DAILY_CAP": _env_int("AI_DAILY_CAP", 300),
        "AI_RATE_LIMIT": _env("AI_RATE_LIMIT", "10/minute"),
        "AI_TIMEOUT_SECONDS": _env_int("AI_TIMEOUT_SECONDS", 30),
        "GCS_BUCKET": _env("GCS_BUCKET"),
        "GCS_DB_OBJECT": _env("GCS_DB_OBJECT", "cartchef.db"),
        "BIGQUERY_DATASET": _env("BIGQUERY_DATASET"),
        "BIGQUERY_TABLE": _env("BIGQUERY_TABLE", "events"),
        "LOOKER_STUDIO_URL": _env("LOOKER_STUDIO_URL"),
        "CSRF_ENABLED": True,
    }


def create_app(overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(load_config())
    app.config.update(overrides or {})
    logging.basicConfig(level=app.config["LOG_LEVEL"], format="%(levelname)s %(name)s: %(message)s")

    path = app.config["DATABASE_PATH"]
    if not os.path.isabs(path):
        path = app.config["DATABASE_PATH"] = os.path.join(app.root_path, path)
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
    sent = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
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
        gcp.backup_db(config, config["DATABASE_PATH"])
    return response


def _wants_json() -> bool:
    return request.path.startswith("/api/")


def handle_http_error(error: HTTPException):
    # Use our own message from abort(code, "...") if given, else a friendly default.
    custom = error.description != type(error).description and error.code != 429
    message = error.description if custom else FRIENDLY_ERRORS.get(error.code, error.name)
    if _wants_json():
        return jsonify(error=message), error.code
    return render_template("error.html", code=error.code, message=message), error.code


def handle_unexpected_error(error: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.path)
    if _wants_json():
        return jsonify(error=FRIENDLY_ERRORS[500]), 500
    return render_template("error.html", code=500, message=FRIENDLY_ERRORS[500]), 500


@bp.app_context_processor
def template_globals():
    try:
        open_items = shopping.counts(get_db())["open"]
    except sqlite3.Error:
        open_items = None
    return {
        "csrf_token": csrf_token,
        "open_items": open_items,
        "ai_enabled": gcp.ai_enabled(current_app.config),
        "categories": ingredients.CATEGORIES,
    }


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


def recipe_or_404(recipe_id: int) -> dict:
    recipe = database.get_recipe(get_db(), recipe_id)
    if recipe is None:
        abort(404, "That recipe doesn't exist (it may have been deleted).")
    return recipe


def ai_rate_limit() -> str:
    return current_app.config["AI_RATE_LIMIT"]


def ai_allowed(db) -> tuple[bool, str | None]:
    """Whether a Gemini call may be made now, and why not if it can't."""
    config = current_app.config
    if not gcp.ai_enabled(config):
        return False, "Gemini isn't configured, so CartChef used its built-in fallback."
    if not database.consume_ai_call(db, config["AI_DAILY_CAP"]):
        return False, "Today's AI limit has been reached, so CartChef used its built-in fallback."
    return True, None


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------

@bp.get("/")
def index():
    category = request.args.get("category")
    if category not in ingredients.CATEGORIES:
        category = None
    db = get_db()
    return render_template(
        "index.html",
        recipes=database.list_recipes(db, category),
        category=category,
        groups=shopping.grouped_items(db),
        counts=shopping.counts(db),
        multipliers=database.MULTIPLIERS,
    )


@bp.get("/recipes/new")
def new_recipe():
    return render_template("recipe_form.html", form={}, errors={})


@bp.post("/recipes")
def create_recipe():
    form = request.form
    data, errors = database.validate_recipe(
        form.get("title"), form.get("prep_time"), form.get("category"), form.get("ingredients")
    )
    if errors:
        return render_template("recipe_form.html", form=form, errors=errors), 400
    db = get_db()
    recipe_id = database.create_recipe(db, data)
    database.log_event(db, "recipe_saved", {
        "recipe_id": recipe_id, "title": data["title"], "category": data["category"],
        "ingredient_count": len(data["ingredients"]),
    })
    db.commit()
    flash(f"Saved “{data['title']}”.")
    return redirect(url_for("main.index", _anchor=f"recipe-{recipe_id}"))


@bp.get("/recipes/<int:recipe_id>")
def recipe_detail(recipe_id: int):
    return render_template("recipe.html", recipe=recipe_or_404(recipe_id), multipliers=database.MULTIPLIERS)


@bp.post("/recipes/<int:recipe_id>/delete")
def delete_recipe(recipe_id: int):
    recipe = recipe_or_404(recipe_id)
    db = get_db()
    database.delete_recipe(db, recipe_id)
    db.commit()
    flash(f"Deleted “{recipe['title']}”.")
    return redirect(url_for("main.index"))


@bp.get("/list")
def shopping_list():
    db = get_db()
    return render_template("list.html", groups=shopping.grouped_items(db), counts=shopping.counts(db))


@bp.get("/list/fragment")
def shopping_list_fragment():
    db = get_db()
    return render_template("_list.html", groups=shopping.grouped_items(db), counts=shopping.counts(db))


def _render_planner(error: str | None = None, status: int = 200):
    db = get_db()
    return render_template(
        "planner.html",
        plan=database.list_plan(db),
        recipes=database.list_recipes(db),
        days=database.DAYS,
        multipliers=database.MULTIPLIERS,
        error=error,
    ), status


@bp.get("/planner")
def planner():
    return _render_planner()


@bp.post("/planner")
def planner_add():
    day = request.form.get("day")
    if day not in database.DAYS:
        return _render_planner("Pick a day of the week.", 400)
    try:
        recipe_id = int(request.form.get("recipe_id", ""))
    except ValueError:
        return _render_planner("Pick a recipe.", 400)
    if str(request.form.get("multiplier", "1")) not in {str(m) for m in database.MULTIPLIERS}:
        return _render_planner("Servings must be 1x, 2x, 3x or 4x.", 400)
    db = get_db()
    if database.get_recipe(db, recipe_id) is None:
        return _render_planner("That recipe doesn't exist.", 400)
    database.add_to_plan(db, day, recipe_id, int(request.form.get("multiplier", "1")))
    db.commit()
    return redirect(url_for("main.planner", _anchor=day.lower()))


@bp.post("/planner/<int:entry_id>/delete")
def planner_remove(entry_id: int):
    db = get_db()
    if not database.remove_from_plan(db, entry_id):
        abort(404, "That meal is no longer in the plan.")
    db.commit()
    return redirect(url_for("main.planner"))


@bp.post("/planner/clear")
def planner_clear():
    db = get_db()
    database.clear_plan(db)
    db.commit()
    flash("Cleared the week.")
    return redirect(url_for("main.planner"))


@bp.post("/planner/build")
def planner_build():
    db = get_db()
    entries = [entry for day in database.list_plan(db).values() for entry in day]
    if not entries:
        flash("Plan some meals first, then build the list.")
        return redirect(url_for("main.planner"))
    added = merged = 0
    for entry in entries:
        stats = shopping.add_recipe(db, database.get_recipe(db, entry["recipe_id"]), entry["multiplier"], via="planner")
        added, merged = added + stats["added"], merged + stats["merged"]
    db.commit()
    flash(f"Added {len(entries)} planned meals: {added} new items, {merged} merged into existing ones.")
    return redirect(url_for("main.shopping_list"))


@bp.get("/insights")
def insights():
    db = get_db()
    config = current_app.config
    looker_url = config.get("LOOKER_STUDIO_URL")
    if looker_url and urlparse(looker_url).scheme != "https":
        looker_url = None
    return render_template(
        "insights.html",
        data=database.insights(db),
        looker_url=looker_url,
        ai_calls=database.ai_calls_today(db),
        ai_cap=config["AI_DAILY_CAP"],
    )


@bp.get("/healthz")
def healthz():
    try:
        get_db().execute("SELECT 1").fetchone()
    except sqlite3.Error:
        return jsonify(status="error"), 503
    return jsonify(status="ok")


@bp.get("/sw.js")
def service_worker():
    response = send_from_directory(current_app.static_folder, "sw.js", mimetype="text/javascript", max_age=0)
    response.headers["Cache-Control"] = "no-cache"
    return response


@bp.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(current_app.static_folder, "manifest.webmanifest",
                               mimetype="application/manifest+json")


# --------------------------------------------------------------------------
# JSON API: scaling and the shopping list
# --------------------------------------------------------------------------

@bp.get("/api/csrf")
def api_csrf():
    return jsonify(token=csrf_token())


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


@bp.get("/api/list")
def api_list():
    db = get_db()
    return jsonify(groups=shopping.grouped_items(db), counts=shopping.counts(db))


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
# JSON API: Gemini features, each with a non-AI fallback
# --------------------------------------------------------------------------

@bp.post("/api/import")
@limiter.limit(ai_rate_limit)
def api_import():
    db = get_db()
    config = current_app.config
    upload = request.files.get("image")

    if upload and upload.filename:
        image = upload.read(gcp.MAX_IMAGE_BYTES + 1)
        if len(image) > gcp.MAX_IMAGE_BYTES:
            abort(413, "Photos must be 5 MB or smaller.")
        if not image:
            abort(400, "That file is empty.")
        mime_type = gcp.detect_image_type(image)
        if mime_type is None:
            abort(415, "Use a JPEG, PNG or WebP image.")
        allowed, reason = ai_allowed(db)
        if not allowed:
            return jsonify(
                error="Photo import needs Gemini, which isn't available right now. "
                      "Paste the recipe as text instead and the basic parser will fill the form.",
                reason=reason,
            ), 503
        try:
            result = gcp.ai_import_recipe(config, image=image, mime_type=mime_type)
        except gcp.AIError:
            return jsonify(error="Gemini couldn't read that photo. Try a clearer shot or paste the text."), 502
        kind, source, message = "image", "ai", None
    else:
        text = (request.form.get("text") or "").strip()
        if not text:
            abort(400, "Paste some recipe text or choose a photo.")
        if len(text) > gcp.MAX_TEXT_CHARS:
            abort(413, f"Keep pasted text under {gcp.MAX_TEXT_CHARS} characters.")
        allowed, message = ai_allowed(db)
        result, source, kind = None, "basic", "text"
        if allowed:
            try:
                result, source = gcp.ai_import_recipe(config, text=text), "ai"
            except gcp.AIError:
                message = "Gemini couldn't read that text, so CartChef used its basic parser."
        if result is None:
            result = ingredients.parse_recipe_text(text)
        if not result["ingredients"]:
            return jsonify(error="Couldn't find any ingredients. Put one per line, e.g. “2 cups flour”."), 422

    database.log_event(db, "ai_import", {"source": source, "kind": kind, "ingredients": len(result["ingredients"])})
    db.commit()
    return jsonify(
        recipe=result,
        source=source,
        message=message or "Filled in by Gemini. Check everything before saving.",
    )


@bp.post("/api/recipes/<int:recipe_id>/nutrition")
@limiter.limit(ai_rate_limit)
def api_nutrition(recipe_id: int):
    recipe = recipe_or_404(recipe_id)
    db = get_db()
    allowed, message = ai_allowed(db)
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
        try:
            recipe = database.get_recipe(get_db(), int(body["recipe_id"]))
        except (TypeError, ValueError):
            abort(400, "recipe_id must be a number.")
        title = recipe["title"] if recipe else None

    allowed, message = ai_allowed(get_db())
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

# CartChef — Recipe Box & Shopping List Maker

> Save your favorite recipes, scale them to any serving size, and turn their ingredients into one consolidated shopping checklist with a single click.

Built for the **Cognizant Hackathon** (GCP track) as **Use Case 4: Recipe Box & Shopping List Maker**.

---

## Status

🚧 **In development.** The application (Flask JSON API + React frontend) is complete and tested locally. Cloud Run deployment and the live demo link come next.

---

## Problem Statement

Build a personal recipe repository where users can save their favorite meals, view ingredients, and click a button to automatically add those ingredients to a consolidated shopping checklist.

### Core requirements

- [x] SQLite database with two tables: `recipes` and `shopping_list`
- [x] Recipe form: title, preparation time, and an ingredients text area (one per line)
- [x] Backend logic that splits the ingredient text by line and inserts the items into the shopping list table
- [x] Dashboard with a side-by-side (or two-page) layout: browse recipes and check off shopping items
- [x] **Servings scaler:** dropdown (e.g. 2x, 4x) that multiplies ingredient quantities
- [x] **Checkable list:** clicking an item strikes it through
- [x] **Category tags:** filter recipes by Breakfast, Dinner or Dessert
- [x] **Clear list button:** wipes the shopping list after a grocery trip

---

## Planned Enhancements

| Feature | Description |
|---|---|
| Snap-a-recipe | Import a recipe from a photo, screenshot or pasted text using Gemini |
| Any-language import | Recipes in other languages are imported and translated into English |
| Smart consolidated list | Duplicate ingredients merge across recipes (1 cup + 2 cups = 3 cups) |
| Aisle grouping | Shopping list grouped by produce, dairy, pantry, etc. |
| Fraction-aware scaler | Correctly handles quantities like "1 1/2 cups" and leaves "salt to taste" unchanged |
| Weekly meal planner | Assign recipes to days and generate one combined list for the week |
| Nutrition and diet tags | Estimated calories/macros and tags such as vegetarian or gluten-free (labelled as estimates) |
| Ingredient substitutions | Ask for alternatives when an ingredient is missing |
| Offline checklist (PWA) | Installable app whose shopping list works with poor signal in the store |
| Insights dashboard | Most-saved recipes, most-bought ingredients and category trends |

AI features will fall back to a basic non-AI behaviour if Gemini is unavailable.

---

## Tech Stack

**Application**

- Backend: Python 3.12, Flask (JSON API), SQLite, Gunicorn, Flask-Limiter
- Frontend: React 18, TypeScript (strict), Vite, React Router, plain CSS
- PWA: vite-plugin-pwa (Workbox service worker, web manifest, offline queue)
- Tests: pytest (backend), Vitest + React Testing Library (frontend); ESLint

**Google Cloud Platform**

| Service | Purpose |
|---|---|
| Cloud Run | Hosts the live application |
| Cloud Build | Builds the container image |
| Artifact Registry | Stores the container image |
| Cloud Storage | Persists the SQLite database file across restarts |
| Vertex AI (Gemini) | Recipe import, nutrition and diet tags, substitutions (aisle grouping is keyword-based) |
| BigQuery | Stores usage events for analytics |
| Looker Studio | Insights dashboard on top of BigQuery |
| IAM | Least-privilege service account |
| Cloud Logging | Application and request logs |

**Tooling:** Docker, Git, gcloud CLI

---

## Architecture (overview)

```
Browser: React SPA (PWA)  --/api/*-->  Flask JSON API on Cloud Run  --->  SQLite  <--->  Cloud Storage (persistence)
                                              |
                                              +--->  Vertex AI (Gemini)   AI features
                                              |
                                              +--->  BigQuery  --->  Looker Studio   analytics
```

One repository, one container, one Cloud Run service. In production Flask serves the built React app from `frontend/dist`
and returns `index.html` for any non-`/api` path, so refreshing on `/planner` or `/shopping` works. The frontend only
uses relative `/api/...` URLs, so no CORS is needed; in development the Vite dev server proxies `/api` to Flask.
All ingredient parsing, scaling and merging happens in the backend; the frontend never re-implements it.

---

## Project Structure

```
app.py              Flask app factory, config from env vars, JSON API, serves frontend/dist
database.py         SQLite schema, parameterized queries, planner, AI usage cap, insights, demo seed
ingredients.py      Pure ingredient logic: parsing, scaling, unit conversion, merge keys, aisles, non-AI fallbacks
shopping.py         Shopping list: add with smart merging, check, clear, group by aisle
gcp.py              Optional Gemini, Cloud Storage and BigQuery hooks (no-ops unless configured)
tests/              pytest suite (temporary DB, AI and cloud disabled or faked)
frontend/
  vite.config.ts    Vite, dev proxy, PWA (manifest + Workbox) and Vitest config
  public/icons/     App icons
  src/
    main.tsx, App.tsx   Entry point, providers, routes, layout
    api/            Typed fetch wrapper (CSRF, errors, offline) and one function per endpoint
    components/     RecipeCard, RecipeForm, ImportPanel, CategoryFilter, ServingsSelect, ShoppingList,
                    ListItem, PlannerGrid, InsightBars, Nav, Toast, UpdatePrompt, providers, ...
    pages/          Dashboard, Shopping, Planner, Insights, RecipeDetail, NotFound
    hooks/          useApi, useRecipes, useShoppingList, useConfig, useToast, useOnline, usePageTitle
    lib/            Offline queue and list view helpers (pure, unit tested)
    types/          API response types
Dockerfile          Multi-stage build: Node builds the frontend, python:3.12-slim runs it
```

Tables: `recipes`, `shopping_list` (the two core tables), plus `meal_plan`, `events` and `meta`.

---

## Run locally

Requires Python 3.12 and Node.js 24 (LTS). No Google Cloud account is needed: with no environment variables set, the
app runs fully offline using SQLite and the built-in non-AI fallbacks. Six demo recipes are seeded on first run.

### One-time setup

```bash
python3.12 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt  # runtime deps + pytest
cd frontend && npm ci && cd ..
```

### Development (two terminals, hot reload)

```bash
# Terminal 1: Flask API on port 5001 (5000 is often taken by AirPlay on macOS)
source .venv/bin/activate
flask --app app run --debug --port 5001

# Terminal 2: Vite dev server on http://localhost:5173 (proxies /api to Flask)
cd frontend
npm run dev
```

Open **http://localhost:5173**. The service worker is only active in production builds.

### Production build (one server, like Cloud Run)

```bash
cd frontend && npm run build && cd ..        # writes frontend/dist
gunicorn --workers 1 --threads 8 --bind 127.0.0.1:8080 "app:create_app()"
```

Open **http://127.0.0.1:8080**. Flask serves the built app and the API from the same origin.

### Tests and checks

```bash
pytest                                                     # backend: whole suite
pytest tests/test_ingredients.py                           # one file
pytest "tests/test_app.py::test_check_and_uncheck_persist" # one test

cd frontend
npm test                    # Vitest + React Testing Library
npm run lint                # ESLint
npm run typecheck           # TypeScript (strict)
```

### Docker

```bash
docker build -t cartchef .
docker run --rm -p 8080:8080 -e TRUST_PROXY_HOPS=0 cartchef   # http://localhost:8080
```

The image sets `TRUST_PROXY_HOPS=1` for Cloud Run (real client IPs for rate limiting, `Secure` session cookie);
override it with `0` when running the container directly. Gunicorn reads `PORT` from the environment.

Optional settings live in `.env.example`; copy it to `.env` to use them with `flask run`. The database is created at
`instance/cartchef.db`; delete that file to start again with the demo recipes.

Keep Gunicorn at **one worker** (use threads for concurrency): SQLite, the in-memory rate limiter and the Cloud Storage
backup all assume a single process.

Do not put secrets in `VITE_*` variables: Vite bakes them into the public JavaScript bundle at build time. All
configuration in this project is read by Flask at runtime.

### Optional cloud features

All are off by default and turn on only when their env vars are set. Cloud failures are logged and never break a request.

| Feature | Env vars | Behaviour without it |
|---|---|---|
| Gemini (import, nutrition, substitutions) | `GEMINI_MODEL` plus `GEMINI_API_KEY` *or* `GOOGLE_CLOUD_PROJECT` (see Snap-a-recipe) | Heuristic text parser, keyword diet tags, built-in substitution list; photo import shows a friendly message |
| SQLite persistence | `GCS_BUCKET`, `GCS_DB_OBJECT` | Local file only |
| Event mirror | `BIGQUERY_DATASET`, `BIGQUERY_TABLE` (+ project) | Events stay in SQLite |
| Looker Studio link | `LOOKER_STUDIO_URL` (https only) | Link hidden |

The BigQuery table needs the columns `type STRING`, `payload STRING` (JSON text) and `created_at TIMESTAMP`. AI endpoints are rate limited (`AI_RATE_LIMIT`, default 10/minute per IP) and capped per day (`AI_DAILY_CAP`, default 300, counted in the `events` table).

## Snap-a-recipe

Photograph a recipe card, upload a screenshot, or paste messy recipe text in any language. CartChef sends it to
Gemini, which extracts the title, prep time, category and ingredients **in English**, and the add-recipe form is
**pre-filled for you to review and edit**. Nothing is saved until you press **Save recipe**.

**How it works**

1. Dashboard → **New recipe** → **Snap a recipe**: *Take photo* (opens the camera on phones), *Choose image*, and/or
   paste text, then **Import**. A thumbnail is shown before sending; wrong types and files over 5 MB are rejected
   instantly in the browser.
2. `POST /api/import` (multipart: `image` and/or `text`) checks the upload's real file signature (JPEG, PNG or WebP
   only, max 5 MB) and the text (max 8,000 characters). The image is processed in memory and never stored.
3. Gemini is told to extract only recipe fields and to ignore any instructions inside the photo or text. Its JSON
   reply is treated as untrusted: code fences are stripped, the category is forced to Breakfast, Dinner or Dessert,
   prep time is clamped to 0–1440 minutes, ingredients are trimmed, de-duplicated, capped at 60 lines of 200
   characters, and control characters are removed. An empty result returns a friendly "couldn't find a recipe" error.
4. If you've already typed in a field the import would change, the form asks first: **Replace with import** or
   **Keep mine, fill empty fields**.

Response: `{"recipe": {"title", "prep_time", "category", "ingredients": [...]}, "source": "gemini" | "fallback", "message"}`.

**Without AI** (no key, `AI_ENABLED=0`, or Gemini fails): pasted text goes through a built-in parser (title = first
line; ingredients = lines after an "Ingredients" heading until "Method/Directions/Instructions", otherwise lines
that start with a quantity) and comes back with `"source": "fallback"`. A photo alone gets a friendly message
suggesting you paste the text instead.

**When Gemini fails on a photo** the user gets a specific message: AI not set up correctly (key, permission or model
problem, HTTP 503), busy/quota reached (429), timed out (504), photo unreadable or blocked (422), and a generic
"something went wrong" (502) only as a last resort. The server log records the error class, HTTP code and status,
the SDK's message and the model name, never the key or image bytes. Pasted text falls back to the basic parser instead.

**Guardrails:** 10 requests per minute per client (`AI_RATE_LIMIT`), a daily cap on AI calls stored in the database
(`AI_DAILY_CAP`, default 300; the import returns HTTP 429 once it's reached), a 30-second request timeout, and an
`ai_import` event per import (no image data, no secrets).

**Environment variables** (read from the real environment or a local `.env`; real variables win):

| Variable | Purpose |
|---|---|
| `GEMINI_MODEL` | Model name to call (required for AI; `.env.example` suggests one) |
| `GEMINI_API_KEY` | An API key. By default it's treated as a Gemini API key from Google AI Studio ("api-key" mode) |
| `GOOGLE_GENAI_USE_VERTEXAI` | Set to `true` if `GEMINI_API_KEY` is a **Vertex AI Express mode** key ("vertex-express" mode). These keys are rejected by the Gemini Developer API with `403 PERMISSION_DENIED` |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | Used when there's no API key: Vertex AI with Application Default Credentials ("vertex" mode; location defaults to `global`) |
| `AI_ENABLED` | `1` (default) or `0` to force the fallbacks |
| `AI_DAILY_CAP`, `AI_RATE_LIMIT`, `AI_TIMEOUT_SECONDS` | Guardrails (300, 10/minute, 30) |

At startup the log says only which mode is active and the model, e.g. `Gemini mode: api-key (model …)`,
`vertex-express`, `vertex`, or `disabled (GEMINI_MODEL is not set)`. The API key
is never logged, returned in a response, or included in an error message.

**Run it locally with Gemini**

```bash
cp .env.example .env
# edit .env: set GEMINI_API_KEY=<your key> (and check GEMINI_MODEL); .env is git- and docker-ignored
source .venv/bin/activate
flask --app app run --debug --port 5001       # log shows "Gemini mode: api-key"
cd frontend && npm run dev                    # second terminal; open http://localhost:5173
```

For Vertex AI instead, leave `GEMINI_API_KEY` empty, set `GOOGLE_CLOUD_PROJECT` (and optionally
`GOOGLE_CLOUD_LOCATION`), and run `gcloud auth application-default login` once. With neither set, everything still
works using the fallbacks. Tests never call Gemini: `pytest tests/test_import.py` uses a fake client.

## Ask the chef

A chat assistant opened from the dashboard header (general questions), from any recipe card or drawer,
and from the recipe page (questions about that recipe). It can suggest substitutions, adapt a recipe
(vegan, gluten-free, less spicy, different servings, fewer ingredients), suggest dishes from ingredients
you list, and answer cooking questions.

- `POST /api/chat` with `{message, recipe_id?, history}`. The server is stateless: it keeps at most the
  last 8 user/assistant turns (each trimmed, other roles ignored) and loads the recipe itself by id.
- Gemini answers in JSON: a short reply, an optional recipe **proposal**, and optional **shopping items**.
  The proposal is sanitized like a recipe import. The UI shows it as a before/after comparison with
  **Apply as new recipe**, **Replace this recipe** (`PUT /api/recipes/<id>`) and **Dismiss**; shopping
  items get **Add to list** buttons. Nothing is saved until you click.
- Guardrails: 500-character messages, `CHAT_RATE_LIMIT` (default 15/minute), the shared daily AI cap, the
  30-second timeout, and the same specific error messages as photo import. An `ai_chat` event is logged
  without the message text; message contents and the API key are never logged.
- Without AI it answers with a friendly note, plus built-in swaps when the message names a known
  ingredient (e.g. "out of butter").

## Deployment

The `Dockerfile` and `.dockerignore` are ready for Cloud Build and Cloud Run (one service, one container, one Gunicorn
worker). Deployment steps will be added once the GCP project is set up. Because the SQLite file is backed up to a
single Cloud Storage object, run the service with `--max-instances=1`.

---

## Roadmap

- [x] Problem statement reviewed and scope agreed
- [x] Technology stack and architecture chosen
- [ ] GCP project, billing alert and APIs set up
- [x] Core app: database, recipe form, shopping list logic, dashboard
- [x] Scaler, checkable list, category filter, clear button
- [x] AI features with Gemini (code and fallbacks; not yet run against Vertex AI)
- [x] React + TypeScript frontend (Vite, PWA) served by Flask in one container
- [ ] Deployment to Cloud Run
- [ ] Analytics with BigQuery and Looker Studio
- [ ] Demo script and presentation

---

## Team

*Add team member names here.*

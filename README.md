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
| Gemini (import, nutrition, substitutions) | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GEMINI_MODEL` | Heuristic text parser, keyword diet tags, built-in substitution list; photo import shows a friendly message |
| SQLite persistence | `GCS_BUCKET`, `GCS_DB_OBJECT` | Local file only |
| Event mirror | `BIGQUERY_DATASET`, `BIGQUERY_TABLE` (+ project) | Events stay in SQLite |
| Looker Studio link | `LOOKER_STUDIO_URL` (https only) | Link hidden |

The BigQuery table needs the columns `type STRING`, `payload STRING` (JSON text) and `created_at TIMESTAMP`. AI endpoints are rate limited (`AI_RATE_LIMIT`, default 10/minute per IP) and capped per day (`AI_DAILY_CAP`, default 300, stored in the database).

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

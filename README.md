# CartChef — Recipe Box & Shopping List Maker

> Save your favorite recipes, scale them to any serving size, and turn their ingredients into one consolidated shopping checklist with a single click.

Built for the **Cognizant Hackathon** (GCP track) as **Use Case 4: Recipe Box & Shopping List Maker**.

---

## Status

🚧 **In development.** This is the initial commit. The project structure, setup instructions and live demo link will be added as the build progresses.

---

## Problem Statement

Build a personal recipe repository where users can save their favorite meals, view ingredients, and click a button to automatically add those ingredients to a consolidated shopping checklist.

### Core requirements

- [ ] SQLite database with two tables: `recipes` and `shopping_list`
- [ ] Recipe form: title, preparation time, and an ingredients text area (one per line)
- [ ] Backend logic that splits the ingredient text by line and inserts the items into the shopping list table
- [ ] Dashboard with a side-by-side (or two-page) layout: browse recipes and check off shopping items
- [ ] **Servings scaler:** dropdown (e.g. 2x, 4x) that multiplies ingredient quantities
- [ ] **Checkable list:** clicking an item strikes it through
- [ ] **Category tags:** filter recipes by Breakfast, Dinner or Dessert
- [ ] **Clear list button:** wipes the shopping list after a grocery trip

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

- Python 3.12
- Flask with Jinja2 templates
- SQLite
- HTML, CSS and vanilla JavaScript
- Web app manifest and service worker (PWA)
- Gunicorn, Flask-Limiter, pytest

**Google Cloud Platform**

| Service | Purpose |
|---|---|
| Cloud Run | Hosts the live application |
| Cloud Build | Builds the container image |
| Artifact Registry | Stores the container image |
| Cloud Storage | Persists the SQLite database file across restarts |
| Vertex AI (Gemini) | Recipe import, nutrition and diet tags, substitutions, aisle grouping |
| BigQuery | Stores usage events for analytics |
| Looker Studio | Insights dashboard on top of BigQuery |
| IAM | Least-privilege service account |
| Cloud Logging | Application and request logs |

**Tooling:** Docker, Git, gcloud CLI

---

## Architecture (overview)

```
Browser (HTML / CSS / JS, PWA)
        |
        v
Flask app on Cloud Run  --->  SQLite  <--->  Cloud Storage (persistence)
        |
        +--->  Vertex AI (Gemini)   AI features
        |
        +--->  BigQuery  --->  Looker Studio   analytics
```

The frontend and backend live in a single repository. Flask serves the pages, styles and scripts, and the whole app ships as one container.

---

## Project Structure

*To be added as the code is committed.*

---

## Getting Started

*Local setup and run instructions will be added once the core app is in place.*

## Deployment

*Cloud Run deployment steps will be added after the first working build.*

---

## Roadmap

- [x] Problem statement reviewed and scope agreed
- [x] Technology stack and architecture chosen
- [ ] GCP project, billing alert and APIs set up
- [ ] Core app: database, recipe form, shopping list logic, dashboard
- [ ] Scaler, checkable list, category filter, clear button
- [ ] AI features with Gemini
- [ ] Deployment to Cloud Run
- [ ] Analytics with BigQuery and Looker Studio
- [ ] Demo script and presentation

---

## Team

*Add team member names here.*

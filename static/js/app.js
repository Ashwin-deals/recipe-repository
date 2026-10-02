// CartChef front end: progressive enhancement over server-rendered pages.
// All ingredient maths happens on the server; this file only moves data around.
(() => {
  "use strict";

  const QUEUE_KEY = "cartchef:pending-checks";
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  let csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";

  // ---------- helpers ----------

  function toast(message, isError = false) {
    const region = document.querySelector("[data-toasts]");
    if (!region || !message) return;
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " is-error" : "");
    el.textContent = message;
    region.append(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function refreshCsrf() {
    const res = await fetch("/api/csrf", { credentials: "same-origin" });
    if (res.ok) csrfToken = (await res.json()).token;
  }

  // JSON API call. Retries once with a fresh CSRF token if the session expired.
  async function api(url, { method = "GET", body, form } = {}, retried = false) {
    const headers = { Accept: "application/json", "X-CSRF-Token": csrfToken };
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload, credentials: "same-origin" });
    if (res.status === 403 && !retried) {
      await refreshCsrf();
      return api(url, { method, body, form }, true);
    }
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const error = new Error(data.error || `Something went wrong (${res.status}).`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
  }

  function updateOpenCount(counts) {
    if (!counts) return;
    document.querySelectorAll("[data-open-count]").forEach((badge) => {
      badge.textContent = counts.open;
      badge.hidden = !counts.open;
    });
    if (counts.total === undefined) return;
    document.querySelectorAll("[data-list-count]").forEach((line) => {
      if (!counts.total) {
        line.textContent = "Nothing on the list yet.";
        return;
      }
      const parts = [el("strong", "", String(counts.open)), document.createTextNode(" to buy")];
      if (counts.checked) {
        parts.push(document.createTextNode(" · "), el("strong", "", String(counts.checked)),
          document.createTextNode(" in the cart"));
      }
      line.replaceChildren(...parts);
    });
  }

  // ---------- offline queue for ticking items ----------

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || {}; } catch { return {}; }
  }

  function saveQueue(queue) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* storage full or blocked */ }
  }

  function setItemState(button, checked, pending) {
    button.classList.toggle("is-checked", checked);
    button.classList.toggle("is-pending", pending);
    button.setAttribute("aria-pressed", String(checked));
  }

  function applyQueue() {
    const queue = loadQueue();
    for (const [id, checked] of Object.entries(queue)) {
      document.querySelectorAll(`[data-item="${CSS.escape(id)}"]`).forEach((b) => setItemState(b, checked, true));
    }
    const pending = Object.keys(queue).length;
    document.querySelectorAll("[data-sync-note]").forEach((note) => {
      note.hidden = !pending;
      note.textContent = pending ? `${pending} change${pending > 1 ? "s" : ""} waiting to sync` : "";
    });
  }

  let flushing = false;
  async function flushQueue() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    let lastCounts;
    try {
      for (const [id, checked] of Object.entries(loadQueue())) {
        try {
          const data = await api(`/api/list/${encodeURIComponent(id)}/check`, { method: "POST", body: { checked } });
          lastCounts = data.counts;
        } catch (error) {
          if (!error.status) break; // still offline: keep the rest queued
          // 404 (item cleared meanwhile) or other client errors: drop this change
        }
        const queue = loadQueue();
        if (queue[id] === checked) { delete queue[id]; saveQueue(queue); }
        document.querySelectorAll(`[data-item="${CSS.escape(id)}"]`).forEach((b) => b.classList.remove("is-pending"));
      }
    } finally {
      flushing = false;
      applyQueue();
      updateOpenCount(lastCounts);
    }
  }

  async function toggleItem(button) {
    const id = button.dataset.item;
    const checked = button.getAttribute("aria-pressed") !== "true";
    setItemState(button, checked, true);
    const queue = loadQueue();
    queue[id] = checked;
    saveQueue(queue);
    if (!navigator.onLine) {
      applyQueue();
      toast("Saved offline. It will sync when you're back online.");
      return;
    }
    await flushQueue();
  }

  // Re-render the list pane from the server and keep the offline copy fresh.
  async function refreshList() {
    const bodies = document.querySelectorAll("[data-list-body]");
    if (!bodies.length) return;
    try {
      const res = await fetch("/list/fragment", { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (!res.ok) return;
      const html = await res.text();
      bodies.forEach((body) => { body.innerHTML = html; });
      applyQueue();
      const summary = document.querySelector("[data-list-body] .list-body");
      if (summary) updateOpenCount({ open: Number(summary.dataset.open) });
      if (navigator.serviceWorker?.controller) {
        fetch("/list", { credentials: "same-origin", headers: { Accept: "text/html" } }).catch(() => {});
      }
    } catch { /* offline: keep what is on screen */ }
  }

  // ---------- two-tap confirmation for destructive buttons ----------

  function armed(button, label) {
    if (button.classList.contains("is-armed")) return true;
    const original = button.innerHTML;
    button.classList.add("is-armed");
    button.textContent = label;
    setTimeout(() => {
      button.classList.remove("is-armed");
      button.innerHTML = original;
    }, 3000);
    return false;
  }

  // ---------- scaling and add to list ----------

  async function scaleRecipe(select) {
    const root = select.closest("[data-recipe]");
    const multiplier = select.value;
    try {
      const data = await api(`/api/recipes/${root.dataset.recipe}/scaled?x=${encodeURIComponent(multiplier)}`);
      const details = root.querySelector("[data-ingredients]");
      if (details) details.open = true;
      root.querySelectorAll("[data-line-text]").forEach((span, i) => {
        if (data.lines[i] === undefined) return;
        span.textContent = data.lines[i];
        const row = span.closest("li");
        row.classList.remove("is-updated");
        void row.offsetWidth; // restart the highlight animation
        row.classList.add("is-updated");
        const swap = row.querySelector("[data-swap]");
        if (swap) swap.dataset.ingredient = data.lines[i];
      });
      root.querySelectorAll("[data-scale-badge]").forEach((badge) => {
        badge.hidden = data.multiplier === 1;
        badge.textContent = `×${data.multiplier}`;
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function addRecipeToList(button) {
    const root = button.closest("[data-recipe]");
    const multiplier = root.querySelector("[data-scale]")?.value || "1";
    setBusy(button, true);
    try {
      const data = await api(`/api/recipes/${root.dataset.recipe}/add-to-list`, {
        method: "POST", body: { multiplier: Number(multiplier) },
      });
      const merged = data.merged ? `, ${data.merged} merged with items already there` : "";
      toast(`Added ${data.added} new item${data.added === 1 ? "" : "s"}${merged}.`);
      updateOpenCount(data.counts);
      await refreshList();
    } catch (error) {
      toast(error.status ? error.message : "You're offline. Adding to the list needs a connection.", true);
    } finally {
      setBusy(button, false);
    }
  }

  // ---------- list actions ----------

  async function clearList(button) {
    const scope = button.dataset.clear;
    if (!armed(button, scope === "all" ? "Tap again to clear" : "Tap again")) return;
    try {
      const data = await api("/api/list/clear", { method: "POST", body: { scope } });
      toast(data.removed ? `Removed ${data.removed} item${data.removed === 1 ? "" : "s"}.` : "Nothing to clear.");
      if (scope === "all") saveQueue({});
      updateOpenCount(data.counts);
      await refreshList();
    } catch (error) {
      toast(error.status ? error.message : "You're offline. Clearing needs a connection.", true);
    }
  }

  async function addItem(form) {
    const input = form.querySelector("input[name=line]");
    const line = input.value.trim();
    if (!line) return;
    const button = form.querySelector("button");
    setBusy(button, true);
    try {
      const data = await api("/api/list/items", { method: "POST", body: { line } });
      input.value = "";
      toast(data.merged ? "Merged with an item already on the list." : "Added to the list.");
      updateOpenCount(data.counts);
      await refreshList();
    } catch (error) {
      toast(error.status ? error.message : "You're offline. Adding items needs a connection.", true);
    } finally {
      setBusy(button, false);
    }
  }

  // ---------- recipe page: nutrition and substitutions ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderDietTags(tags) {
    let list = document.querySelector(".recipe-hero [data-diet-tags]");
    if (!list) {
      list = el("ul", "diet");
      list.dataset.dietTags = "";
      list.setAttribute("aria-label", "Diet tags (estimate)");
      document.querySelector(".recipe-hero")?.append(list);
    }
    list.replaceChildren(...tags.map((tag) => {
      const item = el("li", "diet-tag", tag);
      item.title = "Estimate";
      return item;
    }));
  }

  async function estimateNutrition(button) {
    const root = button.closest("[data-recipe]");
    const box = root.querySelector("[data-nutrition-box]");
    setBusy(button, true);
    try {
      const data = await api(`/api/recipes/${root.dataset.recipe}/nutrition`, { method: "POST" });
      renderDietTags(data.diet_tags);
      if (data.nutrition) {
        const n = data.nutrition;
        const grid = el("dl", "nutrition");
        for (const [label, value, unit] of [
          ["Calories", n.calories, " kcal"], ["Protein", n.protein_g, " g"],
          ["Carbs", n.carbs_g, " g"], ["Fat", n.fat_g, " g"],
        ]) {
          const cell = el("div");
          cell.append(el("dt", "", label), el("dd", "", value === null ? "—" : `${value}${unit}`));
          grid.append(cell);
        }
        const servings = n.servings ? `, about ${n.servings} servings` : "";
        box.replaceChildren(grid, el("p", "hint", `Per serving${servings}. ${data.message}`));
      } else {
        box.replaceChildren(el("p", "hint", data.message));
      }
    } catch (error) {
      toast(error.message, true);
    } finally {
      setBusy(button, false);
    }
  }

  async function suggestSwap(button) {
    const row = button.closest("li");
    const box = row.querySelector("[data-swap-box]");
    if (!box.hidden) {
      box.hidden = true;
      button.setAttribute("aria-expanded", "false");
      return;
    }
    setBusy(button, true);
    try {
      const root = button.closest("[data-recipe]");
      const data = await api("/api/substitute", {
        method: "POST", body: { ingredient: button.dataset.ingredient, recipe_id: Number(root.dataset.recipe) },
      });
      const children = [el("span", "source-label", data.source === "ai" ? "Suggested by Gemini" : "Built-in suggestions")];
      if (data.substitutes.length) {
        const list = el("ul");
        for (const s of data.substitutes) {
          const item = el("li");
          item.append(el("strong", "", s.swap), document.createTextNode(s.note ? ` – ${s.note}` : ""));
          list.append(item);
        }
        children.push(list);
      }
      if (data.message) children.push(el("p", "hint", data.message));
      box.replaceChildren(...children);
      box.hidden = false;
      button.setAttribute("aria-expanded", "true");
    } catch (error) {
      toast(error.message, true);
    } finally {
      setBusy(button, false);
    }
  }

  // ---------- recipe form: snap-a-recipe import ----------

  function setupImport(form) {
    const status = form.querySelector("[data-import-status]");
    const fileInput = form.querySelector("input[type=file]");
    let mode = "text";

    const showStatus = (message, isError) => {
      status.textContent = message;
      status.classList.toggle("is-error", Boolean(isError));
      status.hidden = false;
    };

    form.querySelectorAll("[data-import-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        mode = tab.dataset.importTab;
        form.querySelectorAll("[data-import-tab]").forEach((t) => {
          t.classList.toggle("is-active", t === tab);
          t.setAttribute("aria-selected", String(t === tab));
        });
        form.querySelectorAll("[data-import-pane]").forEach((pane) => { pane.hidden = pane.dataset.importPane !== mode; });
      });
    });

    fileInput?.addEventListener("change", () => {
      const file = fileInput.files[0];
      form.querySelector("[data-file-name]").textContent = file ? file.name : "Choose a JPEG, PNG or WebP (max 5 MB)";
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = new FormData();
      if (mode === "image") {
        const file = fileInput.files[0];
        if (!file) return showStatus("Choose a photo first.", true);
        if (file.size > MAX_IMAGE_BYTES) return showStatus("That photo is over 5 MB. Try a smaller one.", true);
        payload.append("image", file);
      } else {
        const text = form.querySelector("textarea[name=text]").value.trim();
        if (!text) return showStatus("Paste some recipe text first.", true);
        payload.append("text", text);
      }
      const button = form.querySelector("button[type=submit]");
      setBusy(button, true);
      showStatus(mode === "image" ? "Reading your photo…" : "Reading your recipe…");
      try {
        const data = await api("/api/import", { method: "POST", form: payload });
        fillRecipeForm(data.recipe);
        showStatus(data.message);
      } catch (error) {
        showStatus(error.status ? error.message : "You're offline. Importing needs a connection.", true);
      } finally {
        setBusy(button, false);
      }
    });
  }

  function fillRecipeForm(recipe) {
    const form = document.querySelector("[data-recipe-form]");
    if (!form) return;
    const set = (name, value) => {
      const field = form.elements[name];
      if (!field || value === null || value === undefined || value === "") return;
      field.value = value;
      field.classList.remove("is-filled");
      void field.offsetWidth;
      field.classList.add("is-filled");
    };
    set("title", recipe.title);
    set("prep_time", recipe.prep_time);
    set("category", recipe.category);
    set("ingredients", (recipe.ingredients || []).join("\n"));
    form.elements.title?.focus();
  }

  // ---------- wiring ----------

  document.addEventListener("change", (event) => {
    const select = event.target.closest("[data-scale]");
    if (select) scaleRecipe(select);
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-item], [data-add-recipe], [data-clear], [data-nutrition], [data-swap]");
    if (!target) return;
    if (target.matches("[data-item]")) toggleItem(target);
    else if (target.matches("[data-add-recipe]")) addRecipeToList(target);
    else if (target.matches("[data-clear]")) clearList(target);
    else if (target.matches("[data-nutrition]")) estimateNutrition(target);
    else if (target.matches("[data-swap]")) suggestSwap(target);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.matches("[data-add-item]")) {
      event.preventDefault();
      addItem(form);
    } else if (form.matches("[data-confirm]")) {
      const button = form.querySelector("button[type=submit]");
      if (!armed(button, form.dataset.confirm)) event.preventDefault();
    }
  });

  document.querySelectorAll("[data-import-form]").forEach(setupImport);

  const banner = document.querySelector("[data-offline-banner]");
  const updateOnline = () => { if (banner) banner.hidden = navigator.onLine; };
  window.addEventListener("online", async () => {
    updateOnline();
    await flushQueue();
    await refreshList();
  });
  window.addEventListener("offline", updateOnline);
  updateOnline();
  applyQueue();
  flushQueue();
  // Patchy store signal often reports "online" while requests fail, so retry queued ticks.
  setInterval(() => { if (Object.keys(loadQueue()).length) flushQueue(); }, 15000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* app still works without it */ });
    });
  }
})();

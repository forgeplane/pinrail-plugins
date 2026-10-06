// A set of designs on a canvas: each frame an HTML mockup or an image, laid
// out in rows by group. The person pans and zooms, pins comments to any
// point of a frame (to the element under it, for HTML), marks each frame
// approved or in need of changes, and gives a verdict on the set.
"use strict";

const esc = Pinrail.escape;
const $ = (id) => document.getElementById(id);
for (const el of document.querySelectorAll("[data-icon]")) el.outerHTML = Pinrail.icon(el.dataset.icon);

// ------------------------------------------------------------------ state

let payload = {};
/** the frames as sent, without any whose id repeats an earlier one */
let frames = [];
/** what the person marked on each frame: "approved" or "changes" */
let statuses = {};
let comments = [];
let verdict = null;
/** with variants: the group the person starred */
let favorite = null;
let tool = "move";
/** the canvas: where the world's origin is on screen, and its scale */
const view = { x: 40, y: 80, z: 1 };
/** where a new comment goes, while it is being written */
let composing = null;
/** the comment being edited */
let editing = null;
/** each frame's elements, and for HTML its shadow root and body stand-in */
const mounted = new Map();
let buildGeneration = 0;
let spaceHeld = false;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const GAP = 120;
const ROW_GAP = 240;

const plugin = Pinrail.connect({
  onInit({ review, draft }) {
    const d = draft || {};
    comments = Array.isArray(d.comments) ? d.comments : [];
    statuses = d.statuses && typeof d.statuses === "object" ? d.statuses : {};
    verdict = d.verdict || null;
    favorite = typeof d.favorite === "string" ? d.favorite : null;
    load(review);
  },
  onSubmitted() {
    closeDialog();
    setTool("move");
    renderSide();
    renderPins();
  },
  onViolations(errors) {
    $("errors").textContent = errors.map((e) => `${e.path || "/"}: ${e.message}`).join("\n");
  },
  onCollect() {
    return handOver();
  },
  // a shortcut pressed while the app has the focus arrives as a keydown on
  // the document, which the listener below answers
});

async function load(review) {
  payload = review.payload || {};
  $("shell").dataset.readonly = String(plugin.readonly);
  if (plugin.readonly) setTool("move");
  if (payload.context) {
    $("context").hidden = false;
    $("context").innerHTML = Pinrail.markdown(payload.context);
  }
  const seen = new Set();
  frames = (payload.frames || []).filter((f) => f && !seen.has(f.id) && seen.add(f.id));
  renderSide();
  await buildWorld();
  fit();
}

// ------------------------------------------------------------------ the frames

async function buildWorld() {
  const generation = ++buildGeneration;
  const world = $("world");
  world.replaceChildren();
  mounted.clear();
  for (const f of frames) {
    const el = document.createElement("section");
    el.className = "frame";
    el.dataset.frame = f.id;
    el.innerHTML =
      `<div class="frame-head" data-goto="${esc(f.id)}"><span class="title">${esc(f.title)}</span><span class="size"></span><span class="status"></span></div>` +
      `<div class="frame-body"></div><div class="hover-box" hidden></div><div class="pins"></div>`;
    world.append(el);
    const entry = { el, body: el.querySelector(".frame-body"), root: null, inner: null };
    mounted.set(f.id, entry);
    try {
      await fill(f, entry);
    } catch (error) {
      entry.el.style.width = `${f.width || 640}px`;
      entry.body.insertAdjacentHTML(
        "afterbegin",
        `<div class="frame-error">This frame does not load: ${esc(String((error && error.message) || error))}</div>`,
      );
    }
    if (generation !== buildGeneration) return;
  }
  layout();
  renderHeads();
  renderPins();
}

/** The groups, in the order their first frame was sent. */
function groupsOf() {
  return [...new Set(frames.map((f) => f.group || ""))];
}

function favoriteOf() {
  if (!plugin.readonly) return favorite;
  return (decided() && decided().favorite) || null;
}

/** The stars, on the canvas and on the side. */
function renderStars() {
  const chosen = favoriteOf();
  for (const star of document.querySelectorAll("[data-favorite]")) {
    const on = star.dataset.favorite === chosen;
    star.setAttribute("aria-pressed", String(on));
    star.disabled = plugin.readonly;
    star.innerHTML = `${Pinrail.icon("star")} ${on ? "Favorite" : plugin.readonly ? "" : "Make favorite"}`;
    star.hidden = plugin.readonly && !on;
  }
}

/** Puts a frame's design in its body, at the size it asks for. */
async function fill(f, entry) {
  const { el, body } = entry;
  let width = f.width;
  let height = f.height;
  if (f.image) {
    const url = await plugin.attachmentUrl(Pinrail.attachmentName(f.image));
    const img = new Image();
    img.alt = f.title;
    img.draggable = false;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("the image does not decode"));
      img.src = url;
    });
    const ratio = img.naturalHeight / img.naturalWidth;
    width = width || (height ? Math.round(height / ratio) : img.naturalWidth);
    height = height || Math.round(width * ratio);
    body.prepend(img);
  } else {
    const html =
      typeof f.html === "string"
        ? f.html
        : new TextDecoder().decode(await plugin.attachment(Pinrail.attachmentName(f.file)));
    const host = document.createElement("div");
    host.className = "host";
    if (height) host.style.height = "100%";
    body.prepend(host);
    const { root, inner } = mount(host, html);
    entry.root = root;
    entry.inner = inner;
    width = width || 1280;
  }
  el.style.width = `${width}px`;
  body.style.width = `${width}px`;
  if (height) body.style.height = `${height}px`;
}

/** Places the frames in rows, one per group, with the arrows of a flow. */
function layout() {
  const rows = [];
  for (const f of frames) {
    const key = f.group || "";
    let row = rows.find((r) => r.key === key);
    if (!row) rows.push((row = { key, frames: [] }));
    row.frames.push(f);
  }
  const world = $("world");
  for (const old of world.querySelectorAll(".group-title, .arrow")) old.remove();
  let y = 0;
  for (const row of rows) {
    if (row.key) {
      const title = document.createElement("div");
      title.className = "group-title";
      title.innerHTML = `<span>${esc(row.key)}</span>${payload.variants ? `<button type="button" class="star" data-favorite="${esc(row.key)}"></button>` : ""}`;
      title.style.left = "0px";
      title.style.top = `${y}px`;
      title.style.transform = "translateY(calc(-100% - 30px / var(--lz)))";
      world.append(title);
    }
    let x = 0;
    let tallest = 0;
    const sizes = row.frames.map((f) => {
      const { el, body } = mounted.get(f.id);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const size = { x, w: el.offsetWidth, h: body.offsetHeight };
      el.querySelector(".size").textContent = `${size.w}×${size.h}`;
      x += size.w + GAP;
      tallest = Math.max(tallest, size.h);
      return size;
    });
    if (payload.flow) {
      for (let i = 0; i + 1 < sizes.length; i++) {
        const arrow = document.createElement("div");
        arrow.className = "arrow";
        arrow.style.left = `${sizes[i].x + sizes[i].w + 18}px`;
        arrow.style.width = `${GAP - 36}px`;
        arrow.style.top = `${y + Math.min(sizes[i].h, sizes[i + 1].h) / 2}px`;
        world.append(arrow);
      }
    }
    y += tallest + ROW_GAP;
  }
}

function renderHeads() {
  renderStars();
  for (const f of frames) {
    const m = mounted.get(f.id);
    if (!m) continue;
    const status = statusOf(f.id);
    const chip = m.el.querySelector(".status");
    chip.className = `status ${status}`;
    chip.textContent = status === "approved" ? "Approved" : status === "changes" ? "Changes" : "";
  }
}

// ------------------------------------------------------------------ the canvas

function apply() {
  const world = $("world");
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  world.style.setProperty("--z", String(view.z));
  $("zoom-level").textContent = `${Math.round(view.z * 100)}%`;
  // the dots keep a readable spacing at any zoom
  let size = 22 * view.z;
  while (size < 11) size *= 2;
  while (size > 44) size /= 2;
  const viewport = $("viewport");
  viewport.style.backgroundSize = `${size}px ${size}px`;
  viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
  placeDialog();
}

const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zooms to `z`, keeping the point at (cx, cy) of the viewport where it is. */
function zoomAt(z, cx, cy) {
  z = clampZoom(z);
  view.x = cx - ((cx - view.x) * z) / view.z;
  view.y = cy - ((cy - view.y) * z) / view.z;
  view.z = z;
  apply();
}

function zoomBy(factor) {
  const r = $("viewport").getBoundingClientRect();
  zoomAt(view.z * factor, r.width / 2, r.height / 2);
}

/** The box, in world units, around some elements of the world. */
function boxOf(elements) {
  const vp = $("viewport").getBoundingClientRect();
  let box = null;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const left = (r.left - vp.left - view.x) / view.z;
    const top = (r.top - vp.top - view.y) / view.z;
    const right = left + r.width / view.z;
    const bottom = top + r.height / view.z;
    box = box
      ? {
          left: Math.min(box.left, left),
          top: Math.min(box.top, top),
          right: Math.max(box.right, right),
          bottom: Math.max(box.bottom, bottom),
        }
      : { left, top, right, bottom };
  }
  return box;
}

/** Shows the elements whole, no larger than 100 %. The labels keep their
 *  size on screen, so the box is measured again at the new zoom. */
function fitTo(elementsOf, pad = 48) {
  const vp = $("viewport").getBoundingClientRect();
  if (!vp.width || !vp.height) return;
  for (let pass = 0; pass < 2; pass++) {
    const box = boxOf(elementsOf());
    if (!box) return;
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const z = clampZoom(Math.min((vp.width - pad * 2) / w, (vp.height - pad * 2) / h, 1));
    view.z = z;
    view.x = (vp.width - w * z) / 2 - box.left * z;
    view.y = (vp.height - h * z) / 2 - box.top * z;
    apply();
  }
}

function fit() {
  fitTo(() => $("world").querySelectorAll(".frame, .frame-head, .group-title"));
}

function goToFrame(id) {
  const m = mounted.get(id);
  if (!m) return;
  fitTo(() => [m.el, m.el.querySelector(".frame-head")], 64);
  select(id);
  flash(m.el);
}

function flash(el) {
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

function select(id) {
  for (const [key, m] of mounted) m.el.classList.toggle("selected", key === id);
  const row = $("list").querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (row) row.scrollIntoView({ block: "nearest" });
}

$("zoom-in").addEventListener("click", () => zoomBy(1.25));
$("zoom-out").addEventListener("click", () => zoomBy(0.8));
$("zoom-fit").addEventListener("click", fit);

$("viewport").addEventListener(
  "wheel",
  (event) => {
    if (event.target.closest && event.target.closest("#comment-dialog")) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const r = $("viewport").getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      // a pinch, or ctrl with the wheel
      zoomAt(view.z * Math.exp(-event.deltaY * unit * 0.01), event.clientX - r.left, event.clientY - r.top);
    } else {
      view.x -= event.deltaX * unit;
      view.y -= event.deltaY * unit;
      apply();
    }
  },
  { passive: false },
);

$("viewport").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  if (event.target.closest("#comment-dialog, .pin, .star")) return;
  const head = event.target.closest(".frame-head");
  if (head && event.button === 0) return goToFrame(head.dataset.goto);
  const body = event.target.closest(".frame-body");
  if (tool === "comment" && body && event.button === 0 && !spaceHeld) {
    event.preventDefault();
    return placeComment(body, event);
  }
  // anywhere else: drag to pan; a click without a drag picks the frame
  const viewport = $("viewport");
  const start = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
  let moved = false;
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("panning");
  const move = (e) => {
    if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 3) moved = true;
    view.x = start.vx + e.clientX - start.x;
    view.y = start.vy + e.clientY - start.y;
    apply();
  };
  const up = () => {
    viewport.removeEventListener("pointermove", move);
    viewport.removeEventListener("pointerup", up);
    viewport.removeEventListener("pointercancel", up);
    viewport.classList.remove("panning");
    if (!moved) select(body ? body.closest(".frame").dataset.frame : null);
  };
  viewport.addEventListener("pointermove", move);
  viewport.addEventListener("pointerup", up);
  viewport.addEventListener("pointercancel", up);
});

// while commenting, the element a click would pin to
$("viewport").addEventListener("pointermove", (event) => {
  for (const m of mounted.values()) m.el.querySelector(".hover-box").hidden = true;
  if (tool !== "comment" || spaceHeld) return;
  const body = event.target.closest && event.target.closest(".frame-body");
  if (!body) return;
  const m = mounted.get(body.closest(".frame").dataset.frame);
  const el = m.inner ? commentable(event.composedPath()[0], m.inner) : null;
  if (!el) return;
  const a = el.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  const box = m.el.querySelector(".hover-box");
  box.hidden = false;
  box.style.left = `${(a.left - b.left) / view.z}px`;
  box.style.top = `${(a.top - b.top) / view.z}px`;
  box.style.width = `${a.width / view.z}px`;
  box.style.height = `${a.height / view.z}px`;
});
$("viewport").addEventListener("pointerleave", () => {
  for (const m of mounted.values()) m.el.querySelector(".hover-box").hidden = true;
});

new ResizeObserver(() => placeDialog()).observe($("viewport"));

// ------------------------------------------------------------------ tools and keys

document.querySelector(".tools").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (button) setTool(button.dataset.tool);
});

function setTool(next) {
  tool = next === "comment" && !plugin.readonly ? "comment" : "move";
  for (const b of document.querySelectorAll(".tools [data-tool]"))
    b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  $("viewport").dataset.tool = tool;
  for (const m of mounted.values()) m.el.querySelector(".hover-box").hidden = true;
}

/** The canvas's keys; false for a key it leaves alone. */
function keyDown(key) {
  if (key.metaKey || key.ctrlKey || key.altKey) return false;
  if (key.key === "Escape") {
    if (!$("comment-dialog").hidden) closeDialog();
    else setTool("move");
    return true;
  }
  const actions = {
    c: () => setTool("comment"),
    v: () => setTool("move"),
    0: fit,
    1: () => {
      const r = $("viewport").getBoundingClientRect();
      zoomAt(1, r.width / 2, r.height / 2);
    },
    "=": () => zoomBy(1.25),
    "+": () => zoomBy(1.25),
    "-": () => zoomBy(0.8),
  };
  const action = actions[key.key];
  if (!action) return false;
  action();
  return true;
}

const typing = (target) => target instanceof Element && target.closest("textarea, input, [contenteditable]");
document.addEventListener("keydown", (event) => {
  if (event.key === " " && !typing(event.target)) {
    spaceHeld = true;
    $("viewport").style.cursor = "grab";
    event.preventDefault();
    return;
  }
  if (typing(event.target) || event.repeat) return;
  if (keyDown(event)) event.preventDefault();
});
document.addEventListener("keyup", (event) => {
  if (event.key === " ") {
    spaceHeld = false;
    $("viewport").style.cursor = "";
  }
});

// ------------------------------------------------------------------ comments

const decided = () => (plugin.review && plugin.review.decision ? plugin.review.decision.data : null);
const frameIndex = (id) => frames.findIndex((f) => f.id === id);
const byPlace = (a, b) => frameIndex(a.frame) - frameIndex(b.frame) || a.id - b.id;

/** The comments on show, in order: by frame, then as written. */
function shownComments() {
  const list = plugin.readonly ? (decided() && decided().comments) || [] : comments;
  return [...list].sort(byPlace);
}

function statusOf(id) {
  if (plugin.readonly) {
    const mark = decided() && (decided().frames || []).find((f) => f.id === id);
    return mark ? mark.status : "unmarked";
  }
  return statuses[id] || "unmarked";
}

function placeComment(body, event) {
  const id = body.closest(".frame").dataset.frame;
  const r = body.getBoundingClientRect();
  const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
  const target = {
    frame: id,
    x: round((event.clientX - r.left) / r.width),
    y: round((event.clientY - r.top) / r.height),
  };
  const m = mounted.get(id);
  const el = m.inner ? commentable(event.composedPath()[0], m.inner) : null;
  if (el) {
    target.selector = selectorFor(el, m.root, m.inner);
    target.tag = el.localName;
    const snippet = snippetOf(el);
    if (snippet) target.snippet = snippet;
  }
  composing = target;
  editing = null;
  select(id);
  openDialog();
}

function editComment(id) {
  if (plugin.readonly || !comments.some((c) => c.id === id)) return;
  composing = null;
  editing = id;
  openDialog();
}

/** Where the open dialog's pin is: a new comment's, or the edited one's. */
function dialogTarget() {
  if (editing !== null) return comments.find((c) => c.id === editing) || null;
  return composing;
}

function openDialog() {
  const target = dialogTarget();
  if (!target) return;
  const edited = editing !== null ? target : null;
  const frame = frames.find((f) => f.id === target.frame);
  const dialog = $("comment-dialog");
  dialog.innerHTML =
    where(target, frame) +
    `<textarea id="compose-body" placeholder="What should change here?" aria-label="Comment">${edited ? esc(edited.body) : ""}</textarea>` +
    `<div class="foot"><span class="hint"><kbd>Enter</kbd> to ${edited ? "save" : "add"}, <kbd>Esc</kbd> to cancel</span>` +
    `<button type="button" class="pinrail-btn pinrail-btn-ghost" id="compose-cancel">Cancel</button>` +
    `<button type="button" class="pinrail-btn pinrail-btn-primary" id="compose-save">${edited ? "Save" : "Comment"}</button></div>`;
  dialog.hidden = false;
  renderPins();
  placeDialog();
  const area = $("compose-body");
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

/** Keeps the dialog beside its pin as the canvas moves, inside the viewport. */
function placeDialog() {
  const dialog = $("comment-dialog");
  if (dialog.hidden) return;
  const target = dialogTarget();
  const m = target && mounted.get(target.frame);
  if (!m) return;
  const vp = $("viewport").getBoundingClientRect();
  const b = m.body.getBoundingClientRect();
  const px = b.left - vp.left + target.x * b.width;
  const py = b.top - vp.top + target.y * b.height;
  const w = dialog.offsetWidth;
  const h = dialog.offsetHeight;
  let left = px + 18;
  if (left + w > vp.width - 8) left = px - w - 18;
  dialog.style.left = `${Math.max(8, Math.min(left, vp.width - w - 8))}px`;
  dialog.style.top = `${Math.max(8, Math.min(py - 24, vp.height - h - 8))}px`;
}

function closeDialog() {
  composing = null;
  editing = null;
  $("comment-dialog").hidden = true;
  renderPins();
}

function saveDialog() {
  const body = $("compose-body").value.trim();
  if (!body) return;
  if (editing !== null) {
    const comment = comments.find((c) => c.id === editing);
    if (comment) comment.body = body;
  } else if (composing) {
    const id = comments.reduce((max, c) => Math.max(max, c.id), 0) + 1;
    comments.push({ id, ...composing, body });
  }
  closeDialog();
  changed();
}

$("comment-dialog").addEventListener("click", (event) => {
  if (event.target.id === "compose-save") saveDialog();
  else if (event.target.id === "compose-cancel") closeDialog();
});
$("comment-dialog").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeDialog();
  } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.target.id === "compose-body") {
    event.preventDefault();
    saveDialog();
  }
});

/** The pins on each frame, numbered as the list numbers them. */
function renderPins() {
  const shown = shownComments();
  for (const [id, m] of mounted) {
    const pins = m.el.querySelector(".pins");
    let html = "";
    shown.forEach((c, i) => {
      if (c.frame === id)
        html += `<button type="button" class="pin" data-pin="${c.id}" style="left:${c.x * 100}%;top:${c.y * 100}%" aria-label="Comment ${i + 1}">${i + 1}</button>`;
    });
    if (composing && composing.frame === id)
      html += `<span class="pin draft" style="left:${composing.x * 100}%;top:${composing.y * 100}%">+</span>`;
    pins.innerHTML = html;
  }
}

function toggleFavorite(group) {
  if (plugin.readonly) return;
  favorite = favorite === group ? null : group;
  changed();
}

$("world").addEventListener("click", (event) => {
  const star = event.target.closest("[data-favorite]");
  if (star) return toggleFavorite(star.dataset.favorite);
  const pin = event.target.closest("[data-pin]");
  if (!pin) return;
  const id = Number(pin.dataset.pin);
  if (plugin.readonly) {
    const card = $("list").querySelector(`[data-comment="${id}"]`);
    if (card) {
      card.scrollIntoView({ block: "nearest" });
      flash(card);
    }
  } else {
    editComment(id);
  }
});

function changed() {
  saveDraft();
  renderSide();
  renderPins();
  renderHeads();
}

function saveDraft() {
  plugin.draft({ comments, statuses, verdict, favorite });
  plugin.handOverLabel(statusLabel());
}

function statusLabel() {
  const n = comments.length;
  const counted = (n ? ` · ${n} comment${n === 1 ? "" : "s"}` : "") + (favorite ? ` · ★ ${favorite}` : "");
  if (verdict === "approve") return `Approve${counted}`;
  if (verdict === "request_changes") return `Request changes${counted}`;
  return "Choose a verdict";
}

/** Where a comment is: its frame, and the element or the point. */
function where(c, frame) {
  const place = c.selector
    ? `${c.selector}${c.snippet ? ` “${c.snippet}”` : ""}`
    : `at ${Math.round(c.x * 100)} % across, ${Math.round(c.y * 100)} % down`;
  const name = frame ? `<span class="frame-name">${esc(frame.title)}</span>` : "";
  return `<div class="where">${name}<span class="el" title="${esc(place)}">${esc(place)}</span></div>`;
}

// ------------------------------------------------------------------ the side

function renderSide() {
  const readonly = plugin.readonly;
  const shown = shownComments();
  let html = "";
  if (!readonly && !shown.length) {
    html += `<div class="pinrail-empty">Choose Comment (C), then click a frame where something should change. Mark each frame approved or in need of changes.</div>`;
  }
  const grouped = groupsOf().some(Boolean);
  for (const f of frames) {
    const status = statusOf(f.id);
    const group = f.group || "";
    if (grouped && frames.find((g) => (g.group || "") === group) === f) {
      html +=
        `<div class="group-row"><span class="group-name">${esc(group || "Other")}</span>` +
        (payload.variants && group
          ? `<button type="button" class="star" data-favorite="${esc(group)}"></button>`
          : "") +
        `</div>`;
    }
    html +=
      `<div class="frame-row" data-row="${esc(f.id)}"><div class="row-head">` +
      `<button type="button" class="name" data-goto="${esc(f.id)}" title="Show this frame">${esc(f.title)}</button>`;
    if (readonly) {
      html += `<span class="marked ${status}">${status === "approved" ? "Approved" : status === "changes" ? "Needs changes" : "Not marked"}</span>`;
    } else {
      html +=
        `<div class="marks" role="group" aria-label="Mark ${esc(f.title)}">` +
        `<button type="button" class="approved" data-mark="approved" data-for="${esc(f.id)}" aria-pressed="${status === "approved"}" title="Approved">${Pinrail.icon("check")}</button>` +
        `<button type="button" class="changes" data-mark="changes" data-for="${esc(f.id)}" aria-pressed="${status === "changes"}" title="Needs changes">${Pinrail.icon("file-pen-line")}</button></div>`;
    }
    html += `</div>`;
    if (f.notes) html += `<div class="notes">${Pinrail.markdown(f.notes)}</div>`;
    shown.forEach((c, i) => {
      if (c.frame !== f.id) return;
      html += `<div class="card" data-comment="${c.id}"><span class="num">${i + 1}</span>${where(c, null)}<p class="body">${esc(c.body)}</p>`;
      if (!readonly)
        html += `<div class="actions"><button type="button" data-edit="${c.id}">Edit</button><button type="button" data-delete="${c.id}">Delete</button></div>`;
      html += `</div>`;
    });
    html += `</div>`;
  }
  const previous = plugin.previous && plugin.previous.decision ? plugin.previous.decision.data : null;
  if (previous && previous.comments && previous.comments.length) {
    const titleOf = (id) => (frames.find((f) => f.id === id) || { title: id }).title;
    html +=
      `<details class="previous"><summary>The previous round: ${previous.comments.length} comment${previous.comments.length === 1 ? "" : "s"}</summary>` +
      previous.comments
        .map(
          (c, i) =>
            `<div class="card"><span class="num">${i + 1}</span>${where(c, { title: titleOf(c.frame) })}<p class="body">${esc(c.body)}</p></div>`,
        )
        .join("") +
      `</details>`;
  }
  $("list").innerHTML = html;
  renderStars();
  renderVerdict(readonly);
  const n = shown.length;
  const marked = frames.filter((f) => statusOf(f.id) !== "unmarked").length;
  $("tally").innerHTML =
    `<b>${frames.length}</b> frame${frames.length === 1 ? "" : "s"}, <b>${marked}</b> marked, <b>${n}</b> comment${n === 1 ? "" : "s"}`;
  plugin.handOverLabel(statusLabel());
}

function renderVerdict(readonly) {
  const d = decided();
  if (readonly) {
    $("verdict").innerHTML = d
      ? `<div class="decided"><b>${d.verdict === "approve" ? "Approved" : "Changes requested"}</b></div>`
      : `<div class="decided pinrail-dim">Closed without a decision (${esc(plugin.review.status)})</div>`;
    return;
  }
  $("verdict").innerHTML =
    `<div class="choices" role="group" aria-label="Verdict">` +
    `<button type="button" class="pinrail-btn approve" data-verdict="approve" aria-pressed="${verdict === "approve"}">${Pinrail.icon("check")} Approve</button>` +
    `<button type="button" class="pinrail-btn changes" data-verdict="request_changes" aria-pressed="${verdict === "request_changes"}">${Pinrail.icon("file-pen-line")} Request changes</button></div>` +
    `<div class="pinrail-errors" id="errors"></div>`;
}

$("list").addEventListener("click", (event) => {
  const t = event.target.closest("button, .card");
  if (!t) return;
  if (t.dataset.favorite !== undefined) return toggleFavorite(t.dataset.favorite);
  if (t.dataset.goto) return goToFrame(t.dataset.goto);
  if (t.dataset.mark) {
    const id = t.dataset.for;
    statuses[id] = statuses[id] === t.dataset.mark ? undefined : t.dataset.mark;
    if (!statuses[id]) delete statuses[id];
    return changed();
  }
  if (t.dataset.edit) {
    const comment = comments.find((c) => c.id === Number(t.dataset.edit));
    if (comment) showComment(comment);
    return editComment(Number(t.dataset.edit));
  }
  if (t.dataset.delete) {
    const id = Number(t.dataset.delete);
    if (editing === id) closeDialog();
    comments = comments.filter((c) => c.id !== id);
    return changed();
  }
  // a comment in the list: to its pin
  if (t.dataset.comment) {
    const comment = shownComments().find((c) => c.id === Number(t.dataset.comment));
    if (comment) showComment(comment);
  }
});

function showComment(comment) {
  goToFrame(comment.frame);
  const pin = $("world").querySelector(`[data-pin="${comment.id}"]`);
  flash(pin);
}

$("verdict").addEventListener("click", (event) => {
  const button = event.target.closest("[data-verdict]");
  if (!button) return;
  verdict = verdict === button.dataset.verdict ? null : button.dataset.verdict;
  saveDraft();
  renderVerdict(false);
});

// ------------------------------------------------------------------ hand-over

function handOver() {
  if (!verdict) {
    $("errors").textContent = "Choose Approve or Request changes first.";
    return;
  }
  if (!$("comment-dialog").hidden && $("compose-body").value.trim()) saveDialog();
  return {
    verdict,
    ...(payload.variants && favorite && groupsOf().includes(favorite) ? { favorite } : {}),
    frames: frames.map((f) => ({ id: f.id, status: statuses[f.id] || "unmarked" })),
    comments: [...comments].sort(byPlace),
  };
}

// ------------------------------------------------------------------ HTML frames

// An HTML frame lives in a shadow root of the view's own document, so the
// view can point at its elements. Its styles stay scoped; nothing in it
// runs; its links and forms go nowhere.

const STAND_IN = "canvas-body";

/** Parses the document and mounts it under `host`; its root and the body stand-in. */
function mount(host, html) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  root.replaceChildren();
  const doc = new DOMParser().parseFromString(html, "text/html");

  // a page as a browser starts one, not the view's theme
  const base = document.createElement("style");
  base.textContent = `:host { all: initial; display: block; color: #000; font-family: system-ui, sans-serif; }
    .${STAND_IN} { position: relative; min-height: 100%; height: 100%; box-sizing: border-box; }`;
  root.append(base);
  for (const style of doc.querySelectorAll("style")) {
    const scoped = document.createElement("style");
    scoped.textContent = rescope(style.textContent || "");
    root.append(scoped);
  }

  const inner = document.createElement("div");
  inner.className = STAND_IN;
  for (const { name, value } of Array.from(doc.body.attributes)) {
    if (name === "class") inner.className = `${STAND_IN} ${value}`;
    else if (name === "style" || name.startsWith("data-")) inner.setAttribute(name, value);
  }
  const rootStyle = doc.documentElement.getAttribute("style");
  if (rootStyle) inner.setAttribute("style", `${rootStyle};${inner.getAttribute("style") || ""}`);
  inertDocument(doc);
  inner.append(...Array.from(doc.body.childNodes).map((node) => document.adoptNode(node)));
  root.append(inner);

  root.addEventListener("click", (event) => {
    const target = event.composedPath()[0];
    if (target && target.closest && target.closest("a, button, input[type=submit]")) event.preventDefault();
  });
  root.addEventListener("submit", (event) => event.preventDefault());
  return { root, inner };
}

// what runs code, loads a document or reaches out: none of it belongs in a
// mockup the person looks at
const DROPPED = "script, link, meta, base, iframe, frame, frameset, object, embed, applet, portal";
const ADDRESSES = new Set(["href", "xlink:href", "src", "action", "formaction", "data", "poster", "background"]);
const NAVIGATIONS = new Set(["href", "xlink:href", "action", "formaction"]);

/** Takes out everything in the document that could run. */
function inertDocument(doc) {
  for (const el of doc.querySelectorAll(DROPPED)) el.remove();
  for (const el of doc.querySelectorAll("animate, set")) {
    if (/href/i.test(el.getAttribute("attributeName") || "")) el.remove();
  }
  for (const el of doc.querySelectorAll("*")) {
    for (const { name, value } of Array.from(el.attributes)) {
      const key = name.toLowerCase();
      // eslint-disable-next-line no-control-regex -- browsers ignore these in a scheme
      const scheme = value.replace(/[\u0000- ]/g, "").toLowerCase();
      const runs = /^(javascript|vbscript):/.test(scheme) || (NAVIGATIONS.has(key) && scheme.startsWith("data:"));
      if (key.startsWith("on") || key === "srcdoc" || (ADDRESSES.has(key) && runs)) el.removeAttribute(name);
    }
  }
}

/** `:root`, `html` and `body` in the frame's CSS become the stand-in. */
function rescope(css) {
  return css
    .replace(/(^|[\s,}>~+]):root(?=[\s,{.#:[])/g, `$1.${STAND_IN}`)
    .replace(/(^|[\s,}>~+])html\s*,\s*body(?=[\s,{.#:[])/g, `$1.${STAND_IN}`)
    .replace(/(^|[\s,}>~+])body(?=[\s,{.#:[])/g, `$1.${STAND_IN}`)
    .replace(/(^|[\s,}>~+])html(?=[\s,{.#:[])/g, `$1.${STAND_IN}`);
}

/** A CSS selector for `el`, unique in the frame and relative to its body,
 *  the way DevTools copies one. */
function selectorFor(el, root, inner) {
  const unique = (s) => {
    try {
      return root.querySelectorAll(s).length === 1;
    } catch {
      return false;
    }
  };
  const idOf = (e) => (e.id ? `#${CSS.escape(e.id)}` : null);
  const own = idOf(el);
  if (own && unique(own)) return own;
  const testId = el.getAttribute("data-testid");
  if (testId && unique(`[data-testid="${CSS.escape(testId)}"]`)) return `[data-testid="${CSS.escape(testId)}"]`;
  const parts = [];
  let cur = el;
  while (cur && cur !== inner) {
    const parent = cur.parentElement;
    if (cur !== el) {
      const anchor = idOf(cur);
      if (anchor && unique(anchor)) return [anchor, ...parts].join(" > ");
    }
    let part = cur.localName;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.localName === cur.localName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = parent;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts.slice(i).join(" > ");
    if (unique(candidate)) return candidate;
  }
  return parts.join(" > ");
}

function snippetOf(el, max = 80) {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Something to pin to: an element of the frame, not its body stand-in. */
function commentable(el, inner) {
  if (!el || el.nodeType !== 1 || el === inner || !inner.contains(el)) return null;
  return el;
}

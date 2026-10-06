// A trade an agent proposes: the market's candlesticks with the entry,
// the stop and the targets drawn in, the figures of the proposal, and the
// agent's reasoning, with the fair value gaps of the timeframe shown. The
// person approves or rejects it, with a note, and can drag the stop and the
// targets to where they should be.
"use strict";

const esc = Pinrail.escape;
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ state

let payload = null;
/** the payload's candles, and the ones on the chart, merged to the timeframe */
let raw = [];
let candles = [];
/** the timeframe on the chart, in minutes */
let minutes = 0;
/** the fair value gaps of the candles on the chart, and whether they show */
let gaps = [];
let showGaps = true;
let verdict = null;
let note = "";
/** the stop and targets the person moved, or null where they did not */
let stop = null;
let targets = null;
/** the candles on screen, as indices: [from, to) */
let view = { from: 0, to: 0 };
/** the candle under the pointer, or null */
let hover = null;

const plugin = Pinrail.connect({
  onInit({ review, draft }) {
    const d = (plugin.readonly ? review.decision && review.decision.data : draft) || {};
    verdict = d.verdict || null;
    note = d.note || "";
    stop = typeof d.stop_loss === "number" ? d.stop_loss : null;
    targets = Array.isArray(d.take_profit) ? d.take_profit : null;
    showGaps = !(draft && draft.gaps === false);
    load(review, draft && draft.timeframe);
  },
  onViolations(errors) {
    $("errors").textContent = errors.map((e) => `${e.path || "/"}: ${e.message}`).join("\n");
  },
  onCollect() {
    return handOver();
  },
  onAppearance() {
    draw();
  },
});

const md = window.markdownit({ html: false, linkify: true, typographer: false });

function load(review, timeframe) {
  payload = review.payload || {};
  raw = (payload.candles || []).map((c) => ({ ...c, time: Date.parse(c.t) }));
  const ins = payload.instrument || {};

  $("symbol").textContent = ins.symbol || "";
  $("name").textContent = ins.name || "";
  $("source").textContent = payload.source || "";
  const last = raw[raw.length - 1];
  const first = raw[0];
  if (last) {
    $("last").textContent = price(last.c);
    const delta = last.c - first.c;
    $("change").textContent = `${signed(delta)} (${signed((delta / first.c) * 100, 2)} %) over the chart`;
    $("change").className = `change ${delta >= 0 ? "up" : "down"}`;
  }
  $("reasoning").innerHTML = md.render(String(payload.reasoning || ""));
  $("shell").dataset.readonly = String(plugin.readonly);

  const base = minutesOf(payload.timeframe);
  const offered = timeframes(base);
  const chosen = offered.find((t) => t.label === timeframe) || offered[0];
  setTimeframe(chosen ? chosen.minutes : base);
  renderGapsButton();
  renderOrder();
  renderVerdict();
  plugin.handOverLabel(statusLabel());
}

// ------------------------------------------------------------------ the order

/** The order as it stands: the proposal, with the stop and targets the person moved. */
function order() {
  const p = (payload && payload.proposal) || {};
  const o = { ...p };
  if (stop !== null) o.stop_loss = stop;
  if (targets !== null) o.take_profit = targets;
  return o;
}

function stopMoved() {
  return stop !== null && stop !== (payload.proposal || {}).stop_loss;
}

function targetsMoved() {
  const proposed = (payload.proposal || {}).take_profit || [];
  return targets !== null && targets.some((t, i) => t !== proposed[i]);
}

function renderOrder() {
  $("proposal").innerHTML = proposalHtml(order(), raw[raw.length - 1]);
  $("reset-lines").disabled = !stopMoved() && !targetsMoved();
}

function resetLines() {
  stop = null;
  targets = null;
  changed();
}

// ------------------------------------------------------------------ numbers

function decimals() {
  const d = payload && payload.instrument && payload.instrument.decimals;
  return Number.isInteger(d) ? d : 2;
}

function price(x, d = decimals()) {
  return x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function signed(x, d = decimals()) {
  return (x > 0 ? "+" : x < 0 ? "−" : "") + price(Math.abs(x), d);
}

/** The price the order fills at: its entry, or the last close for a market order. */
function entryOf(p, last) {
  if (typeof p.entry === "number") return p.entry;
  return last ? last.c : null;
}

/** How many times the risk a target makes, for a buy or a sell. */
function multiple(p, entry, target) {
  if (typeof p.stop_loss !== "number" || entry === null) return null;
  const risk = Math.abs(entry - p.stop_loss);
  if (!risk) return null;
  const dir = p.side === "sell" ? -1 : 1;
  return ((target - entry) * dir) / risk;
}

const UTC = { timeZone: "UTC" };
function when(iso) {
  const d = new Date(iso);
  return (
    d.toLocaleString("en-US", {
      ...UTC,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " UTC"
  );
}

function proposalHtml(p, last) {
  const ins = payload.instrument || {};
  const entry = entryOf(p, last);
  const side = p.side || "hold";
  const size = p.size ? `${p.size.quantity} ${p.size.unit}` : "";
  const what = [
    side === "close" ? "Close" : side === "hold" ? "Hold" : side === "buy" ? "Buy" : "Sell",
    size,
    ins.symbol,
  ]
    .filter(Boolean)
    .join(" ");
  const away = (x) => (entry === null ? "" : `${signed(x - entry)}`);

  let rows = "";
  const row = (label, value, cls = "", extra = "") => {
    rows += extra
      ? `<dt>${esc(label)}</dt><dd class="${cls}">${value}</dd><dd class="away">${extra}</dd>`
      : `<dt>${esc(label)}</dt><dd class="${cls} wide">${value}</dd>`;
  };
  if (p.order_type) {
    const order = p.order_type[0].toUpperCase() + p.order_type.slice(1);
    row(
      `${order} entry`,
      typeof p.entry === "number" ? price(p.entry) : "at market",
      "entry",
      typeof p.entry === "number" && last ? `${signed(p.entry - last.c)} from last` : "",
    );
  }
  const proposed = payload.proposal || {};
  const was = (now, then) =>
    typeof then === "number" && now !== then ? `<span class="was">was ${price(then)}</span>` : "";
  if (typeof p.stop_loss === "number")
    row("Stop", price(p.stop_loss), "stop", was(p.stop_loss, proposed.stop_loss) + away(p.stop_loss));
  (p.take_profit || []).forEach((t, i) => {
    const r = multiple(p, entry, t);
    row(
      p.take_profit.length > 1 ? `Target ${i + 1}` : "Target",
      price(t),
      "target",
      `${was(t, (proposed.take_profit || [])[i])}${away(t)}${r === null ? "" : ` · ${r.toFixed(1)} R`}`,
    );
  });
  if (size) row("Size", esc(size));
  if (typeof p.stop_loss === "number" && entry !== null && p.size && !/^(lots?|contracts?)$/i.test(p.size.unit)) {
    const loss = Math.abs(entry - p.stop_loss) * p.size.quantity;
    row("Loss at the stop", `${price(loss, 2)} ${esc(ins.quote_currency || "")}`.trim());
  }
  if (typeof p.risk_percent === "number") row("Risk", `${p.risk_percent} % of the account`);
  if (p.valid_until) row("Valid until", esc(when(p.valid_until)));

  const confidence =
    typeof payload.confidence === "number"
      ? `<div class="confidence" id="confidence"><span>Confidence</span><div class="bar"><span style="width:${Math.round(payload.confidence * 100)}%"></span></div><b>${Math.round(payload.confidence * 100)} %</b></div>`
      : "";
  return (
    `<div class="headline"><span class="side-badge ${esc(side)}">${esc(side)}</span><span class="what">${esc(what)}</span></div>` +
    `<dl class="figures" id="figures">${rows}</dl>${confidence}`
  );
}

// ------------------------------------------------------------------ timeframes

const MINUTE = 60_000;
const DAY = 1440;
const TIMEFRAMES = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "4h", minutes: 240 },
  { label: "1D", minutes: DAY },
  { label: "1W", minutes: 7 * DAY },
];
const RANGES = [
  { label: "1D", ms: DAY * MINUTE },
  { label: "3D", ms: 3 * DAY * MINUTE },
  { label: "1W", ms: 7 * DAY * MINUTE },
  { label: "1M", ms: 30 * DAY * MINUTE },
  { label: "3M", ms: 91 * DAY * MINUTE },
  { label: "1Y", ms: 365 * DAY * MINUTE },
];

/** "15m", "1h", "4h", "1d" or "1w", in minutes; the spacing of the candles when it is none of those. */
function minutesOf(timeframe) {
  const m = /^(\d+)\s*(m|min|h|d|w)$/i.exec(String(timeframe || "").trim());
  if (m) return Number(m[1]) * { m: 1, min: 1, h: 60, d: DAY, w: 7 * DAY }[m[2].toLowerCase()];
  return raw.length > 1 ? Math.max(1, Math.round((raw[1].time - raw[0].time) / MINUTE)) : 60;
}

/** The candles merged into buckets of `size` minutes, in UTC; weeks start on Monday. */
function merge(size) {
  const ms = size * MINUTE;
  // the epoch was a Thursday: shift weeks to start on Monday
  const shift = size % (7 * DAY) === 0 ? 3 * DAY * MINUTE : 0;
  const out = [];
  for (const c of raw) {
    const time = c.time - ((c.time + shift) % ms);
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      if (typeof c.v === "number") last.v = (last.v || 0) + c.v;
    } else {
      out.push({ time, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    }
  }
  return out;
}

/** The timeframes the candles can be shown in: theirs, and longer ones that still make five candles. */
function timeframes(base) {
  const own = TIMEFRAMES.find((t) => t.minutes === base) || { label: payload.timeframe || `${base}m`, minutes: base };
  const longer = TIMEFRAMES.filter((t) => t.minutes > base && t.minutes % base === 0 && merge(t.minutes).length >= 5);
  return [own, ...longer];
}

/**
 * The fair value gaps: three candles where the first and the third do not
 * overlap, leaving a gap beside the middle one. A gap is filled when a later
 * candle trades back through all of it.
 */
function fairValueGaps(cs) {
  const out = [];
  for (let i = 2; i < cs.length; i++) {
    const a = cs[i - 2];
    const c = cs[i];
    let gap = null;
    if (a.h < c.l) gap = { kind: "bullish", bottom: a.h, top: c.l };
    if (a.l > c.h) gap = { kind: "bearish", bottom: c.h, top: a.l };
    if (!gap) continue;
    gap.at = i - 1;
    gap.filled = null;
    for (let j = i + 1; j < cs.length; j++) {
      if (gap.kind === "bullish" ? cs[j].l <= gap.bottom : cs[j].h >= gap.top) {
        gap.filled = j;
        break;
      }
    }
    out.push(gap);
  }
  return out;
}

function renderGapsButton() {
  $("show-gaps").setAttribute("aria-pressed", String(showGaps));
}

function setTimeframe(size) {
  minutes = size;
  candles = size === minutesOf(payload.timeframe) ? raw : merge(size);
  gaps = fairValueGaps(candles);
  view = defaultView();
  $("timeframes").innerHTML = timeframes(minutesOf(payload.timeframe))
    .map(
      (t) =>
        `<button type="button" data-timeframe="${esc(t.label)}" aria-pressed="${t.minutes === minutes}">${esc(t.label)}</button>`,
    )
    .join("");
  const span = raw.length ? raw[raw.length - 1].time - raw[0].time : 0;
  $("ranges").innerHTML =
    RANGES.filter((r) => r.ms < span)
      .map((r) => `<button type="button" data-range="${r.label}">${r.label}</button>`)
      .join("") + `<button type="button" data-range="all">All</button>`;
  hover = null;
  draw();
}

/** Shows the candles of the last `ms`, or all of them. */
function showRange(ms) {
  const n = candles.length;
  if (ms === null) return setView(0, n, 1);
  const since = candles[n - 1].time - ms;
  let from = n - 1;
  while (from > 0 && candles[from - 1].time > since) from--;
  setView(from, n, 1);
}

$("timeframes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeframe]");
  if (!button) return;
  const t = timeframes(minutesOf(payload.timeframe)).find((x) => x.label === button.dataset.timeframe);
  if (t) {
    setTimeframe(t.minutes);
    saveDraft();
  }
});
$("show-gaps").addEventListener("click", () => {
  showGaps = !showGaps;
  renderGapsButton();
  saveDraft();
  draw();
});
$("ranges").addEventListener("click", (event) => {
  const button = event.target.closest("[data-range]");
  if (!button) return;
  const r = RANGES.find((x) => x.label === button.dataset.range);
  showRange(r ? r.ms : null);
});

// ------------------------------------------------------------------ the chart

const canvas = $("canvas");
const chart = $("chart");
const AXIS_RIGHT = 70;
const AXIS_BOTTOM = 22;
const TOP = 26;
/** empty candles to the right of the last one, where the order's zones show */
const FUTURE = 10;

function colors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name, fallback) => s.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--pinrail-bg", "#fff"),
    text: v("--pinrail-text", "#111"),
    dim: v("--pinrail-dim", "#666"),
    faint: v("--pinrail-faint", "#999"),
    border: v("--pinrail-border", "#ddd"),
    up: v("--pinrail-success", "#16a34a"),
    down: v("--pinrail-danger", "#dc2626"),
    accent: v("--pinrail-accent", "#2563eb"),
    panel: v("--pinrail-bg-panel", "#f6f6f6"),
    mono: v("--pinrail-mono", "monospace"),
  };
}

/** The lines the chart draws: the order's, then the levels. */
function lines() {
  const p = order();
  const out = [];
  if (typeof p.entry === "number") out.push({ price: p.entry, label: "Entry", kind: "entry" });
  if (typeof p.stop_loss === "number") out.push({ price: p.stop_loss, label: "Stop", kind: "stop", name: "stop" });
  (p.take_profit || []).forEach((t, i) =>
    out.push({
      price: t,
      label: p.take_profit.length > 1 ? `T${i + 1}` : "Target",
      kind: "target",
      name: `t${i + 1}`,
      index: i,
    }),
  );
  for (const l of (payload && payload.levels) || []) out.push({ price: l.price, label: l.label, kind: "level" });
  return out;
}

/** Where everything goes, for the candles on screen. */
function layout() {
  const w = chart.clientWidth;
  const h = chart.clientHeight;
  const plot = { x: 0, y: TOP, w: w - AXIS_RIGHT, h: h - TOP - AXIS_BOTTOM };
  const shown = candles.slice(view.from, view.to);
  const slots = view.to - view.from + (view.to === candles.length ? FUTURE : 0);
  const step = plot.w / Math.max(slots, 1);

  let lo = Infinity,
    hi = -Infinity;
  for (const c of shown) {
    lo = Math.min(lo, c.l);
    hi = Math.max(hi, c.h);
  }
  // the order's own prices always show, the other levels when they are near
  for (const l of lines()) {
    if (l.kind !== "level" || (l.price >= lo - (hi - lo) * 0.25 && l.price <= hi + (hi - lo) * 0.25)) {
      lo = Math.min(lo, l.price);
      hi = Math.max(hi, l.price);
    }
  }
  if (!(hi > lo)) {
    hi = (hi || 1) * 1.001;
    lo = (lo || 1) * 0.999;
  }
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  // while a line is dragged the scale holds still under the pointer
  if (moving) ({ lo, hi } = moving);
  const volumeH = plot.h * 0.16;
  let vmax = 0;
  for (const c of shown) vmax = Math.max(vmax, c.v || 0);

  return {
    w,
    h,
    plot,
    step,
    lo,
    hi,
    volumeH,
    vmax,
    x: (i) => plot.x + (i - view.from + 0.5) * step,
    y: (p) => plot.y + ((hi - p) / (hi - lo)) * plot.h,
    index: (px) => view.from + Math.floor((px - plot.x) / step),
    price: (py) => hi - ((py - plot.y) / plot.h) * (hi - lo),
  };
}

function niceStep(range, count) {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/** A time on the axis: the day where a new day starts, the hour otherwise. */
function timeLabel(t, prev) {
  const d = new Date(t);
  if (minutes >= DAY || prev === null || new Date(prev).toISOString().slice(0, 10) !== d.toISOString().slice(0, 10)) {
    return d.toLocaleString("en-US", { ...UTC, month: "short", day: "numeric" });
  }
  return d.toLocaleString("en-US", { ...UTC, hour: "2-digit", minute: "2-digit", hour12: false });
}

function draw() {
  if (!payload || !candles.length) return;
  const dpr = window.devicePixelRatio || 1;
  const L = layout();
  if (L.w <= 0 || L.h <= 0) return;
  canvas.width = Math.round(L.w * dpr);
  canvas.height = Math.round(L.h * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const C = colors();
  const font = (size, weight = 400) => `${weight} ${size}px ${C.mono}`;
  const { plot } = L;
  g.clearRect(0, 0, L.w, L.h);

  // the price grid and axis
  g.font = font(10.5);
  g.textBaseline = "middle";
  const pStep = niceStep(L.hi - L.lo, Math.max(3, Math.floor(plot.h / 56)));
  for (let p = Math.ceil(L.lo / pStep) * pStep; p <= L.hi; p += pStep) {
    const y = Math.round(L.y(p)) + 0.5;
    g.strokeStyle = C.border;
    g.lineWidth = 1;
    g.globalAlpha = 0.6;
    g.beginPath();
    g.moveTo(plot.x, y);
    g.lineTo(plot.x + plot.w, y);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = C.faint;
    g.textAlign = "left";
    g.fillText(price(p, pStep < 1 ? decimals() : 0), plot.x + plot.w + 8, y);
  }

  // the time axis, a label every 90 pixels or so
  const every = Math.max(1, Math.ceil(90 / L.step));
  g.textAlign = "center";
  g.textBaseline = "top";
  g.fillStyle = C.faint;
  let prev = null;
  for (let i = view.from; i < view.to; i++) {
    const x = L.x(i);
    // a label every few candles, and none cut off at the left edge
    if (i % every !== 0 || x < plot.x + 24) continue;
    g.strokeStyle = C.border;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, plot.y);
    g.lineTo(Math.round(x) + 0.5, plot.y + plot.h);
    g.stroke();
    g.globalAlpha = 1;
    g.fillText(timeLabel(candles[i].time, prev), x, plot.y + plot.h + 6);
    prev = candles[i].time;
  }

  g.save();
  g.beginPath();
  g.rect(plot.x, plot.y - TOP, plot.w, plot.h + TOP);
  g.clip();

  // the order's zones, from the last candle on: risk to the stop, reward to the last target
  const p = order();
  const entry = entryOf(p, candles[candles.length - 1]);
  if (entry !== null && view.to === candles.length) {
    const x0 = L.x(candles.length - 1) + L.step / 2;
    const x1 = plot.x + plot.w;
    const zone = (to, color) => {
      g.fillStyle = color;
      g.globalAlpha = 0.1;
      g.fillRect(x0, Math.min(L.y(entry), L.y(to)), x1 - x0, Math.abs(L.y(entry) - L.y(to)));
      g.globalAlpha = 1;
    };
    if (typeof p.stop_loss === "number") zone(p.stop_loss, C.down);
    const targets = p.take_profit || [];
    if (targets.length) zone(targets[targets.length - 1], C.up);
  }

  // the fair value gaps, from their middle candle until a candle fills them;
  // the ones still open reach the right edge
  if (showGaps) {
    for (const gap of gaps) {
      const end = gap.filled === null ? view.to + FUTURE : gap.filled;
      if (end < view.from || gap.at >= view.to) continue;
      const x0 = Math.max(plot.x, L.x(gap.at) - L.step / 2);
      const x1 = gap.filled === null ? plot.x + plot.w : L.x(gap.filled) + L.step / 2;
      const y0 = L.y(gap.top);
      const y1 = L.y(gap.bottom);
      const color = gap.kind === "bullish" ? C.up : C.down;
      g.fillStyle = color;
      g.globalAlpha = gap.filled === null ? 0.16 : 0.07;
      g.fillRect(x0, y0, x1 - x0, Math.max(1, y1 - y0));
      if (gap.filled === null && y1 - y0 >= 11) {
        g.globalAlpha = 0.8;
        g.font = font(9.5, 600);
        g.textAlign = "left";
        g.textBaseline = "middle";
        // past the third candle, clear of the three that make the gap
        g.fillText("FVG", Math.max(x0, L.x(gap.at + 1) + L.step / 2) + 4, (y0 + y1) / 2);
      }
      g.globalAlpha = 1;
    }
  }

  // the volume, along the bottom
  if (L.vmax > 0) {
    for (let i = view.from; i < view.to; i++) {
      const c = candles[i];
      if (!c.v) continue;
      const vh = (c.v / L.vmax) * L.volumeH;
      g.fillStyle = c.c >= c.o ? C.up : C.down;
      g.globalAlpha = 0.18;
      g.fillRect(L.x(i) - L.step * 0.35, plot.y + plot.h - vh, L.step * 0.7, vh);
    }
    g.globalAlpha = 1;
  }

  // the candles
  const body = Math.max(1, Math.min(L.step * 0.7, 18));
  for (let i = view.from; i < view.to; i++) {
    const c = candles[i];
    const color = c.c >= c.o ? C.up : C.down;
    const x = Math.round(L.x(i)) + 0.5;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, L.y(c.h));
    g.lineTo(x, L.y(c.l));
    g.stroke();
    const top = L.y(Math.max(c.o, c.c));
    const height = Math.max(1, Math.abs(L.y(c.o) - L.y(c.c)));
    g.fillRect(x - body / 2, top, body, height);
  }

  // where the agent put the stop and targets the person moved, faintly
  const tone = { entry: C.accent, stop: C.down, target: C.up, level: C.faint };
  const proposed = payload.proposal || {};
  const ghosts = [];
  if (stopMoved()) ghosts.push({ price: proposed.stop_loss, kind: "stop" });
  if (targets !== null)
    (proposed.take_profit || []).forEach((t, i) => {
      if (targets[i] !== t) ghosts.push({ price: t, kind: "target" });
    });
  for (const l of ghosts) {
    const y = Math.round(L.y(l.price)) + 0.5;
    g.strokeStyle = tone[l.kind];
    g.globalAlpha = 0.45;
    g.lineWidth = 1;
    g.setLineDash([2, 4]);
    g.beginPath();
    g.moveTo(plot.x, y);
    g.lineTo(plot.x + plot.w, y);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  // the order's lines and the levels, labelled at the left
  const at = {};
  for (const l of lines()) {
    const y = Math.round(L.y(l.price)) + 0.5;
    if (l.name) at[l.name] = y;
    if (y < plot.y || y > plot.y + plot.h) continue;
    g.strokeStyle = tone[l.kind];
    g.lineWidth = l.kind === "level" ? 1 : moving && moving.line.name === l.name ? 2.5 : 1.5;
    g.setLineDash(l.kind === "level" ? [4, 4] : []);
    g.beginPath();
    g.moveTo(plot.x, y);
    g.lineTo(plot.x + plot.w, y);
    g.stroke();
    g.setLineDash([]);
    g.font = font(10.5, l.kind === "level" ? 400 : 600);
    g.textAlign = "left";
    g.textBaseline = "bottom";
    g.fillStyle = tone[l.kind];
    g.fillText(l.label, plot.x + 6, y - 2);
  }
  g.restore();

  // tags on the price axis: the order's prices and the last close
  const tag = (value, color, fg = "#fff") => {
    const y = L.y(value);
    if (y < plot.y - 8 || y > plot.y + plot.h + 8) return;
    g.fillStyle = color;
    g.fillRect(plot.x + plot.w + 1, y - 8, AXIS_RIGHT - 2, 16);
    g.fillStyle = fg;
    g.font = font(10.5, 600);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(price(value), plot.x + plot.w + 6, y);
  };
  for (const l of lines()) if (l.kind !== "level") tag(l.price, tone[l.kind]);
  const last = candles[candles.length - 1];
  if (view.to === candles.length) {
    const y = Math.round(L.y(last.c)) + 0.5;
    g.strokeStyle = C.dim;
    g.setLineDash([2, 3]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(L.x(candles.length - 1), y);
    g.lineTo(plot.x + plot.w, y);
    g.stroke();
    g.setLineDash([]);
    tag(last.c, C.text, C.bg);
  }

  // the crosshair
  if (hover !== null && hover.i >= view.from && hover.i < view.to) {
    const x = Math.round(L.x(hover.i)) + 0.5;
    g.strokeStyle = C.dim;
    g.setLineDash([3, 3]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, plot.y);
    g.lineTo(x, plot.y + plot.h);
    g.stroke();
    if (hover.y >= plot.y && hover.y <= plot.y + plot.h) {
      g.beginPath();
      g.moveTo(plot.x, hover.y + 0.5);
      g.lineTo(plot.x + plot.w, hover.y + 0.5);
      g.stroke();
      g.setLineDash([]);
      tag(L.hi - ((hover.y - plot.y) / plot.h) * (L.hi - L.lo), C.dim);
    }
    g.setLineDash([]);
  }

  canvas.dataset.candles = String(view.to - view.from);
  chart.dataset.lines = JSON.stringify(at);
  chart.dataset.gaps = JSON.stringify(showGaps ? gaps : []);
  readout(hover !== null ? candles[hover.i] : last);
}

function readout(c) {
  if (!c) return;
  const d = new Date(c.time).toLocaleString(
    "en-US",
    minutes >= DAY
      ? { ...UTC, month: "short", day: "numeric" }
      : { ...UTC, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false },
  );
  const cls = c.c >= c.o ? "up" : "down";
  $("readout").innerHTML =
    `<span>${esc(d)} UTC</span>` +
    `<span>O <b>${price(c.o)}</b></span><span>H <b>${price(c.h)}</b></span>` +
    `<span>L <b>${price(c.l)}</b></span><span>C <b class="${cls}">${price(c.c)}</b></span>` +
    (typeof c.v === "number" ? `<span>V <b>${c.v.toLocaleString("en-US")}</b></span>` : "");
}

// ------------------------------------------------------------------ zoom, pan and the lines

function defaultView() {
  const n = candles.length;
  return { from: Math.max(0, n - 120), to: n };
}

/** Shows candles [from, to), at least `least` of them. */
function setView(from, to, least = 5) {
  const n = candles.length;
  const width = Math.min(n, Math.max(Math.min(least, n), Math.round(to - from)));
  from = Math.max(0, Math.min(n - width, Math.round(from)));
  view = { from, to: from + width };
  draw();
}

function zoom(factor, anchor = view.to) {
  const width = view.to - view.from;
  const next = Math.round(width * factor);
  const share = (anchor - view.from) / width;
  setView(anchor - next * share, anchor - next * share + next);
}

function pan(candlesBy) {
  setView(view.from + candlesBy, view.to + candlesBy, view.to - view.from);
}

/** The stop or target line within a few pixels of `py`, if the person may move it. */
function lineAt(L, py) {
  if (plugin.readonly) return null;
  let best = null;
  for (const l of lines()) {
    if (!l.name) continue;
    const d = Math.abs(L.y(l.price) - py);
    if (d <= 6 && (!best || d < best.d)) best = { ...l, d };
  }
  return best;
}

/** Moves a line to `value`, kept on its side of the entry and rounded to the instrument's decimals. */
function moveLine(line, value) {
  const p = order();
  const entry = entryOf(p, raw[raw.length - 1]);
  const tick = Math.pow(10, -decimals());
  const below = (line.kind === "stop") === (p.side !== "sell");
  if (entry !== null) value = below ? Math.min(value, entry - tick) : Math.max(value, entry + tick);
  value = Math.max(tick, Number(value.toFixed(decimals())));
  if (line.kind === "stop") stop = value;
  else {
    targets = [...(targets || (payload.proposal || {}).take_profit || [])];
    targets[line.index] = value;
  }
}

/** a pan in progress: where it started */
let drag = null;
/** a line being moved, and the scale it is moved on */
let moving = null;

chart.addEventListener("pointermove", (event) => {
  const rect = chart.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const L = layout();
  if (moving) {
    moveLine(moving.line, L.price(py));
    renderOrder();
  } else if (drag) {
    pan(Math.round((drag.x - px) / L.step) - (view.from - drag.from));
  }
  chart.classList.toggle("on-line", !!moving || (!drag && !!lineAt(L, py)));
  const i = L.index(px);
  hover = i >= view.from && i < view.to && px < L.plot.w ? { i, y: py } : null;
  draw();
});
chart.addEventListener("pointerleave", () => {
  hover = null;
  draw();
});
chart.addEventListener("pointerdown", (event) => {
  const rect = chart.getBoundingClientRect();
  const L = layout();
  const line = lineAt(L, event.clientY - rect.top);
  if (line) moving = { line, lo: L.lo, hi: L.hi };
  else {
    drag = { x: event.clientX - rect.left, ...view };
    chart.classList.add("panning");
  }
  chart.setPointerCapture(event.pointerId);
});
chart.addEventListener("pointerup", () => {
  if (moving) {
    moving = null;
    changed();
  }
  drag = null;
  chart.classList.remove("panning");
});
chart.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const L = layout();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY))
      return pan(Math.round(event.deltaX / L.step) || Math.sign(event.deltaX));
    const anchor = Math.min(view.to, Math.max(view.from, L.index(event.clientX - chart.getBoundingClientRect().left)));
    zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, anchor);
  },
  { passive: false },
);
chart.addEventListener("dblclick", () => {
  view = defaultView();
  draw();
});
$("zoom-in").addEventListener("click", () => zoom(1 / 1.5));
$("zoom-out").addEventListener("click", () => zoom(1.5));
$("reset-lines").addEventListener("click", resetLines);
new ResizeObserver(() => draw()).observe(chart);

// ------------------------------------------------------------------ the verdict

function statusLabel() {
  const p = (payload && payload.proposal) || {};
  const ins = (payload && payload.instrument) || {};
  const trade = `${p.side || "trade"} ${ins.symbol || ""}`.trim();
  const moved =
    stopMoved() && targetsMoved()
      ? " · stop and targets moved"
      : stopMoved()
        ? " · stop moved"
        : targetsMoved()
          ? " · targets moved"
          : "";
  if (verdict === "approve") return `Approve ${trade}${moved}`;
  if (verdict === "reject") return `Reject ${trade}${moved}`;
  return "Choose approve or reject";
}

function renderVerdict() {
  if (plugin.readonly) {
    const decision = plugin.review && plugin.review.decision;
    const d = decision ? decision.data : null;
    $("verdict").innerHTML = d
      ? `<div class="decided"><b class="${d.verdict === "approve" ? "up" : "down"}">${d.verdict === "approve" ? "Approved" : "Rejected"}</b>` +
        (decision.decided_by ? ` <span class="by">by ${esc(decision.decided_by)}</span>` : "") +
        (d.note ? `<p class="body">${esc(d.note)}</p>` : "") +
        `</div>`
      : `<div class="decided by">Closed without a decision (${esc(plugin.review.status)})</div>`;
    return;
  }
  $("verdict").innerHTML =
    `<div class="choices" role="group" aria-label="Verdict">` +
    `<button type="button" class="pinrail-btn approve" data-verdict="approve" aria-pressed="${verdict === "approve"}">Approve</button>` +
    `<button type="button" class="pinrail-btn reject" data-verdict="reject" aria-pressed="${verdict === "reject"}">Reject</button></div>` +
    `<textarea id="note" placeholder="A note for the agent (optional)" aria-label="Note">${esc(note)}</textarea>` +
    `<div class="pinrail-errors" id="errors"></div>`;
}

function saveDraft() {
  if (plugin.readonly) return;
  const label = (TIMEFRAMES.find((t) => t.minutes === minutes) || {}).label;
  plugin.draft({
    verdict,
    note,
    timeframe: label,
    gaps: showGaps ? undefined : false,
    stop_loss: stopMoved() ? stop : undefined,
    take_profit: targetsMoved() ? targets : undefined,
  });
  plugin.handOverLabel(statusLabel());
}

function changed() {
  if (!stopMoved()) stop = null;
  if (!targetsMoved()) targets = null;
  saveDraft();
  renderOrder();
  draw();
}

$("verdict").addEventListener("click", (event) => {
  const button = event.target.closest("[data-verdict]");
  if (!button) return;
  verdict = verdict === button.dataset.verdict ? null : button.dataset.verdict;
  saveDraft();
  renderVerdict();
});
$("verdict").addEventListener("input", (event) => {
  if (event.target.id === "note") {
    note = event.target.value;
    saveDraft();
  }
});

function handOver() {
  if (!verdict) {
    $("errors").textContent = "Choose Approve or Reject first.";
    return;
  }
  const data = { verdict };
  if (stopMoved()) data.stop_loss = stop;
  if (targetsMoved()) data.take_profit = targets;
  if (note.trim()) data.note = note.trim();
  return data;
}

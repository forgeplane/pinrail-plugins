import lottie from "./vendor/lottie.js";

const esc = Pinrail.escape;
const ACTIONS = { favorite: "Favourite", keep: "Keep", drop: "Drop" };
const KEYS = { favorite: "f", keep: "s", drop: "x" };
const SPEEDS = [0.25, 0.5, 0.75, 1];
const CSS_FPS = 60;
const MAX_COMPARE = 4;
const STAGE = { width: 400, height: 240, background: "#ffffff" };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let P = null;
let V = [];
const S = { sel: 0, compare: false, picked: [], verdicts: {}, armed: false, composing: null, range: null, lit: null };
const T = { t: 0, playing: false, speed: 1, loop: true, started: false };
const info = {}; // variant id -> what its animation turned out to be, once read
let lottieJson = {}; // variant id -> Promise of its Lottie data
const live = new Set(); // every player on the page, to route messages from CSS frames
let staged = []; // the players on the stage: { id, p }
let stageKey = "";
const thumbs = new Map(); // variant id -> the player in the rail
let preview = null; // the rail thumbnail playing under the pointer
let drag = null;

/* ---------- CSS variants: a sandboxed frame each ----------

   The agent's markup and styles go into a frame of their own, sandboxed with
   scripts allowed so that ours can drive the clock, and a policy inside it
   that runs only the script carrying this frame's nonce: the agent's
   scripts, inline handlers and javascript: links do not run. The view talks
   to the frame by message, the only way into it. */

function control() {
  let at = 0;
  let ready = false;
  const known = new Set();
  const classes = (el) =>
    Array.from(el.classList)
      .slice(0, 2)
      .map((c) => "." + CSS.escape(c))
      .join("");
  const part = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const base = classes(el) || el.localName;
    const parent = el.parentElement;
    if (!parent) return base;
    const kin = Array.from(parent.children).filter((c) => c.localName === el.localName);
    const twins = kin.filter((c) => (classes(c) || c.localName) === base);
    return twins.length > 1 ? `${base}:nth-of-type(${kin.indexOf(el) + 1})` : base;
  };
  const selector = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      parts.unshift(part(n));
      if (parts[0].startsWith("#") || parts.length >= 4) break;
      try {
        if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      } catch {
        break;
      }
    }
    return parts.join(" > ") || el.localName;
  };
  // A finished animation drops out of getAnimations(), so every one seen is kept to seek back into.
  const seek = (t) => {
    at = t;
    if (!ready) return;
    for (const a of document.getAnimations()) known.add(a);
    for (const a of known) {
      a.pause();
      a.currentTime = t;
    }
  };
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || !m || m.motion !== 1) return;
    if (m.type === "seek") seek(m.t);
  });
  addEventListener("DOMContentLoaded", () => {
    ready = true;
    seek(at);
    const tracks = Array.from(known, (a) => {
      const effect = a.effect;
      const timing = effect.getTiming();
      const computed = effect.getComputedTiming();
      return {
        selector: effect.target ? selector(effect.target) + (effect.pseudoElement || "") : "",
        animation: a.animationName || a.id || "",
        delay: Number(timing.delay) || 0,
        duration: typeof computed.duration === "number" ? computed.duration : 0,
        iterations: Number.isFinite(computed.iterations) ? computed.iterations : null,
        direction: timing.direction || "normal",
      };
    });
    parent.postMessage({ motion: 1, type: "ready", tracks }, "*");
  });
}
const CONTROL = `(${control.toString()})();`;

const colour = (c) => (typeof c === "string" && /^[#\w\s(),.%/-]+$/.test(c) ? c : STAGE.background);

function docFor(v, nonce) {
  const st = stageOf(v);
  const doc = new DOMParser().parseFromString(String(v.html || ""), "text/html");
  doc
    .querySelectorAll(
      "script, noscript, iframe, frame, frameset, object, embed, link, meta, base, template, plaintext, xmp",
    )
    .forEach((n) => n.remove());
  const styles = Array.from(doc.querySelectorAll("style"), (s) => {
    s.remove();
    return s.textContent;
  });
  const css = [...styles, v.css || ""].join("\n").replace(/<\/style/gi, "<\\/style");
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}'">` +
    `<script nonce="${nonce}">${CONTROL}</` +
    "script>" +
    `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:grid;place-items:center;background:${colour(st.background)}}</style>` +
    `<style>${css}</style></head><body>${doc.body.innerHTML}</body></html>`
  );
}

function cssPlayer(v) {
  const el = document.createElement("iframe");
  el.setAttribute("sandbox", "allow-scripts");
  el.setAttribute("tabindex", "-1");
  el.setAttribute("aria-hidden", "true");
  el.title = v.name;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  el.srcdoc = docFor(v, nonce);
  let resolve;
  const p = {
    el,
    v,
    t: null,
    ready: new Promise((ok) => {
      resolve = ok;
    }),
    seek(t) {
      if (p.t === t) return;
      p.t = t;
      el.contentWindow?.postMessage({ motion: 1, type: "seek", t }, "*");
    },
    // the frame reports once it has read its animations, and again if it is ever reloaded
    heard(tracks) {
      const t = p.t;
      p.t = null;
      if (t != null) p.seek(t);
      resolve(cssInfo(v, tracks));
    },
    destroy() {
      live.delete(p);
      el.remove();
    },
  };
  return p;
}

function cssInfo(v, tracks) {
  const list = (Array.isArray(tracks) ? tracks : [])
    .filter((k) => k && k.duration >= 0)
    .map((k) => ({
      label: k.animation ? `${k.selector} · ${k.animation}` : k.selector,
      selector: String(k.selector || ""),
      animation: String(k.animation || ""),
      delay: k.delay,
      period: k.duration,
      direction: k.direction,
      iterations: k.iterations,
      start: Math.max(0, k.delay),
      end: k.iterations == null ? Infinity : k.delay + k.duration * k.iterations,
    }))
    .filter((k) => k.end > 0);
  const natural = Math.max(0, ...list.map((k) => (k.end === Infinity ? Math.max(0, k.delay) + k.period : k.end)));
  return {
    kind: "css",
    fps: CSS_FPS,
    duration: v.duration_ms || natural || 1000,
    loops: v.loops ?? list.some((k) => k.end === Infinity),
    tracks: list,
    empty: list.length === 0,
  };
}

addEventListener("message", (e) => {
  const m = e.data;
  if (!m || m.motion !== 1 || m.type !== "ready") return;
  for (const p of live) if (p.el.contentWindow === e.source && p.heard) return p.heard(m.tracks);
});

/* ---------- Lottie variants: lottie-web's SVG player, in the view ---------- */

function lottieData(v) {
  if (!lottieJson[v.id]) {
    lottieJson[v.id] = (async () => {
      const name = Pinrail.attachmentName(v.lottie);
      const data = name ? JSON.parse(new TextDecoder().decode(await plugin.attachment(name))) : v.lottie;
      if (!data || !Array.isArray(data.layers) || !(Number(data.fr) > 0))
        throw new Error("it is not a Lottie animation");
      return data;
    })();
  }
  return lottieJson[v.id];
}

function lottiePlayer(v) {
  const el = document.createElement("div");
  el.className = "lottie";
  const p = {
    el,
    v,
    t: null,
    anim: null,
    fr: 60,
    frames: 1,
    seek(t) {
      p.t = t;
      if (p.anim) p.anim.goToAndStop(Math.max(0, Math.min((t / 1000) * p.fr, p.frames - 1)), true);
    },
    destroy() {
      live.delete(p);
      p.anim?.destroy();
      el.remove();
    },
  };
  p.ready = lottieData(v).then((data) => {
    const i = lottieInfo(v, data);
    p.fr = i.fps;
    p.frames = i.frames;
    p.anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: false,
      autoplay: false,
      animationData: structuredClone(data),
      rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
    });
    p.seek(p.t ?? 0);
    return i;
  });
  return p;
}

function lottieInfo(v, data) {
  const fr = Number(data.fr);
  const ip = Number(data.ip) || 0;
  const op = Number(data.op) > ip ? Number(data.op) : ip + fr;
  const ms = (f) => ((f - ip) / fr) * 1000;
  const tracks = data.layers
    .filter((l) => l && !l.hd)
    .slice(0, 12)
    .map((l) => {
      const name = String(l.nm || `Layer ${l.ind ?? ""}`).trim();
      return {
        label: name,
        layer: name,
        start: Math.max(0, ms(Number(l.ip ?? ip))),
        end: Math.min(ms(op), ms(Number(l.op ?? op))),
      };
    });
  return {
    kind: "lottie",
    fps: fr,
    firstFrame: ip,
    frames: op - ip,
    duration: v.duration_ms || ms(op),
    loops: !!v.loops,
    tracks,
    empty: false,
    size: { width: Number(data.w) || STAGE.width, height: Number(data.h) || STAGE.height },
  };
}

/* ---------- players ---------- */

function makePlayer(v) {
  const p = v.lottie ? lottiePlayer(v) : cssPlayer(v);
  live.add(p);
  p.ready.then(
    (i) => learn(v.id, i),
    (error) => learn(v.id, { error }),
  );
  return p;
}

function learn(id, i) {
  if (info[id] && !info[id].error) return;
  const first = !info[id];
  info[id] = i;
  if (!first) return;
  const idx = V.findIndex((v) => v.id === id);
  if (idx >= 0) patchPick(idx);
  if (shownIds().includes(id)) {
    renderHead();
    renderTimeline();
    renderTransport();
    fitAll();
    push(true);
  }
  const th = thumbs.get(id);
  if (th) {
    fitPlayer(th, 1);
    th.seek(posterOf(id));
  }
}

function stageOf(v) {
  const size = info[v.id]?.size;
  const st = { ...STAGE, ...(size || {}), ...(P.stage || {}), ...(v.stage || {}) };
  if (size && !v.stage?.width && !P.stage?.width) Object.assign(st, size);
  return st;
}

function mount(box, v, p) {
  const fit = document.createElement("div");
  fit.className = "fit";
  fit.append(p.el);
  box.prepend(fit);
  p.box = box;
  p.fit = fit;
}

function fitPlayer(p, max) {
  if (!p.box || !p.fit) return;
  const st = stageOf(p.v);
  const bw = p.box.clientWidth;
  const bh = p.box.clientHeight;
  if (!bw || !bh) return;
  const k = Math.min(bw / st.width, bh / st.height, max);
  p.fit.style.width = `${st.width}px`;
  p.fit.style.height = `${st.height}px`;
  p.fit.style.transform = `translate(${(bw - st.width * k) / 2}px, ${(bh - st.height * k) / 2}px) scale(${k})`;
  p.box.style.background = colour(st.background);
  const label = p.box.querySelector(".scale");
  if (label) label.textContent = `${st.width}×${st.height} · ${Math.round(k * 100)}%`;
}

function fitAll() {
  for (const { p } of staged) fitPlayer(p, 2);
  for (const p of thumbs.values()) fitPlayer(p, 1);
}

const posterOf = (id) => {
  const v = V.find((x) => x.id === id);
  const d = info[id]?.duration ?? 1000;
  return v?.poster_ms != null ? Math.min(v.poster_ms, d) : d / 2;
};

/* ---------- time ---------- */

const cur = () => V[S.sel];
const durOf = (id) => info[id]?.duration ?? 1000;
const shownIds = () => (S.compare ? V.filter((v) => S.picked.includes(v.id)).map((v) => v.id) : [cur().id]);
const span = () => Math.max(1, ...shownIds().map(durOf));
const frameMs = () => 1000 / (info[cur().id]?.fps || CSS_FPS);
// a variant's own time at the stage's time: a loop comes round again, anything else holds its end
function localTime(id, t) {
  const i = info[id];
  if (!i) return t;
  return i.loops ? t % i.duration : Math.min(t, i.duration);
}

function push(force) {
  for (const { id, p } of staged) {
    if (force) p.t = null;
    p.seek(localTime(id, T.t));
  }
  const head = document.querySelector(".playhead");
  if (head) head.style.left = `${(T.t / span()) * 100}%`;
  updateClock();
}

function seekTo(t) {
  T.t = Math.max(0, Math.min(span(), t));
  push();
}

function play() {
  const r = S.range;
  if (r && (T.t < r.a || T.t >= r.b)) T.t = r.a;
  else if (!r && T.t >= span() - 0.5) T.t = 0;
  T.playing = true;
  T.started = true;
  renderTransport();
}
function pause() {
  if (!T.playing) return;
  T.playing = false;
  renderTransport();
}
const togglePlay = () => (T.playing ? pause() : play());
function step(ms) {
  pause();
  seekTo(Math.round((T.t + ms) * 1000) / 1000);
}
function setSpeed(s) {
  T.speed = s;
  renderTransport();
}
function nudgeSpeed(dir) {
  const i = SPEEDS.indexOf(T.speed);
  setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]);
}

let last = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = last ? Math.min(100, now - last) : 0;
  last = now;
  if (T.playing && P) {
    let t = T.t + dt * T.speed;
    const lo = S.range ? S.range.a : 0;
    const hi = S.range ? S.range.b : span();
    if (t >= hi) {
      if (T.loop) t = lo + ((t - lo) % Math.max(1, hi - lo));
      else {
        t = hi;
        T.playing = false;
        renderTransport();
      }
    }
    T.t = t;
    push();
  }
  if (preview) {
    const d = info[preview.id]?.duration ?? 1000;
    preview.p.seek((now - preview.start) % d);
  }
}

/* ---------- formatting ---------- */

const ms = (x) => (x >= 10000 ? `${(x / 1000).toFixed(2).replace(/0$/, "")} s` : `${Math.round(x)} ms`);
const pct = (f) => `${Math.round(f * 100)}%`;
const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;
function when(c) {
  const t = c.end_ms != null ? `${c.start_ms}–${ms(c.end_ms)}` : ms(c.start_ms);
  const f = c.end != null ? `${Math.round(c.start * 100)}–${pct(c.end)}` : pct(c.start);
  const fr =
    c.frame != null ? (c.end_frame != null ? ` · frames ${c.frame}–${c.end_frame}` : ` · frame ${c.frame}`) : "";
  return `${t} · ${f}${fr}`;
}
function during(c) {
  const a = c.active || [];
  const one = (x) =>
    x.layer ??
    `${x.selector} ${x.animation}${x.from != null ? ` ${pct(x.from)}` : ""}${x.to != null ? `${x.from != null ? "" : " "}→${pct(x.to)}` : ""}`;
  return a.length ? `during ${a.slice(0, 3).map(one).join(", ")}${a.length > 3 ? ` +${a.length - 3}` : ""}` : "";
}
function kindOf(id) {
  const v = V.find((x) => x.id === id);
  const i = info[id];
  const kind = v.lottie ? "Lottie" : "CSS";
  if (!i) return `${kind} · …`;
  if (i.error) return `${kind} · can't read it`;
  return [kind, v.lottie ? `${Math.round(i.fps)} fps` : null, ms(i.duration), i.loops ? "loops" : null]
    .filter(Boolean)
    .join(" · ");
}

/* ---------- where each comment sits in the animation ---------- */

function progress(k, t) {
  const active = k.period * (k.iterations ?? Infinity);
  let local = t - k.delay;
  let it;
  let f;
  if (Number.isFinite(active) && local >= active) {
    it = Math.max(0, Math.ceil(k.iterations) - 1);
    f = k.iterations - it;
  } else {
    it = Math.floor(local / k.period);
    f = (local - it * k.period) / k.period;
  }
  const odd = it % 2 === 1;
  if (
    k.direction === "reverse" ||
    (k.direction === "alternate" && odd) ||
    (k.direction === "alternate-reverse" && !odd)
  )
    f = 1 - f;
  return round(f, 2);
}
// the cycle a moment falls in, counting a cycle's first instant (from) or its last (to) as its own
const cycleFrom = (k, t) => Math.floor((t - k.delay) / k.period);
const cycleTo = (k, t) => Math.ceil((t - k.delay) / k.period) - 1;

function activeAt(i, a, b) {
  const out = [];
  for (const k of i?.tracks || []) {
    const atA = a >= k.start && a < k.end;
    if (b == null ? !atA : !(k.start < b && k.end > a)) continue;
    if (i.kind === "lottie") {
      out.push({ layer: k.layer });
      continue;
    }
    const item = { selector: k.selector, animation: k.animation };
    if (k.period > 0) {
      if (atA) item.from = progress(k, a);
      const atB = b != null && b > k.start && b <= k.end;
      if (atB && cycleFrom(k, Math.max(a, k.start)) === cycleTo(k, b)) item.to = progress(k, b);
    }
    out.push(item);
  }
  return out.slice(0, 12);
}

/* ---------- verdicts and the decision ---------- */

const verdictOf = (id) => S.verdicts[id] || null;
const commentsOf = (id) => verdictOf(id)?.comments || [];
const shown = (v) => (v && !v.action && (v.comments || []).length ? { ...v, action: "keep" } : v);
const chip = (v) =>
  v && v.action && (ACTIONS[v.action] || v.action === "undecided")
    ? `<span class="verdict-chip v-${v.action}">${v.action === "favorite" ? "★ " : ""}${ACTIONS[v.action] || "Undecided"}</span>`
    : `<span class="verdict-chip v-none">—</span>`;

function decisionData() {
  const decisions = [];
  const undecided = [];
  for (const v of V) {
    const x = verdictOf(v.id);
    const note = x?.note ? x.note.trim() : "";
    const comments = x?.comments || [];
    const action = x?.action || (comments.length ? "keep" : null);
    if (!action) {
      undecided.push(v.id);
      continue;
    }
    const d = { id: v.id, action };
    if (note) d.note = note;
    if (comments.length) {
      d.duration_ms = x.duration_ms ?? Math.round(durOf(v.id));
      d.comments = comments.map((c) => {
        const out = { start_ms: c.start_ms };
        if (c.end_ms != null) out.end_ms = c.end_ms;
        out.start = c.start;
        if (c.end != null) out.end = c.end;
        if (c.frame != null) out.frame = c.frame;
        if (c.end_frame != null) out.end_frame = c.end_frame;
        if (c.active?.length) out.active = c.active;
        if (c.compared_with?.length) out.compared_with = c.compared_with;
        out.note = c.note;
        return out;
      });
    }
    decisions.push(d);
  }
  return { decisions, undecided };
}

function status() {
  if (plugin.readonly) return;
  const d = decisionData();
  const fav = d.decisions.find((x) => x.action === "favorite");
  const kept = d.decisions.filter((x) => x.action === "keep").length;
  const dropped = d.decisions.filter((x) => x.action === "drop").length;
  const parts = [];
  if (fav) parts.push(`★ ${V.find((v) => v.id === fav.id)?.name ?? fav.id}`);
  if (kept) parts.push(`${kept} kept`);
  if (dropped) parts.push(`${dropped} dropped`);
  const label = S.armed
    ? `Hand over with ${d.undecided.length} undecided`
    : parts.length
      ? `Hand over: ${parts.join(", ")}`
      : "Hand over";
  plugin.handOverLabel(label);
}

const save = () => {
  S.armed = false;
  plugin.draft({ verdicts: S.verdicts });
};

function setVerdict(action) {
  if (plugin.readonly) return;
  const id = cur().id;
  const now = verdictOf(id);
  if (now?.action === action) S.verdicts[id] = { ...now, action: null };
  else {
    if (action === "favorite") {
      for (const [other, x] of Object.entries(S.verdicts))
        if (x.action === "favorite") S.verdicts[other] = { ...x, action: "keep" };
    }
    S.verdicts[id] = { ...(now || {}), action };
  }
  save();
  refresh();
}

function handOver() {
  const data = decisionData();
  if (data.undecided.length && !S.armed) {
    S.armed = true;
    status();
    return;
  }
  return data;
}

/* ---------- comments ---------- */

function startComment() {
  if (plugin.readonly || !P) return;
  const id = cur().id;
  const i = info[id];
  if (!i || i.error) return;
  pause();
  const d = i.duration;
  let a;
  let b = null;
  if (S.range) {
    a = localTime(id, S.range.a);
    b = Math.min(a + (S.range.b - S.range.a), d);
    if (b - a < 1) b = null;
  } else a = localTime(id, T.t);
  S.composing = { id, a: Math.round(a), b: b == null ? null : Math.round(b) };
  renderBelow();
  const box = document.getElementById("comment-note");
  box?.focus({ preventScroll: true });
  box?.scrollIntoView({ block: "nearest" });
}

function addComment() {
  const note = document.getElementById("comment-note")?.value.trim();
  const c0 = S.composing;
  if (!note || !c0) return;
  const i = info[c0.id];
  const d = i.duration;
  const c = { start_ms: c0.a, start: round(c0.a / d, 3) };
  if (c0.b != null) {
    c.end_ms = c0.b;
    c.end = round(c0.b / d, 3);
  }
  if (i.kind === "lottie") {
    c.frame = Math.round(i.firstFrame + (c0.a / 1000) * i.fps);
    if (c0.b != null) c.end_frame = Math.round(i.firstFrame + (c0.b / 1000) * i.fps);
  }
  const active = activeAt(i, c0.a, c0.b);
  if (active.length) c.active = active;
  if (S.compare) {
    const others = shownIds().filter((x) => x !== c0.id);
    if (others.length) c.compared_with = others;
  }
  c.note = note;
  const x = verdictOf(c0.id) || { action: null };
  const comments = [...(x.comments || []), c].sort((p, q) => p.start_ms - q.start_ms);
  S.verdicts[c0.id] = { ...x, duration_ms: Math.round(d), comments };
  S.composing = null;
  S.range = null;
  S.lit = `${c0.id}:${comments.indexOf(c)}`;
  save();
  refresh();
}

function cancelComment() {
  S.composing = null;
  renderBelow();
}

function goTo(id, n) {
  const c = commentsOf(id)[n];
  if (!c) return;
  if (id !== cur().id) focusVariant(V.findIndex((v) => v.id === id));
  pause();
  S.range = c.end_ms != null ? { a: c.start_ms, b: c.end_ms } : null;
  S.lit = `${id}:${n}`;
  seekTo(c.start_ms);
  renderTimeline();
  renderBelow();
  renderTransport();
}

function removeComment(n) {
  const id = cur().id;
  const x = verdictOf(id);
  S.verdicts[id] = { ...x, comments: x.comments.filter((_, k) => k !== n) };
  S.lit = null;
  save();
  refresh();
}

function markIn() {
  const t = T.t;
  const b = S.range && S.range.b > t ? S.range.b : span();
  S.range = b - t >= 1 ? { a: t, b } : null;
  renderTimeline();
  renderTransport();
}
function markOut() {
  const t = T.t;
  const a = S.range && S.range.a < t ? S.range.a : 0;
  S.range = t - a >= 1 ? { a, b: t } : null;
  renderTimeline();
  renderTransport();
}

/* ---------- choosing and comparing ---------- */

function select(i) {
  S.sel = (i + V.length) % V.length;
  S.composing = null;
  S.lit = null;
  if (S.compare && !S.picked.includes(cur().id)) {
    if (S.picked.length < MAX_COMPARE) S.picked = [...S.picked, cur().id];
    else S.compare = false;
  }
  layout();
  document.querySelector(`[data-pick="${S.sel}"]`)?.scrollIntoView({ block: "nearest" });
}
// move through what is on the stage: every variant, or those side by side
function stepVariant(dir) {
  if (!S.compare) return select(S.sel + dir);
  const ids = shownIds();
  const k = (ids.indexOf(cur().id) + dir + ids.length) % ids.length;
  select(V.findIndex((v) => v.id === ids[k]));
}
const focusVariant = (i) => select(i);

function toggleCompare() {
  S.compare = !S.compare;
  if (S.compare) {
    const id = cur().id;
    if (!S.picked.includes(id)) S.picked = [id, ...S.picked].slice(0, MAX_COMPARE);
    if (S.picked.length < 2) S.picked = V.slice(0, MAX_COMPARE).map((v) => v.id);
    if (!S.picked.includes(id)) S.picked[S.picked.length - 1] = id;
  }
  S.composing = null;
  layout();
}

function togglePair(id, on) {
  if (on && !S.picked.includes(id) && S.picked.length < MAX_COMPARE) S.picked = [...S.picked, id];
  if (!on && S.picked.length > 2) S.picked = S.picked.filter((x) => x !== id);
  if (!S.picked.includes(cur().id)) S.sel = V.findIndex((v) => v.id === S.picked[0]);
  layout();
}

/* ---------- rendering ---------- */

function renderShell() {
  document.getElementById("app").innerHTML = `
    <div class="top" id="top"></div>
    <div class="work">
      <nav class="rail" id="rail" aria-label="Variants">
        <p class="rail-label">${V.length} variants</p>
        ${V.map(
          (v, i) => `
          <div class="pick" role="button" tabindex="0" data-pick="${i}" aria-current="false">
            <div class="thumb" data-thumb="${esc(v.id)}"></div>
            <label class="pair"><input type="checkbox" data-pair="${esc(v.id)}"> Compare</label>
            <span class="pick-name">${esc(v.name)}</span><span class="pick-chip"></span>
            <span class="pick-meta"></span>
          </div>`,
        ).join("")}
      </nav>
      <main class="sheet" id="sheet"><div class="sheet-inner">
        ${P.notes ? `<div class="notes">${Pinrail.markdown(P.notes)}</div>` : ""}
        <header class="variant-head" id="head"></header>
        <div class="reasoning" id="reasoning"></div>
        <section class="stage" id="stage" aria-label="Stage"></section>
        <section class="transport" id="transport" aria-label="Playback"></section>
        <section class="tl" id="timeline" aria-label="Timeline"></section>
        <section class="below" id="below"></section>
      </div></main>
    </div>`;
  for (const v of V) {
    const p = makePlayer(v);
    thumbs.set(v.id, p);
    mount(document.querySelector(`[data-thumb="${CSS.escape(v.id)}"]`), v, p);
    p.ready.then(
      () => {
        fitPlayer(p, 1);
        p.seek(posterOf(v.id));
      },
      () => {
        p.box.insertAdjacentHTML("beforeend", `<div class="broken">can't read it</div>`);
      },
    );
  }
  new ResizeObserver(() => fitAll()).observe(document.getElementById("stage"));
  new ResizeObserver(() => fitAll()).observe(document.getElementById("rail"));
}

function renderTop() {
  const d = decisionData();
  const count = (a) => d.decisions.filter((x) => x.action === a).length;
  document.getElementById("top").innerHTML = `
    <h1>${esc(plugin.review.title || "Motion review")}</h1>
    ${P.subject ? `<span class="subject">${esc(P.subject)}</span>` : ""}
    <div class="tally" aria-live="polite">
      <span><b>${count("favorite")}</b> favourite</span><span><b>${count("keep")}</b> kept</span><span><b>${count("drop")}</b> dropped</span><span><b>${d.undecided.length}</b> undecided</span>
    </div>`;
}

function patchPick(i) {
  const v = V[i];
  const el = document.querySelector(`[data-pick="${i}"]`);
  if (!el) return;
  el.setAttribute("aria-current", String(i === S.sel));
  el.querySelector(".pick-chip").innerHTML = chip(shown(verdictOf(v.id)));
  el.querySelector(".pick-meta").textContent = kindOf(v.id);
  const box = el.querySelector("[data-pair]");
  box.checked = S.picked.includes(v.id);
  box.disabled = box.checked ? S.picked.length <= 2 : S.picked.length >= MAX_COMPARE;
}

function renderRail() {
  document.getElementById("rail").classList.toggle("comparing", S.compare);
  V.forEach((_, i) => patchPick(i));
}

function renderHead() {
  const v = cur();
  const prev = previousVerdict(plugin.previous, v.id);
  const i = info[v.id];
  document.getElementById("head").innerHTML = `
    <h2 id="variant-name">${esc(v.name)}</h2>
    <span class="variant-id">${esc(v.id)} · ${S.sel + 1} of ${V.length} · ${esc(kindOf(v.id))}</span>
    ${
      S.compare
        ? `<span class="variant-id">side by side with ${esc(
            shownIds()
              .filter((x) => x !== v.id)
              .map((x) => V.find((y) => y.id === x).name)
              .join(", "),
          )}</span>`
        : ""
    }
    ${i?.empty ? `<div class="previous">No CSS animations were found in this variant: it plays nothing.</div>` : ""}
    ${prev ? `<div class="previous">Last round: ${chip(prev)} ${prev.note ? "— " + esc(prev.note) : ""}</div>` : ""}`;
  const r = document.getElementById("reasoning");
  r.innerHTML = v.reasoning ? Pinrail.markdown(v.reasoning) : "";
  r.hidden = !v.reasoning;
}

function buildStage() {
  const ids = shownIds();
  const key = `${S.compare ? "c" : "s"}:${ids.join(",")}`;
  const el = document.getElementById("stage");
  if (key !== stageKey) {
    stageKey = key;
    for (const { p } of staged) p.destroy();
    staged = [];
    el.className = `stage${S.compare ? " compare" : ""}`;
    el.innerHTML = ids
      .map((id) => {
        const v = V.find((x) => x.id === id);
        return `<div class="pane" data-pane="${esc(id)}">
          <div class="pane-head"><b>${esc(v.name)}</b><span class="mono">${esc(kindOf(id))}</span><span class="pane-chip"></span></div>
          <div class="box" role="img" aria-label="${esc(v.name)}, animated"><span class="scale"></span></div>
        </div>`;
      })
      .join("");
    for (const id of ids) {
      const v = V.find((x) => x.id === id);
      const p = makePlayer(v);
      const box = el.querySelector(`[data-pane="${CSS.escape(id)}"] .box`);
      mount(box, v, p);
      staged.push({ id, p });
      p.ready.then(
        () => {
          fitPlayer(p, 2);
          push(true);
        },
        (e) => {
          box.insertAdjacentHTML(
            "beforeend",
            `<div class="broken">This animation could not be read: ${esc(String(e?.message || e))}</div>`,
          );
        },
      );
      fitPlayer(p, 2);
    }
    push(true);
  }
  for (const pane of el.querySelectorAll(".pane")) {
    const id = pane.dataset.pane;
    pane.setAttribute("aria-current", String(id === cur().id));
    pane.querySelector(".pane-chip").innerHTML = chip(shown(verdictOf(id)));
    pane.querySelector(".pane-head .mono").textContent = kindOf(id);
  }
}

function renderTransport() {
  const el = document.getElementById("transport");
  if (!el || !P) return;
  const ro = plugin.readonly;
  const r = S.range;
  const target = r ? `on ${Math.round(r.a)}–${ms(r.b)}` : `at <span id="comment-at">${ms(T.t)}</span>`;
  el.innerHTML = `
    <button type="button" class="tb play" data-t="play" aria-label="${T.playing ? "Pause" : "Play"} (space)" title="${T.playing ? "Pause" : "Play"} (space)">${Pinrail.icon(T.playing ? "pause" : "play", { size: 16 })}</button>
    <button type="button" class="tb" data-t="back" aria-label="Back one frame (←)" title="Back one frame (←)">${Pinrail.icon("step-back", { size: 14 })}</button>
    <button type="button" class="tb" data-t="fwd" aria-label="Forward one frame (→)" title="Forward one frame (→)">${Pinrail.icon("step-forward", { size: 14 })}</button>
    <span class="clock" aria-live="off"><b id="clock-t">${ms(T.t)}</b><span id="clock-d">/ ${ms(span())}</span><span id="clock-sep">·</span><span id="clock-f"></span></span>
    <span class="seg" role="group" aria-label="Speed">${SPEEDS.map((s) => `<button type="button" data-speed="${s}" aria-pressed="${T.speed === s}">${s}×</button>`).join("")}</span>
    <button type="button" class="tb" data-t="loop" aria-pressed="${T.loop}" title="Loop (l)">${Pinrail.icon("repeat", { size: 14 })} Loop</button>
    <span class="pinrail-spacer"></span>
    ${V.length > 1 ? `<button type="button" class="tb" data-t="compare" aria-pressed="${S.compare}">${Pinrail.icon("columns-2", { size: 14 })} Side by side <kbd>v</kbd></button>` : ""}
    ${ro ? "" : `<button type="button" class="tb primary" data-t="comment">${Pinrail.icon("message-square-plus", { size: 14 })} Comment ${target} <kbd>c</kbd></button>`}
    ${reduced && !T.started ? `<span class="rm-note">Paused, since your system asks for reduced motion. Space plays it.</span>` : ""}`;
  updateClock();
}

function updateClock() {
  const t = document.getElementById("clock-t");
  if (!t) return;
  t.textContent = ms(T.t);
  const at = document.getElementById("comment-at");
  if (at) at.textContent = ms(T.t);
  const id = cur().id;
  const i = info[id];
  const f = document.getElementById("clock-f");
  if (i && !i.error) {
    const local = localTime(id, T.t);
    f.textContent =
      i.kind === "lottie"
        ? `${pct(local / i.duration)} · frame ${Math.round(i.firstFrame + (local / 1000) * i.fps)}`
        : pct(local / i.duration);
  } else f.textContent = "";
}

function ticks(sp) {
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
  const major = steps.find((s) => sp / s <= 10) ?? 30000;
  const minor = major / 5;
  const out = [];
  for (let t = 0; t <= sp + 0.001; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    out.push(
      `<span class="tick-mark${isMajor ? "" : " minor"}${t > sp * 0.96 ? " last" : ""}" style="left:${(t / sp) * 100}%">${isMajor ? `<span>${major >= 1000 ? `${t / 1000}s` : Math.round(t)}</span>` : ""}</span>`,
    );
  }
  return out.join("");
}

function renderTimeline() {
  const el = document.getElementById("timeline");
  if (!el || !P) return;
  const ids = shownIds();
  const sp = span();
  const at = (x) => `${(Math.min(x, sp) / sp) * 100}%`;
  const wide = (a, b) => `${((Math.min(b, sp) - Math.min(a, sp)) / sp) * 100}%`;
  const focus = cur().id;
  const labels = [`<div class="row-ruler"><span class="pinrail-faint">${sp >= 10000 ? "s" : "ms"}</span></div>`];
  const rows = [`<div class="row row-ruler">${ticks(sp)}</div>`];
  for (const id of ids) {
    const v = V.find((x) => x.id === id);
    const i = info[id];
    const d = durOf(id);
    labels.push(
      `<div class="row-lane"><span class="lane-name" data-lane="${esc(id)}" aria-current="${id === focus}">${esc(v.name)}</span></div>`,
    );
    const marks = commentsOf(id)
      .map((c, n) => {
        const lit = S.lit === `${id}:${n}`;
        const band =
          c.end_ms != null
            ? `<span class="mk-span" style="left:${at(c.start_ms)};width:${wide(c.start_ms, c.end_ms)}"></span>`
            : "";
        return `${band}<button type="button" class="mk" data-mk="${esc(id)}:${n}" style="left:${at(c.start_ms)}" aria-current="${lit}" title="${esc(when(c))}: ${esc(c.note)}">${n + 1}</button>`;
      })
      .join("");
    const more = i?.loops && sp > d ? `<span class="bar more" style="left:${at(d)};width:${wide(d, sp)}"></span>` : "";
    rows.push(`<div class="row row-lane" data-lane-row="${esc(id)}">
        <span class="bar${id === focus ? " focus" : ""}" style="left:0;width:${at(d)}"></span>${more}
        ${S.compare ? `<span class="bar-end" style="left:${at(d)}">${ms(d)}</span>` : ""}
        ${marks}
      </div>`);
    if (!S.compare && i && !i.error) {
      for (const k of i.tracks.slice(0, 10)) {
        labels.push(`<div class="row-sub sub" title="${esc(k.label)}"><span>${esc(k.label)}</span></div>`);
        const end = Math.min(k.end, sp);
        let iters = "";
        if (k.period > 0 && i.kind === "css") {
          for (let n = 1, x = k.delay + k.period; x < end - 0.5 && n < 40; n++, x += k.period)
            if (x > k.start) iters += `<span class="iter" style="left:${at(x)}"></span>`;
        }
        rows.push(
          `<div class="row row-sub"><span class="seg-bar${k.end === Infinity ? " loop" : ""}" style="left:${at(k.start)};width:${wide(k.start, end)}"></span>${iters}</div>`,
        );
      }
    }
  }
  const range = S.range
    ? `<span class="range" style="left:${at(S.range.a)};width:${wide(S.range.a, S.range.b)}"></span>`
    : "";
  el.innerHTML = `
    <div class="tl-labels">${labels.join("")}</div>
    <div class="tracks" id="tracks">${rows.join("")}${range}<span class="playhead" style="left:${at(T.t)}"></span></div>
    <div class="tl-hint">Drag to scrub · shift-drag, or <kbd>i</kbd> and <kbd>o</kbd>, to mark a range${plugin.readonly ? "" : " · <kbd>c</kbd> comments on it"} · <kbd>←</kbd> <kbd>→</kbd> a frame, with shift 100 ms</div>`;
}

function renderBelow() {
  const el = document.getElementById("below");
  if (!el || !P) return;
  const v = cur();
  const x = verdictOf(v.id) || {};
  const ro = plugin.readonly;
  const comments = commentsOf(v.id);
  const c0 = S.composing && S.composing.id === v.id ? S.composing : null;
  const focusNote = document.activeElement?.id === "note";
  const draftText = document.getElementById("comment-note")?.value ?? "";
  el.innerHTML = `
    <div>
      <p class="label">Comments on ${esc(v.name)}</p>
      ${
        c0
          ? `<div class="composer" role="group" aria-label="New comment">
          <div class="composer-head">${c0.b != null ? `From <b>${ms(c0.a)}</b> to <b>${ms(c0.b)}</b>` : `At <b>${ms(c0.a)}</b>`} of ${esc(v.name)}, ${c0.b != null ? `${Math.round((c0.a / durOf(v.id)) * 100)}–${pct(c0.b / durOf(v.id))}` : pct(c0.a / durOf(v.id))} through it</div>
          <textarea class="field-note" id="comment-note" aria-label="Comment" placeholder="What should change here? e.g. ease out slower, hold the press 40 ms longer, less overshoot"></textarea>
          <div class="composer-actions"><span class="k">↵ add · esc</span><button type="button" class="pinrail-btn quiet" data-composer="cancel">Cancel</button><button type="button" class="pinrail-btn pinrail-btn-primary" data-composer="add">Comment</button></div>
        </div>`
          : ""
      }
      ${
        comments.length
          ? `<ol class="comments">${comments
              .map(
                (c, n) => `
        <li aria-current="${S.lit === `${v.id}:${n}`}">
          <span class="num">${n + 1}</span>
          <span><span class="when">${esc(when(c))}</span>${esc(c.note)}${during(c) || c.compared_with?.length ? `<span class="what">${esc([during(c), c.compared_with?.length ? `beside ${c.compared_with.map((y) => V.find((z) => z.id === y)?.name ?? y).join(", ")}` : ""].filter(Boolean).join(" · "))}</span>` : ""}</span>
          <span class="acts"><button type="button" class="pinrail-btn quiet" data-go="${n}">Go</button>${ro ? "" : `<button type="button" class="pinrail-btn quiet" data-remove="${n}">Remove</button>`}</span>
        </li>`,
              )
              .join("")}</ol>`
          : c0
            ? ""
            : `<p class="pinrail-empty">${ro ? "None." : "Pause where something should change, or mark a range, and press c."}</p>`
      }
    </div>
    <section class="decide" aria-label="Your verdict on ${esc(v.name)}">
      <p class="label">Verdict</p>
      <div class="choices" role="group" aria-label="Verdict">
        ${Object.entries(ACTIONS)
          .map(
            ([a, label]) =>
              `<button type="button" class="choice" data-action="${a}" aria-pressed="${x.action === a}" ${ro ? "disabled" : ""}>${a === "favorite" ? "★ " : ""}${label} <kbd>${KEYS[a]}</kbd></button>`,
          )
          .join("")}
      </div>
      <textarea id="note" aria-label="Note on ${esc(v.name)}" placeholder="${x.action === "drop" ? "Why it goes (optional)" : "What to change in the next round (optional)"}" ${ro ? "disabled" : ""}>${esc(x.note || "")}</textarea>
      <div class="nav"><button type="button" data-step="-1" aria-label="Previous variant">← k</button><button type="button" data-step="1" aria-label="Next variant">j →</button></div>
    </section>`;
  if (c0) document.getElementById("comment-note").value = draftText;
  if (focusNote) document.getElementById("note")?.focus();
}

/* everything but the stage and the rail's players, which keep playing */
function refresh() {
  renderTop();
  renderRail();
  renderHead();
  buildStage();
  renderTransport();
  renderTimeline();
  renderBelow();
  status();
}
function layout() {
  refresh();
  fitAll();
  push(true);
}

/* ---------- the protocol ---------- */

const plugin = Pinrail.connect({
  onInit({ review, draft }) {
    P = review.payload;
    V = P.variants || [];
    for (const p of [...live]) p.destroy();
    thumbs.clear();
    staged = [];
    stageKey = "";
    for (const k of Object.keys(info)) delete info[k];
    lottieJson = {};
    S.verdicts = {};
    const decided = review.decision?.data;
    if (decided) {
      for (const d of decided.decisions || [])
        S.verdicts[d.id] = {
          action: d.action,
          note: d.note || "",
          duration_ms: d.duration_ms,
          comments: d.comments || [],
        };
    } else if (draft && typeof draft === "object" && draft.verdicts) S.verdicts = draft.verdicts;
    Object.assign(S, {
      sel: 0,
      compare: false,
      picked: V.slice(0, MAX_COMPARE).map((v) => v.id),
      armed: false,
      composing: null,
      range: null,
      lit: null,
    });
    Object.assign(T, { t: 0, playing: !reduced, started: !reduced });
    renderShell();
    layout();
  },
  onSubmitted() {
    S.composing = null;
    refresh();
  },
  onViolations(errors) {
    plugin.handOverLabel(`Check: ${errors[0]?.message ?? "the decision"}`);
  },
  onCollect() {
    return handOver();
  },
});
requestAnimationFrame(tick);

/* ---------- input ---------- */

function timeAt(e) {
  const r = document.getElementById("tracks").getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * span();
  // on a whole frame, which is what the stage can show
  return Math.min(span(), Math.round(Math.round(t / frameMs()) * frameMs()));
}

document.addEventListener("pointerdown", (e) => {
  const tracks = e.target.closest?.("#tracks");
  if (!tracks || e.button !== 0 || e.target.closest(".mk")) return;
  e.preventDefault();
  tracks.setPointerCapture(e.pointerId);
  const t = timeAt(e);
  drag = { range: e.shiftKey, from: t, el: tracks };
  pause();
  if (drag.range) {
    S.range = null;
  } else seekTo(t);
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const t = timeAt(e);
  if (drag.range) {
    const a = Math.min(drag.from, t);
    const b = Math.max(drag.from, t);
    S.range = b - a >= 1 ? { a, b } : null;
    seekTo(a);
    const band = drag.el.querySelector(".range");
    if (band && S.range) {
      band.style.left = `${(a / span()) * 100}%`;
      band.style.width = `${((b - a) / span()) * 100}%`;
    } else renderTimelineKeepingDrag();
  } else seekTo(t);
});
function renderTimelineKeepingDrag() {
  renderTimeline();
  drag.el = document.getElementById("tracks");
}
document.addEventListener("pointerup", () => {
  if (!drag) return;
  drag = null;
  renderTimeline();
  renderTransport();
});

document.addEventListener("click", (e) => {
  if (!P) return;
  const t = e.target.closest ? e.target : null;
  if (!t) return;
  const pair = t.closest("[data-pair]");
  if (pair) return togglePair(pair.dataset.pair, pair.checked);
  if (t.closest(".pair")) return;
  const tb = t.closest("[data-t]");
  if (tb) {
    const what = tb.dataset.t;
    if (what === "play") togglePlay();
    else if (what === "back") step(-frameMs());
    else if (what === "fwd") step(frameMs());
    else if (what === "loop") {
      T.loop = !T.loop;
      renderTransport();
    } else if (what === "compare") toggleCompare();
    else if (what === "comment") startComment();
    return;
  }
  const speed = t.closest("[data-speed]");
  if (speed) return setSpeed(Number(speed.dataset.speed));
  const mk = t.closest("[data-mk]");
  if (mk) {
    const [id, n] = mk.dataset.mk.split(/:(?=\d+$)/);
    return goTo(id, Number(n));
  }
  const lane = t.closest("[data-lane]");
  if (lane) return focusVariant(V.findIndex((v) => v.id === lane.dataset.lane));
  const pane = t.closest("[data-pane]");
  if (pane)
    return pane.dataset.pane === cur().id ? togglePlay() : focusVariant(V.findIndex((v) => v.id === pane.dataset.pane));
  const composer = t.closest("[data-composer]");
  if (composer) return composer.dataset.composer === "add" ? addComment() : cancelComment();
  const go = t.closest("[data-go]");
  if (go) return goTo(cur().id, Number(go.dataset.go));
  const remove = t.closest("[data-remove]");
  if (remove) return removeComment(Number(remove.dataset.remove));
  const choice = t.closest("[data-action]");
  if (choice) return setVerdict(choice.dataset.action);
  const stepBtn = t.closest("[data-step]");
  if (stepBtn) return stepVariant(Number(stepBtn.dataset.step));
  const pick = t.closest("[data-pick]");
  if (pick) return select(Number(pick.dataset.pick));
});

document.addEventListener("pointerover", (e) => {
  if (reduced) return;
  const pick = e.target.closest?.("[data-pick]");
  const id = pick ? V[Number(pick.dataset.pick)]?.id : null;
  if ((preview?.id ?? null) === id) return;
  if (preview) preview.p.seek(posterOf(preview.id));
  preview = id && info[id] && !info[id].error ? { id, p: thumbs.get(id), start: performance.now() } : null;
});

document.addEventListener("input", (e) => {
  if (e.target.id !== "note" || plugin.readonly) return;
  const id = cur().id;
  S.verdicts[id] = { ...(verdictOf(id) || { action: null }), note: e.target.value };
  S.armed = false;
  plugin.draft({ verdicts: S.verdicts });
  renderTop();
});

document.addEventListener("keydown", (e) => {
  if (e.target.id === "comment-note") {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      addComment();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelComment();
    }
    return;
  }
  if (!P || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.("textarea, input:not([type=checkbox])")) return;
  const key = e.key === " " ? "space" : String(e.key).toLowerCase();
  if (key === "enter" && e.target.closest?.("[data-pick]"))
    return select(Number(e.target.closest("[data-pick]").dataset.pick));
  switch (key) {
    case "space":
      togglePlay();
      break;
    case "arrowleft":
      step(e.shiftKey ? -100 : -frameMs());
      break;
    case "arrowright":
      step(e.shiftKey ? 100 : frameMs());
      break;
    case "home":
      pause();
      seekTo(S.range ? S.range.a : 0);
      break;
    case "end":
      pause();
      seekTo(S.range ? S.range.b : span());
      break;
    case "-":
    case "_":
      nudgeSpeed(-1);
      break;
    case "=":
    case "+":
      nudgeSpeed(1);
      break;
    case "l":
      T.loop = !T.loop;
      renderTransport();
      break;
    case "i":
      markIn();
      break;
    case "o":
      markOut();
      break;
    case "c":
      startComment();
      break;
    case "v":
      if (V.length > 1) toggleCompare();
      break;
    case "j":
      stepVariant(1);
      break;
    case "k":
      stepVariant(-1);
      break;
    case "f":
      setVerdict("favorite");
      break;
    case "s":
      setVerdict("keep");
      break;
    case "x":
      setVerdict("drop");
      break;
    case "escape":
      if (S.composing) cancelComment();
      else if (S.range) {
        S.range = null;
        renderTimeline();
        renderTransport();
      } else return;
      break;
    default:
      return;
  }
  e.preventDefault();
});
// a focused button would also take the space as a click
document.addEventListener("keyup", (e) => {
  if (e.key === " " && e.target.closest?.("button, [role=button]") && !e.target.closest("textarea")) e.preventDefault();
});

/* What the previous round decided for an item: its decision's
   `decisions: [{ id, action, note }]` and `undecided: [id]`. The previous
   round may come from an earlier release, so its shape is checked. */
function previousVerdict(previous, id) {
  const data = previous && previous.decision && previous.decision.data;
  if (!data || typeof data !== "object") return null;
  const d = (Array.isArray(data.decisions) ? data.decisions : []).find((x) => x && x.id === id);
  if (d) return { action: d.action, note: d.note || "" };
  if (Array.isArray(data.undecided) && data.undecided.includes(id)) return { action: "undecided", note: "" };
  return null;
}

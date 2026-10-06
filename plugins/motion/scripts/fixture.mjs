// Writes the fixtures: four takes on the feedback of the Save button in
// Tessel's editor (press, saving, saved). Three are CSS, one is a Lottie file
// sent beside the payload, as fixtures/save/tick.json.
//
//   node scripts/fixture.mjs
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const fixtures = path.join(here, "..", "fixtures");
const write = (file, value) => fs.writeFileSync(path.join(fixtures, file), JSON.stringify(value, null, 2) + "\n");

const BASE = `
.btn { display: grid; place-items: center; width: 160px; height: 44px; border: 0; border-radius: 10px;
  background: #2f6fed; color: #fff; font: 600 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  overflow: hidden; box-shadow: 0 1px 2px rgba(16, 24, 40, .12), 0 4px 12px -4px rgba(47, 111, 237, .45); }
.btn > * { grid-area: 1 / 1; }
.ring { width: 18px; height: 18px; box-sizing: border-box; border-radius: 50%; border: 2.5px solid rgba(255, 255, 255, .35); border-top-color: #fff; opacity: 0; }
.tick { width: 22px; height: 22px; fill: none; stroke: #fff; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 24; stroke-dashoffset: 24; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes lift-out { to { opacity: 0; transform: translateY(-8px); } }
@keyframes done { to { background: #1f9d63; box-shadow: 0 1px 2px rgba(16, 24, 40, .12), 0 4px 12px -4px rgba(31, 157, 99, .45); } }
`.trim();

const TICK = `<svg class="tick" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

const squish = {
  id: "V1",
  name: "Squish",
  reasoning:
    "The button gives under the finger (**scale 0.94** at 105 ms) and springs back past its size, then the label lifts out for a spinner. Two turns of the spinner stand for the save; the tick draws in as the button turns green.",
  html: `<button class="btn"><span class="label">Save</span><span class="ring"></span>${TICK}</button>`,
  css: `${BASE}
.btn { animation: press 420ms cubic-bezier(.3, .7, .4, 1) both, done 240ms 1100ms ease-out both; }
@keyframes press { 0% { transform: scale(1); } 25% { transform: scale(.94); } 60% { transform: scale(1.03); } 100% { transform: scale(1); } }
.label { animation: lift-out 140ms 300ms ease-in both; }
.ring { animation: fade-in 120ms 380ms both, spin 360ms 380ms linear 2, fade-out 100ms 1100ms forwards; }
.tick { animation: draw 260ms 1140ms cubic-bezier(.6, 0, .2, 1) both; }`,
};

const fill = {
  id: "V2",
  name: "Fill",
  reasoning:
    "No spinner: a lighter band sweeps across the button while it saves, and *Saved* drops in with its tick when the band reaches the end. Reads as progress, so it only fits if a save takes about as long every time.",
  html: `<button class="btn"><span class="fill"></span><span class="label">Save</span><span class="saved">${TICK}Saved</span></button>`,
  css: `${BASE}
.btn { animation: nudge 240ms ease-out both, done 260ms 1260ms ease-out both; }
@keyframes nudge { 40% { transform: scale(.97); } }
.fill { place-self: stretch; background: rgba(255, 255, 255, .24); transform-origin: left; transform: scaleX(0); animation: sweep 1100ms 160ms cubic-bezier(.65, 0, .35, 1) both; }
@keyframes sweep { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.label { animation: lift-out 160ms 1240ms ease-in both; }
.saved { display: flex; align-items: center; gap: 6px; opacity: 0; animation: drop-in 220ms 1320ms cubic-bezier(.2, .8, .3, 1) both; }
.saved .tick { width: 18px; height: 18px; animation: draw 240ms 1400ms ease-out both; }
@keyframes drop-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`,
};

const morph = {
  id: "V3",
  name: "Morph",
  reasoning:
    "The button folds into a circle that spins while the save runs, then grows back out, green, with a little overshoot, and draws its tick. The most motion of the three CSS takes; watch **80–400 ms** at 0.25× for the fold.",
  html: `<button class="btn"><span class="label">Save</span><span class="ring"></span>${TICK}</button>`,
  css: `${BASE}
.btn { animation: shrink 320ms 80ms cubic-bezier(.5, 0, .2, 1) both, grow 380ms 1240ms cubic-bezier(.3, 1.35, .5, 1) forwards, done 200ms 1240ms ease-out both; }
@keyframes shrink { from { width: 160px; border-radius: 10px; } to { width: 44px; border-radius: 22px; } }
@keyframes grow { from { width: 44px; border-radius: 22px; } to { width: 160px; border-radius: 10px; } }
.label { animation: fade-out 100ms 40ms both; }
.ring { animation: fade-in 120ms 380ms both, spin 420ms 380ms linear 2, fade-out 80ms 1220ms forwards; }
.tick { animation: draw 280ms 1420ms cubic-bezier(.6, 0, .2, 1) both; }`,
};

const tick = {
  id: "V4",
  name: "Badge",
  reasoning:
    "Made in After Effects and exported with Bodymovin: the button presses, shrinks away and a green badge pops in its place, then the tick is drawn. No text, so the label would sit beside it.",
  lottie: { $attachment: "tick.json" },
};

/* The Lottie: 60 fps, 96 frames. */
const still = (k) => ({ a: 0, k });
const keys = (...frames) => ({
  a: 1,
  k: frames.map(([t, s], i) =>
    i === frames.length - 1
      ? { t, s }
      : { t, s, i: { x: s.map(() => 0.3), y: s.map(() => 1) }, o: { x: s.map(() => 0.5), y: s.map(() => 0) } },
  ),
});
const transform = (extra = {}) => ({
  o: still(100),
  r: still(0),
  p: still([160, 80, 0]),
  a: still([0, 0, 0]),
  s: still([100, 100, 100]),
  ...extra,
});
const group = (nm, items) => ({
  ty: "gr",
  nm,
  np: items.length,
  cix: 2,
  bm: 0,
  it: [
    ...items,
    {
      ty: "tr",
      p: still([0, 0]),
      a: still([0, 0]),
      s: still([100, 100]),
      r: still(0),
      o: still(100),
      sk: still(0),
      sa: still(0),
    },
  ],
});
const layer = (ind, nm, ip, op, ks, shapes) => ({
  ddd: 0,
  ind,
  ty: 4,
  nm,
  sr: 1,
  ks,
  ao: 0,
  shapes,
  ip,
  op,
  st: 0,
  bm: 0,
});
const blue = [0.184, 0.435, 0.929, 1];
const green = [0.122, 0.616, 0.388, 1];
const lottie = {
  v: "5.7.4",
  fr: 60,
  ip: 0,
  op: 96,
  w: 320,
  h: 160,
  nm: "Save — badge",
  ddd: 0,
  assets: [],
  layers: [
    layer(1, "Check", 44, 96, transform(), [
      group("Check", [
        {
          ty: "sh",
          nm: "Path",
          ks: still({
            i: [
              [0, 0],
              [0, 0],
              [0, 0],
            ],
            o: [
              [0, 0],
              [0, 0],
              [0, 0],
            ],
            v: [
              [-7, 0.5],
              [-2.5, 5],
              [7, -4.5],
            ],
            c: false,
          }),
        },
        { ty: "st", nm: "Stroke", c: still([1, 1, 1, 1]), o: still(100), w: still(2.6), lc: 2, lj: 2, ml: 4, bm: 0 },
        { ty: "tm", nm: "Draw", s: still(0), e: keys([52, [0]], [70, [100]]), o: still(0), m: 1 },
      ]),
    ]),
    layer(2, "Badge", 30, 96, transform({ s: keys([30, [0, 0, 100]], [42, [112, 112, 100]], [50, [100, 100, 100]]) }), [
      group("Badge", [
        { ty: "el", nm: "Circle", d: 1, s: still([44, 44]), p: still([0, 0]) },
        { ty: "fl", nm: "Green", c: still(green), o: still(100), r: 1, bm: 0 },
      ]),
    ]),
    layer(
      3,
      "Button",
      0,
      34,
      transform({
        s: keys(
          [0, [100, 100, 100]],
          [6, [94, 94, 100]],
          [14, [103, 103, 100]],
          [20, [100, 100, 100]],
          [32, [40, 40, 100]],
        ),
        o: keys([20, [100]], [32, [0]]),
      }),
      [
        group("Button", [
          { ty: "rc", nm: "Shape", d: 1, s: still([160, 44]), p: still([0, 0]), r: still(10) },
          { ty: "fl", nm: "Blue", c: still(blue), o: still(100), r: 1, bm: 0 },
        ]),
      ],
    ),
  ],
};

const payload = {
  subject: "Save button — press, saving, saved",
  notes:
    "Round 1 of the feedback on **Save** in Tessel's editor: the press, the wait while it saves, and the moment it is saved. A real save takes 0.6–2 s, so each take stands for about a second of waiting. Watch the first 400 ms at 0.25×: the press should feel instant, the wait calm.",
  stage: { width: 320, height: 160, background: "#f4f5f8" },
  variants: [squish, fill, morph, tick],
};

fs.mkdirSync(path.join(fixtures, "save"), { recursive: true });
fs.writeFileSync(path.join(fixtures, "save", "tick.json"), JSON.stringify(lottie) + "\n");
const attachments = { "tick.json": { path: "save/tick.json" } };
write("save.json", {
  title: "Save button — round 1",
  origin: { repo: "tessel/editor", workflow: "design" },
  payload,
  attachments,
});

write("save.decided.json", {
  title: "Save button — round 1",
  origin: { repo: "tessel/editor", workflow: "design" },
  payload,
  decision: {
    decided_by: "maya",
    decided_at: "2026-09-24T09:12:00Z",
    data: {
      decisions: [
        {
          id: "V3",
          action: "favorite",
          note: "The one. It says 'working' without pretending to know how long.",
          duration_ms: 1700,
          comments: [
            {
              start_ms: 80,
              end_ms: 400,
              start: 0.047,
              end: 0.235,
              active: [
                { selector: ".btn", animation: "shrink", from: 0, to: 1 },
                { selector: ".label", animation: "fade-out", from: 0.4 },
                { selector: ".ring", animation: "fade-in", to: 0.17 },
                { selector: ".ring", animation: "spin", to: 0.05 },
              ],
              compared_with: ["V1", "V2"],
              note: "Ease out slower into the circle, over about 450 ms: next to Squish it snaps shut.",
            },
            {
              start_ms: 1400,
              start: 0.824,
              active: [
                { selector: ".btn", animation: "grow", from: 0.42 },
                { selector: ".btn", animation: "done", from: 0.8 },
              ],
              note: "Less overshoot as it grows back; at this point it wobbles.",
            },
          ],
        },
        {
          id: "V1",
          action: "keep",
          note: "Keep the press from this one.",
          duration_ms: 1400,
          comments: [
            {
              start_ms: 105,
              start: 0.075,
              active: [{ selector: ".btn", animation: "press", from: 0.25 }],
              note: "This depth is right; take it into Morph.",
            },
          ],
        },
        { id: "V2", action: "drop", note: "A progress bar promises a length we don't know." },
      ],
      undecided: ["V4"],
    },
  },
  agent_note: "Morph, with the fold slowed and the overshoot tamed; the press from Squish.",
  attachments,
});

write("../samples/loading.json", {
  title: "Loading spinner",
  payload: {
    subject: "Loading spinner",
    notes: "Two spinners for the empty state of the inbox.",
    stage: { width: 200, height: 120, background: "#ffffff" },
    variants: [
      {
        id: "A",
        name: "Arc",
        reasoning: "One arc that speeds up and slows down as it turns.",
        html: `<div class="arc"></div>`,
        css: `.arc { width: 36px; height: 36px; border-radius: 50%; border: 3px solid #e4e7ee; border-top-color: #2f6fed; animation: turn 900ms cubic-bezier(.5, .1, .5, .9) infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }`,
      },
      {
        id: "B",
        name: "Dots",
        reasoning:
          "Three dots rising one after the other, 160 ms apart. The delays are negative, so the loop starts in step.",
        html: `<div class="dots"><i></i><i></i><i></i></div>`,
        css: `.dots { display: flex; gap: 8px; }
  .dots i { width: 10px; height: 10px; border-radius: 50%; background: #2f6fed; animation: rise 1200ms ease-in-out infinite; }
  .dots i:nth-child(1) { animation-delay: -320ms; }
  .dots i:nth-child(2) { animation-delay: -160ms; }
  @keyframes rise { 0%, 60%, 100% { transform: none; opacity: .4; } 30% { transform: translateY(-10px); opacity: 1; } }`,
      },
    ],
  },
});

import { expect as base, test, type FrameLocator, type Page } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The view alone, under the harness: no app, no CLI.
const dir = path.resolve(__dirname, "..");
const round = () => fixture(path.join(dir, "fixtures", "save.json"));
const expect = base.configure({ timeout: 10_000 });
test.use({ viewport: { width: 1360, height: 900 } });

// The decision schema, checked with the same validator the SDK's check uses.
const sdk = createRequire(require.resolve("pinrail-sdk/package.json"));
const Ajv2020 = sdk("ajv/dist/2020").default;
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(fs.readFileSync(path.join(dir, "schemas", "decision.schema.json"), "utf8")),
);
const valid = (decision: unknown) => {
  const ok = validate(decision);
  return ok ? "" : JSON.stringify(validate.errors);
};

async function open(page: Page, opts: Record<string, unknown> = {}) {
  const plugin = await mountPlugin(page, dir, { review: round(), ...opts });
  const f = plugin.frame;
  // every variant read, the Lottie from the file beside the payload
  await expect(f.locator(".pick-meta")).toHaveText([
    "CSS · 1400 ms",
    "CSS · 1640 ms",
    "CSS · 1700 ms",
    "Lottie · 60 fps · 1600 ms",
  ]);
  await focus(f);
  return { plugin, f };
}

// Into the frame, on its top bar, so keys go to the view.
const focus = (f: FrameLocator) => f.locator("body").click({ position: { x: 600, y: 5 } });

// Paused at the start, by keyboard, then forward in steps of 100 ms.
async function at(f: FrameLocator, tenths: number) {
  const body = f.locator("body");
  await body.press("Home");
  for (let i = 0; i < tenths; i++) await body.press("Shift+ArrowRight");
  await expect(f.locator("#clock-t")).toHaveText(`${tenths * 100} ms`);
}

const scaleOf = (f: FrameLocator, pane: string) =>
  f
    .locator(`[data-pane="${pane}"] iframe`)
    .contentFrame()
    .locator(".btn")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
const widthOf = (f: FrameLocator, pane: string) =>
  f
    .locator(`[data-pane="${pane}"] iframe`)
    .contentFrame()
    .locator(".btn")
    .evaluate((el) => el.getBoundingClientRect().width);

test("shows every variant in the rail, the chosen one on the stage, and its animations on the timeline", async ({
  page,
}) => {
  const { plugin, f } = await open(page);
  await expect(f.locator(".pick")).toHaveCount(4);
  await expect(f.locator("#variant-name")).toHaveText("Squish");
  await expect(f.locator(".reasoning")).toContainText("scale 0.94");
  await expect(f.locator("#clock-d")).toHaveText("/ 1400 ms");
  await expect(f.locator(".tl-labels .sub")).toHaveText([
    ".btn · press",
    ".btn · done",
    ".label · lift-out",
    ".ring · fade-in",
    ".ring · spin",
    ".ring · fade-out",
    ".tick · draw",
  ]);
  // the Lottie came as a file the shell handed over
  const asked = (await plugin.messages()).filter((m: any) => m.type === "attachment").map((m: any) => m.name);
  expect(asked).toContain("tick.json");
  await f.locator("body").press("k");
  await expect(f.locator("#variant-name")).toHaveText("Badge");
  await expect(f.locator(".tl-labels .sub")).toHaveText(["Check", "Badge", "Button"]);
  await expect(f.locator(".stage .lottie svg")).toHaveCount(1);
});

test("plays on its own, and scrubs, steps and changes speed from the keys and the ruler", async ({ page }) => {
  const { f } = await open(page);
  await expect(f.locator('[data-t="play"]')).toHaveAttribute("aria-label", /Pause/);
  await at(f, 0);
  await expect(f.locator('[data-t="play"]')).toHaveAttribute("aria-label", /Play/);
  expect(await scaleOf(f, "V1")).toBeCloseTo(1, 2);
  // a frame at a time, then 100 ms at a time: the button is at the bottom of its press
  await f.locator("body").press("ArrowRight");
  await expect(f.locator("#clock-t")).toHaveText("17 ms");
  await at(f, 1);
  await expect.poll(() => scaleOf(f, "V1")).toBeLessThan(0.95);
  // the middle of the ruler is the middle of the animation
  const ruler = (await f.locator("#tracks .row-ruler").boundingBox())!;
  await page.mouse.click(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
  await expect(f.locator("#clock-t")).toHaveText("700 ms");
  await expect(f.locator("#clock-f")).toHaveText("50%");
  await f.locator("body").press("End");
  await expect(f.locator("#clock-t")).toHaveText("1400 ms");
  // slower, down to a quarter, and back
  await f.locator("body").press("-");
  await f.locator("body").press("-");
  await f.locator("body").press("-");
  await f.locator("body").press("-");
  await expect(f.locator('[data-speed][aria-pressed="true"]')).toHaveText("0.25×");
  await f.locator("body").press("=");
  await expect(f.locator('[data-speed][aria-pressed="true"]')).toHaveText("0.5×");
  await f.locator("body").press("l");
  await expect(f.locator('[data-t="loop"]')).toHaveAttribute("aria-pressed", "false");
});

test("a comment at a moment goes back in ms, as a share of the animation, with what was moving then", async ({
  page,
}) => {
  const { plugin, f } = await open(page);
  await at(f, 1);
  await f.locator("body").press("c");
  await expect(f.locator(".composer-head")).toContainText("At 100 ms");
  await f.locator("#comment-note").fill("Hold the press 40 ms longer");
  await f.locator("#comment-note").press("Enter");
  await expect(f.locator(".comments li")).toHaveCount(1);
  await expect(f.locator(".comments .when")).toHaveText("100 ms · 7%");
  await expect(f.locator('.mk[data-mk="V1:0"]')).toHaveCount(1);
  // a comment keeps the variant
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("Keep");

  await plugin.collect();
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(valid(decision)).toBe("");
  expect(decision).toEqual({
    decisions: [
      {
        id: "V1",
        action: "keep",
        duration_ms: 1400,
        comments: [
          {
            start_ms: 100,
            start: 0.071,
            active: [{ selector: ".btn", animation: "press", from: 0.24 }],
            note: "Hold the press 40 ms longer",
          },
        ],
      },
    ],
    undecided: ["V2", "V3", "V4"],
  });
});

test("a comment over a range, marked with i and o, or by shift-dragging the timeline", async ({ page }) => {
  const { plugin, f } = await open(page);
  await at(f, 3);
  await f.locator("body").press("i");
  for (let i = 0; i < 2; i++) await f.locator("body").press("Shift+ArrowRight");
  await f.locator("body").press("o");
  await expect(f.locator("#timeline .range")).toHaveCount(1);
  await expect(f.locator('[data-t="comment"]')).toContainText("Comment on 300–500 ms");
  await f.locator("body").press("c");
  await expect(f.locator(".composer-head")).toContainText("From 300 ms to 500 ms");
  await f.locator("#comment-note").fill("Ease out slower here");
  await f.locator('[data-composer="add"]').click();
  await expect(f.locator(".comments .when")).toHaveText("300–500 ms · 21–36%");
  await expect(f.locator("#timeline .range")).toHaveCount(0);

  // shift-drag marks a range too
  const lane = (await f.locator("#tracks .row-lane").boundingBox())!;
  await page.keyboard.down("Shift");
  await page.mouse.move(lane.x + lane.width * 0.5, lane.y + 4);
  await page.mouse.down();
  await page.mouse.move(lane.x + lane.width * 0.75, lane.y + 4, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(f.locator('[data-t="comment"]')).toContainText(/Comment on (69\d|70\d)–10[45]\d ms/);
  await f.locator("body").press("Escape");
  await expect(f.locator("#timeline .range")).toHaveCount(0);

  await f.locator("body").press("f");
  await plugin.collect();
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(valid(decision)).toBe("");
  expect(decision.decisions[0]).toEqual({
    id: "V1",
    action: "favorite",
    duration_ms: 1400,
    comments: [
      {
        start_ms: 300,
        end_ms: 500,
        start: 0.214,
        end: 0.357,
        active: [
          { selector: ".btn", animation: "press", from: 0.71 },
          { selector: ".label", animation: "lift-out", from: 0 },
          { selector: ".ring", animation: "fade-in", to: 1 },
          { selector: ".ring", animation: "spin", to: 0.33 },
        ],
        note: "Ease out slower here",
      },
    ],
  });
});

test("a Lottie comment carries its frame and the layers on screen", async ({ page }) => {
  const { plugin, f } = await open(page);
  await f.locator("body").press("k");
  await expect(f.locator("#variant-name")).toHaveText("Badge");
  await at(f, 9);
  await expect(f.locator("#clock-f")).toHaveText("56% · frame 54");
  await f.locator("body").press("c");
  await f.locator("#comment-note").fill("Pop the badge a touch less");
  await f.locator("#comment-note").press("Enter");
  await plugin.collect();
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(valid(decision)).toBe("");
  expect(decision.decisions).toEqual([
    {
      id: "V4",
      action: "keep",
      duration_ms: 1600,
      comments: [
        {
          start_ms: 900,
          start: 0.563,
          frame: 54,
          active: [{ layer: "Check" }, { layer: "Badge" }],
          note: "Pop the badge a touch less",
        },
      ],
    },
  ]);
});

test("side by side, every variant plays on one clock, and a comment says what it was seen beside", async ({ page }) => {
  const { plugin, f } = await open(page);
  await f.locator("body").press("v");
  await expect(f.locator(".stage.compare .pane")).toHaveCount(4);
  await expect(f.locator("#clock-d")).toHaveText("/ 1700 ms");
  await expect(f.locator(".bar-end")).toHaveText(["1400 ms", "1640 ms", "1700 ms", "1600 ms"]);
  await at(f, 2);
  // all at 200 ms: Squish is still pressed in, Morph is folding into its circle
  await expect.poll(() => scaleOf(f, "V1")).toBeLessThan(1.04);
  await expect.poll(() => widthOf(f, "V3")).toBeLessThan(150);
  await expect.poll(() => widthOf(f, "V3")).toBeGreaterThan(44);
  // the one the comments and verdict go to
  await f.locator('[data-pane="V3"] .pane-head').click();
  await expect(f.locator('[data-pane="V3"]')).toHaveAttribute("aria-current", "true");
  await expect(f.locator("#variant-name")).toHaveText("Morph");
  await expect(f.locator("#clock-t")).toHaveText("200 ms");
  // one fewer beside it
  await f.locator('[data-pair="V2"]').uncheck();
  await expect(f.locator(".stage.compare .pane")).toHaveCount(3);
  await f.locator("body").press("c");
  await f.locator("#comment-note").fill("Folds too fast next to Squish");
  await f.locator("#comment-note").press("Enter");
  await plugin.collect();
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(valid(decision)).toBe("");
  expect(decision.decisions[0].comments[0]).toMatchObject({
    start_ms: 200,
    compared_with: ["V1", "V4"],
    note: "Folds too fast next to Squish",
  });
  expect(decision.decisions[0].comments[0].active).toContainEqual({
    selector: ".btn",
    animation: "shrink",
    from: 0.38,
  });
});

test("one favourite, keys to decide, and a warning before undecided variants go back", async ({ page }) => {
  const { plugin, f } = await open(page);
  const body = f.locator("body");
  await body.press("f"); // V1 favourite
  await body.press("j");
  await body.press("x"); // V2 dropped
  await f.locator("#note").fill("A progress bar promises a length");
  await body.click({ position: { x: 600, y: 5 } });
  await body.press("j");
  await f.locator('.choice[data-action="favorite"]').click(); // V3 favourite: V1 steps down
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("Keep");
  await expect(f.locator(".pick").nth(2).locator(".verdict-chip")).toHaveText("★ Favourite");
  await expect(f.locator(".tally")).toContainText("1 favourite");

  await plugin.collect();
  await expect.poll(() => plugin.lastStatus()).toBe("Hand over with 1 undecided");
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(valid(decision)).toBe("");
  expect(decision).toEqual({
    decisions: [
      { id: "V1", action: "keep" },
      { id: "V2", action: "drop", note: "A progress bar promises a length" },
      { id: "V3", action: "favorite" },
    ],
    undecided: ["V4"],
  });
});

test("keys pressed while the app has focus reach the view", async ({ page }) => {
  const { plugin, f } = await open(page);
  await at(f, 0);
  await plugin.sendKey("space");
  await expect(f.locator('[data-t="play"]')).toHaveAttribute("aria-label", /Pause/);
  await plugin.sendKey("space");
  await expect(f.locator('[data-t="play"]')).toHaveAttribute("aria-label", /Play/);
  await plugin.sendKey("f");
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("★ Favourite");
});

test("work in progress is kept as a draft and comes back", async ({ page }) => {
  const { plugin, f } = await open(page);
  await at(f, 4);
  await f.locator("body").press("c");
  await f.locator("#comment-note").fill("Spinner in sooner");
  await f.locator("#comment-note").press("Enter");
  await f.locator("body").press("f");
  await expect.poll(async () => (await plugin.lastDraft())?.verdicts?.V1?.action).toBe("favorite");
  await plugin.reinit();
  await expect(f.locator(".pick-meta").nth(3)).toContainText("Lottie");
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("★ Favourite");
  await expect(f.locator(".comments li")).toHaveCount(1);
  await expect(f.locator(".comments")).toContainText("Spinner in sooner");
  await expect(f.locator('.mk[data-mk="V1:0"]')).toHaveCount(1);
});

test("a decided round is read-only, and still plays, with its comments on the timeline", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, {
    review: fixture(path.join(dir, "fixtures", "save.decided.json")),
    readonly: true,
  });
  const f = plugin.frame;
  await expect(f.locator(".pick").nth(2).locator(".verdict-chip")).toHaveText("★ Favourite");
  await focus(f);
  await expect(f.locator(".pick").nth(3).locator(".verdict-chip")).toHaveText("—");
  await expect(f.locator('.choice[data-action="keep"]')).toBeDisabled();
  await expect(f.locator('[data-t="comment"]')).toHaveCount(0);
  await f.locator("body").press("j");
  await f.locator("body").press("j");
  await expect(f.locator("#variant-name")).toHaveText("Morph");
  await expect(f.locator(".comments li")).toHaveCount(2);
  await expect(f.locator(".comments .when").first()).toHaveText("80–400 ms · 5–24%");
  await expect(f.locator("#note")).toHaveValue(/without pretending/);
  await f.locator('.mk[data-mk="V3:1"]').click();
  await expect(f.locator("#clock-t")).toHaveText("1400 ms");
  await f.locator("body").press("c");
  await expect(f.locator(".composer")).toHaveCount(0);
  await f.locator("body").press("x");
  await expect(f.locator(".pick").nth(2).locator(".verdict-chip")).toHaveText("★ Favourite");
});

test("the decided fixture passes the decision schema", () => {
  const decided = JSON.parse(fs.readFileSync(path.join(dir, "fixtures", "save.decided.json"), "utf8"));
  expect(valid(decided.decision.data)).toBe("");
});

test("with reduced motion asked for, nothing plays until the person presses play", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { f } = await open(page);
  await expect(f.locator(".rm-note")).toBeVisible();
  await page.waitForTimeout(300);
  await expect(f.locator("#clock-t")).toHaveText("0 ms");
  await f.locator("body").press("Space");
  await expect(f.locator(".rm-note")).toHaveCount(0);
  await expect(f.locator("#clock-t")).not.toHaveText("0 ms");
});

test("the agent's markup runs no script: not its own, not a handler, not a link", async ({ page }) => {
  const review = round();
  const hostile = `parent.postMessage({pinrail:1,type:'submit',data:{decisions:[],undecided:[]}},'*');parent.parent.postMessage({pinrail:1,type:'submit',data:{decisions:[],undecided:[]}},'*')`;
  review.payload.variants = [
    {
      id: "H",
      name: "Hostile",
      html: `<div class="dot"></div><img src="x" onerror="${hostile}"><svg onload="${hostile}"></svg><a id="go" href="javascript:${hostile}">go</a><script>${hostile}</script><iframe srcdoc="<script>${hostile}</script>"></iframe>`,
      css: ".dot { width: 20px; height: 20px; background: red; animation: move 500ms linear both; } @keyframes move { to { transform: translateX(100px); } }",
    },
  ];
  const plugin = await mountPlugin(page, dir, { review });
  const f = plugin.frame;
  await expect(f.locator(".pick-meta")).toHaveText(["CSS · 500 ms"]);
  const frame = f.locator(".pane iframe").contentFrame();
  await frame.locator("#go").evaluate((a: HTMLAnchorElement) => a.click());
  await page.waitForTimeout(500);
  expect((await plugin.messages()).filter((m: any) => m.type === "submit")).toEqual([]);
  expect(await frame.locator("iframe, script:not([nonce])").count()).toBe(0);
});

test("the small sample renders, and a loop with negative delays is one cycle long", async ({ page }) => {
  const review = round();
  review.payload = JSON.parse(fs.readFileSync(path.join(dir, "samples", "loading.json"), "utf8")).payload;
  delete (review as any).attachments;
  const plugin = await mountPlugin(page, dir, { review });
  await expect(plugin.frame.locator(".pick-meta")).toHaveText(["CSS · 900 ms · loops", "CSS · 1200 ms · loops"]);
});

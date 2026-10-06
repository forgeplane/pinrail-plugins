import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The view alone, under the harness: three steps of a setup wizard, as HTML.
const dir = path.resolve(__dirname, "..");
const wizard = () => fixture(path.join(dir, "fixtures", "wizard.json"));
const decidedWizard = () => fixture(path.join(dir, "fixtures", "wizard.decided.json"));

// the schemas, checked the way the app checks them
const sdk = createRequire(fs.realpathSync(path.join(dir, "..", "node_modules", "pinrail-sdk", "package.json")));
const Ajv2020 = sdk("ajv/dist/2020").default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const validPayload = ajv.compile(read("schemas/payload.schema.json"));
const validDecision = ajv.compile(read("schemas/decision.schema.json"));

/** Presses a key with the focus in the view, as a person would after a click on the canvas. */
async function key(plugin, page, name: string) {
  await plugin.frame.locator(".zoom .level").click();
  await page.keyboard.press(name);
}

async function mount(page, opts: Record<string, any> = {}) {
  await page.setViewportSize({ width: 1400, height: 800 });
  const plugin = await mountPlugin(page, dir, { review: wizard(), ...opts });
  await expect(plugin.frame.locator(".frame")).toHaveCount((opts.review ?? wizard()).payload.frames.length);
  return plugin;
}

/** The element inside an HTML frame's shadow root, as a locator. */
const inFrame = (plugin, frame: string, selector: string) =>
  plugin.frame.locator(`section[data-frame="${frame}"] .host`).locator(selector);

test("the payloads it ships with pass its schema, and so does the decided round", () => {
  expect(validPayload(read("samples/setup-wizard.json").payload)).toBe(true);
  expect(validPayload(wizard().payload)).toBe(true);
  expect(validDecision(decidedWizard().decision.data)).toBe(true);
  // a frame needs exactly one of html, file and image
  expect(validPayload({ frames: [{ id: "a", title: "A" }] })).toBe(false);
  expect(validPayload({ frames: [{ id: "a", title: "A", html: "<p>", image: { $attachment: "a.png" } }] })).toBe(false);
});

test("lays the frames out in a row under their group, with the arrows of the flow, all on screen", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await expect(f.locator(".frame-head .title")).toHaveText(["1. Welcome", "2. Account", "3. Done"]);
  await expect(f.locator(".group-title")).toHaveText("Setup");
  await expect(f.locator(".arrow")).toHaveCount(2);
  await expect(f.locator(".frame-head .size").first()).toHaveText("560×380");
  await expect(inFrame(plugin, "welcome", "h1")).toHaveText("Welcome to Acme");
  for (const id of ["welcome", "account", "done"])
    await expect(f.locator(`section[data-frame="${id}"]`)).toBeInViewport({ ratio: 1 });
  const [a, b] = await Promise.all(
    ["welcome", "account"].map((id) => f.locator(`section[data-frame="${id}"]`).boundingBox()),
  );
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
  expect(b!.x).toBeGreaterThan(a!.x + a!.width);
  await expect(f.locator("#tally")).toHaveText("3 frames, 0 marked, 0 comments");
});

test("pins a comment to an element, marks frames, and hands over what the schema takes", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await key(plugin, page, "c");
  await expect(f.locator('.tools [data-tool="comment"]')).toHaveAttribute("aria-pressed", "true");

  // the element under the pointer is outlined, and a click pins to it
  const email = inFrame(plugin, "account", "#email");
  await email.hover();
  await expect(f.locator('section[data-frame="account"] .hover-box')).toBeVisible();
  await email.click();
  await expect(f.locator("#comment-dialog")).toBeVisible();
  await expect(f.locator("#comment-dialog .where")).toContainText("2. Account");
  await expect(f.locator("#comment-dialog .where")).toContainText("#email");
  await f.locator("#compose-body").fill("Say why we ask for an email.");
  await f.locator("#compose-body").press("Enter");
  await expect(f.locator("#comment-dialog")).toBeHidden();
  await expect(f.locator('section[data-frame="account"] .pin')).toHaveText("1");
  await expect(f.locator('[data-row="account"] .card .body')).toHaveText("Say why we ask for an email.");

  // the marks, on the side and on the canvas
  await f.locator('[data-row="welcome"] [data-mark="approved"]').click();
  await f.locator('[data-row="account"] [data-mark="changes"]').click();
  await expect(f.locator('section[data-frame="account"] .frame-head .status')).toHaveText("Changes");
  await expect(f.locator("#tally")).toHaveText("3 frames, 2 marked, 1 comment");

  await plugin.collect();
  await expect(f.locator("#errors")).toHaveText("Choose Approve or Request changes first.");
  await f.locator('[data-verdict="request_changes"]').click();
  await expect.poll(() => plugin.lastStatus()).toBe("Request changes · 1 comment");
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(validDecision(decision), JSON.stringify(validDecision.errors)).toBe(true);
  expect(decision.frames).toEqual([
    { id: "welcome", status: "approved" },
    { id: "account", status: "changes" },
    { id: "done", status: "unmarked" },
  ]);
  expect(decision.comments).toHaveLength(1);
  expect(decision.comments[0]).toMatchObject({
    id: 1,
    frame: "account",
    selector: "#email",
    tag: "input",
    body: "Say why we ask for an email.",
  });
  expect(decision.comments[0].x).toBeGreaterThan(0.1);
  expect(decision.comments[0].x).toBeLessThan(0.9);
});

test("a comment in the list leads to its frame, and a pin opens it for editing", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator('.tools [data-tool="comment"]').click();
  await inFrame(plugin, "done", "h1").click();
  await f.locator("#compose-body").fill("Show what was set up.");
  await f.locator("#compose-body").press("Enter");

  // zoomed out, the comment brings its frame back into view, and closer
  await f.locator("#zoom-out").click();
  await f.locator("#zoom-out").click();
  const before = await f.locator("#zoom-level").textContent();
  await f.locator(".card .body").click();
  await expect(f.locator('section[data-frame="done"]')).toHaveClass(/selected/);
  await expect(f.locator('section[data-frame="done"]')).toBeInViewport({ ratio: 1 });
  expect(parseInt((await f.locator("#zoom-level").textContent())!)).toBeGreaterThan(parseInt(before!));

  await f.locator('section[data-frame="done"] .pin').click();
  await expect(f.locator("#compose-body")).toHaveValue("Show what was set up.");
  await f.locator("#compose-body").fill("Show what was set up, and where.");
  await f.locator("#compose-save").click();
  await expect(f.locator(".card .body")).toHaveText("Show what was set up, and where.");
  await expect
    .poll(async () => (await plugin.lastDraft())?.comments?.[0]?.body)
    .toBe("Show what was set up, and where.");

  // the draft comes back after a reload, and a comment can go
  await plugin.reinit();
  await expect(f.locator(".card .body")).toHaveText("Show what was set up, and where.");
  await f.locator("[data-delete]").click();
  await expect(f.locator(".card")).toHaveCount(0);
  await expect(f.locator(".pin")).toHaveCount(0);
});

test("Escape closes the dialog without a comment, then leaves the comment tool", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await key(plugin, page, "c");
  await inFrame(plugin, "welcome", "h1").click();
  await f.locator("#compose-body").fill("Not this one");
  await f.locator("#compose-body").press("Escape");
  await expect(f.locator("#comment-dialog")).toBeHidden();
  await expect(f.locator(".pin")).toHaveCount(0);
  await expect(f.locator('.tools [data-tool="comment"]')).toHaveAttribute("aria-pressed", "true");
  await key(plugin, page, "Escape");
  await expect(f.locator('.tools [data-tool="move"]')).toHaveAttribute("aria-pressed", "true");
});

test("drags and scrolls to pan, zooms with the buttons, the keys and a pinch", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const welcome = f.locator('section[data-frame="welcome"]');
  const at = async () => (await welcome.boundingBox())!;

  const start = await at();
  const box = (await f.locator("#viewport").boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height - 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + box.height - 80, { steps: 4 });
  await page.mouse.up();
  const dragged = await at();
  expect(dragged.x - start.x).toBeCloseTo(100, 0);
  expect(dragged.y - start.y).toBeCloseTo(-50, 0);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  expect((await at()).y).toBeCloseTo(dragged.y - 120, 0);

  await key(plugin, page, "1");
  await expect(f.locator("#zoom-level")).toHaveText("100%");
  await f.locator("#zoom-in").click();
  await expect(f.locator("#zoom-level")).toHaveText("125%");
  await key(plugin, page, "-");
  await expect(f.locator("#zoom-level")).toHaveText("100%");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -50);
  await page.keyboard.up("Control");
  expect(parseInt((await f.locator("#zoom-level").textContent())!)).toBeGreaterThan(100);
  await f.locator("#zoom-fit").click();
  await expect(welcome).toBeInViewport({ ratio: 1 });
});

test("an image frame shows the image at its own size, and a comment on it has a point but no element", async ({
  page,
}) => {
  const review = {
    ...wizard(),
    payload: { frames: [{ id: "shot", title: "Screenshot", image: { $attachment: "halves.png" } }] },
  };
  const plugin = await mount(page, { review, attachments: { "halves.png": "fixtures/halves.png" } });
  const f = plugin.frame;
  await expect(f.locator('section[data-frame="shot"] .frame-head .size')).toHaveText("400×300");
  await expect(f.locator('section[data-frame="shot"] img')).toBeVisible();
  await f.locator('.tools [data-tool="comment"]').click();
  const img = (await f.locator('section[data-frame="shot"] .frame-body').boundingBox())!;
  await page.mouse.click(img.x + img.width * 0.25, img.y + img.height * 0.5);
  await expect(f.locator("#comment-dialog .where")).toContainText("25 % across, 50 % down");
  await f.locator("#compose-body").fill("Too dark.");
  await f.locator("#compose-body").press("Enter");
  await f.locator('[data-verdict="approve"]').click();
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(validDecision(decision)).toBe(true);
  expect(decision.comments[0]).not.toHaveProperty("selector");
  expect(decision.comments[0].x).toBeCloseTo(0.25, 1);
});

test("nothing in an HTML frame runs, and its styles stay inside it", async ({ page }) => {
  const review = {
    ...wizard(),
    payload: {
      frames: [
        {
          id: "x",
          title: "Hostile",
          width: 400,
          html: `<style>body { background: rgb(1, 2, 3); } .verdict { display: none; }</style><body><script>window.ran = true</script><img src="x" onerror="window.ran = true"><a href="javascript:window.ran = true">link</a><p>Hello</p></body>`,
        },
      ],
    },
  };
  const plugin = await mount(page, { review });
  const f = plugin.frame;
  await expect(inFrame(plugin, "x", "p")).toHaveText("Hello");
  await inFrame(plugin, "x", "a").click();
  expect(await f.locator("body").evaluate(() => (window as any).ran)).toBeUndefined();
  await expect(inFrame(plugin, "x", ".canvas-body")).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(f.locator("#verdict")).toBeVisible();
});

test("with variants, one group can be starred as the favorite, on the canvas or the side", async ({ page }) => {
  const base = wizard().payload.frames;
  const review = {
    ...wizard(),
    payload: {
      variants: true,
      frames: [
        { ...base[0], id: "a1", group: "A: Steps" },
        { ...base[1], id: "a2", group: "A: Steps" },
        { ...base[0], id: "b1", group: "B: One page" },
      ],
    },
  };
  const plugin = await mount(page, { review });
  const f = plugin.frame;
  await expect(f.locator(".group-title")).toHaveText([/A: Steps/, /B: One page/]);
  await expect(f.locator(".group-row .group-name")).toHaveText(["A: Steps", "B: One page"]);

  // a star on the canvas and its twin on the side
  await f.locator('.group-title [data-favorite="B: One page"]').click();
  await expect(f.locator('.group-row [data-favorite="B: One page"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator('.group-title [data-favorite="B: One page"]')).toHaveText("Favorite");
  // one favorite at a time
  await f.locator('.group-row [data-favorite="A: Steps"]').click();
  await expect(f.locator('[aria-pressed="true"][data-favorite]')).toHaveCount(2);
  await expect(f.locator('.group-title [data-favorite="A: Steps"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await plugin.lastDraft())?.favorite).toBe("A: Steps");

  await f.locator('[data-verdict="approve"]').click();
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(validDecision(decision)).toBe(true);
  expect(decision.favorite).toBe("A: Steps");

  // read-only, only the favorite shows its star
  await plugin.sendSubmitted({ decided_by: "you", decided_at: "2026-10-04T12:00:00Z", data: decision });
  await expect(f.locator('.group-title [data-favorite="A: Steps"]')).toBeVisible();
  await expect(f.locator('.group-title [data-favorite="B: One page"]')).toBeHidden();
});

test("a decided review shows the marks and the comments, read-only", async ({ page }) => {
  const plugin = await mount(page, { review: decidedWizard(), readonly: true });
  const f = plugin.frame;
  await expect(f.locator(".decided")).toContainText("Changes requested");
  await expect(f.locator('[data-row="welcome"] .marked')).toHaveText("Approved");
  await expect(f.locator('[data-row="account"] .marked')).toHaveText("Needs changes");
  await expect(f.locator('[data-row="done"] .marked')).toHaveText("Not marked");
  await expect(f.locator(".pin")).toHaveText(["1", "2"]);
  await expect(f.locator("[data-mark], [data-edit]")).toHaveCount(0);
  await expect(f.locator(".tools")).toBeHidden();
  await f.locator('section[data-frame="account"] .pin').click();
  await expect(f.locator('[data-comment="1"]')).toHaveClass(/flash/);
});

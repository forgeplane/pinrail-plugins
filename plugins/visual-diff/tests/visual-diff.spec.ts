import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The view alone, under the harness: no app, no CLI.
const dir = path.resolve(__dirname, "..");
const round = () => fixture(path.join(dir, "fixtures", "acme.json"));
const decided = () => fixture(path.join(dir, "fixtures", "acme.decided.json"));

// every decision is checked against the plugin's own schema, as the app does
const sdkDir = path.dirname(require.resolve("pinrail-sdk/package.json"));
const Ajv2020 = require(require.resolve("ajv/dist/2020", { paths: [sdkDir] }));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(fs.readFileSync(path.join(dir, "schemas", "decision.schema.json"), "utf8")),
);
const valid = (d: unknown) => {
  const ok = validate(d);
  if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2));
  return ok;
};

async function open(page: Page, opts: Record<string, any> = {}) {
  const plugin = await mountPlugin(page, dir, { review: round(), ...opts });
  const f = plugin.frame;
  await expect(f.locator("#stage canvas").first()).toBeAttached();
  await expect(f.locator(".pick .thumb img")).toHaveCount(2);
  await f.locator("#pair-name").click(); // the frame takes the keys from here
  return { plugin, f };
}

async function boxOf(page: Page, locator: any) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not on screen");
  return b;
}

test("shows every pair in the rail, the first on the stage, and what it claims to address", async ({ page }) => {
  const { f } = await open(page);
  await expect(f.locator(".pick")).toHaveCount(2);
  await expect(f.locator(".pick-name")).toHaveText(["Pro plan card", "Sign-up form"]);
  await expect(f.locator("#pair-name")).toHaveText("Pro plan card");
  await expect(f.locator("[data-mode]")).toHaveText(["Wipe 1", "Side by side 2", "Onion skin 3", "Difference 4"]);
  // the wipe: both images in one frame, the before one clipped at the divider
  await expect(f.locator('[data-frame="single"] canvas')).toHaveCount(2);
  await expect(f.locator("#handle")).toHaveAttribute("aria-valuenow", "50");
  await expect(f.locator(".ask")).toHaveCount(3);
  await expect(f.locator(".ask").nth(2)).toContainText("“Unlimted projects” is misspelled.");
  await expect(f.locator(".ask").nth(2)).toContainText("Changed: Fixed the typo.");
  // each request's region is marked on the image
  await expect(f.locator(".mark.req .mark-label")).toHaveText(["R1", "R2", "R3"]);
  await expect(f.locator(".summary")).toContainText("Price and button reworked");
});

test("the wipe follows a drag and the arrow keys, across or down", async ({ page }) => {
  const { f } = await open(page);
  const frame = await boxOf(page, f.locator('[data-frame="single"]'));
  const handle = await boxOf(page, f.locator("#handle .grip"));
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.25, handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(f.locator("#handle")).toHaveAttribute("aria-valuenow", "25");
  await expect(f.locator("#amount")).toHaveValue("25");
  // the before image shows only left of the divider
  expect(await f.locator("#stage").evaluate((el) => el.style.getPropertyValue("--wipe"))).toBe("25%");

  await f.locator("#pair-name").click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(f.locator("#handle")).toHaveAttribute("aria-valuenow", "37");

  await page.keyboard.press("v");
  await expect(f.locator("#stage")).toHaveClass(/dir-v/);
  await expect(f.locator("#handle")).toHaveAttribute("aria-orientation", "vertical");
  await page.keyboard.press("ArrowDown");
  await expect(f.locator("#handle")).toHaveAttribute("aria-valuenow", "39");
});

test("number keys switch between the wipe, side by side, onion skin and the difference", async ({ page }) => {
  const { f } = await open(page);
  await page.keyboard.press("2");
  await expect(f.locator('[data-mode="side"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator(".pane-label")).toHaveText(["Before", "After"]);
  await expect(f.locator('[data-frame="before"] canvas')).toHaveCount(1);
  await expect(f.locator('[data-frame="after"] canvas')).toHaveCount(1);
  // where each request was asked, on the before image too
  await expect(f.locator('[data-frame="before"] .mark.req')).toHaveCount(3);

  await page.keyboard.press("3");
  await expect(f.locator("#amount")).toHaveAccessibleName("After opacity");
  await f.locator("#amount").fill("80");
  expect(await f.locator("#stage").evaluate((el) => el.style.getPropertyValue("--fade"))).toBe("0.8");

  await page.keyboard.press("1");
  await expect(f.locator("#handle")).toBeVisible();
});

test("the difference lights up what changed and finds the change nobody asked for", async ({ page }) => {
  const { plugin, f } = await open(page);
  await page.keyboard.press("4");
  await expect(f.locator('[data-frame="single"] canvas')).toHaveCount(1);
  await expect(f.locator("#diff-facts")).toContainText("5 changed areas");
  await expect(f.locator("#diff-facts")).toContainText("1 outside every request");
  await expect(f.locator("button.mark.change")).toHaveCount(5);
  // the requests each saw pixels change where they were asked
  await expect(f.locator(".ask .seen")).toHaveText([
    "pixels changed here",
    "pixels changed here",
    "pixels changed here",
  ]);

  // the footer lost "Cancel anytime": listed apart, and one click from a comment
  const extra = f.locator(".extra li");
  await expect(extra).toHaveCount(1);
  await extra.getByRole("button", { name: "Comment" }).click();
  await expect(f.locator("#pop")).toBeVisible();
  await f.locator("#pick-note").fill("“Cancel anytime” is gone. Put it back.");
  await f.locator("#pick-note").press("Enter");
  await expect(f.locator(".found li")).toHaveCount(1);
  await expect(f.locator(".mark.new")).toHaveCount(1);
  await expect(extra).toContainText("see comment 1");
  await expect(extra.getByRole("button", { name: "Comment" })).toHaveCount(0);

  // the highlight is drawn: its pixels are the highlight colour where the footer changed
  const lit = await f.locator('[data-frame="single"] canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 1] + 60 && d[i + 2] > d[i + 1] + 40) n++;
    return n;
  });
  expect(lit).toBeGreaterThan(1000);

  // less sensitive, fewer changes
  await f.locator("#amount").fill("0");
  await expect(f.locator("#amount-out")).toHaveText("0");

  await plugin.collect();
  await plugin.collect();
  const d = await plugin.nextSubmit();
  valid(d);
  const pricing = d.decisions.find((x: any) => x.id === "pricing");
  expect(pricing.action).toBe("revise");
  const c = pricing.comments[0];
  expect(c.note).toBe("“Cancel anytime” is gone. Put it back.");
  expect(c.pixels.x).toBe(Math.round(c.region.x * 792));
  expect(c.pixels.y).toBe(Math.round(c.region.y * 974));
  expect(c.region.y).toBeGreaterThan(0.8);
});

test("each request is marked fixed, partly or not fixed, by click or by key, with a note", async ({ page }) => {
  const { plugin, f } = await open(page);
  await page.keyboard.press("f"); // R1 fixed
  await page.keyboard.press("n");
  await f.locator('[data-outcome="fixed"][data-for="1"]').click(); // R2 fixed
  await page.keyboard.press("n");
  await expect(f.locator('.ask[aria-current="true"] .rid')).toHaveText("R3");
  await page.keyboard.press("x"); // R3 not fixed
  await f.locator('[data-note-for="2"]').fill("Still misspelled, now as “projcts”.");
  await expect(f.locator(".mark.req.o-not_fixed")).toHaveCount(1);
  // anything not fixed sends the pair back, from the marks alone
  await expect(f.locator('.choice[data-action="revise"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator(".pick").nth(0).locator(".chip")).toHaveText("Another pass");

  await f.locator("#pair-name").click();
  await page.keyboard.press("j");
  await expect(f.locator("#pair-name")).toHaveText("Sign-up form");
  await page.keyboard.press("f");
  await page.keyboard.press("n");
  await page.keyboard.press("p");
  await expect(f.locator(".tally")).toContainText("3 fixed");
  await expect(f.locator(".tally")).toContainText("1 partly");
  await expect(f.locator(".tally")).toContainText("1 not fixed");

  await plugin.collect();
  const d = await plugin.nextSubmit();
  valid(d);
  expect(d).toEqual({
    decisions: [
      {
        id: "pricing",
        action: "revise",
        requests: [
          { id: "R1", outcome: "fixed" },
          { id: "R2", outcome: "fixed" },
          { id: "R3", outcome: "not_fixed", note: "Still misspelled, now as “projcts”." },
        ],
      },
      {
        id: "signup",
        action: "revise",
        requests: [
          { id: "R4", outcome: "fixed" },
          { id: "R5", outcome: "partly" },
        ],
      },
    ],
    undecided: [],
  });
});

test("a region dragged on the after image, or a point clicked, goes back in fractions and pixels", async ({ page }) => {
  const { plugin, f } = await open(page);
  await page.keyboard.press("2"); // side by side: comments go on the after pane
  const after = await boxOf(page, f.locator('[data-frame="after"]'));
  await page.mouse.move(after.x + after.width * 0.1, after.y + after.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(after.x + after.width * 0.5, after.y + after.height * 0.4, { steps: 6 });
  await page.mouse.up();
  await expect(f.locator("#pop")).toContainText("This area");
  await f.locator("#pick-note").fill("The price crowds the blurb");
  await f.locator('[data-pop="add"]').click();

  const again = await boxOf(page, f.locator('[data-frame="after"]')); // the sheet may have scrolled
  await page.mouse.click(again.x + again.width * 0.75, again.y + again.height * 0.7); // inside the 720 px viewport
  await expect(f.locator("#pop")).toContainText("This point");
  await page.keyboard.type("Too much space under the footer");
  await page.keyboard.press("Enter");

  // escape leaves a third one unsaid
  await page.mouse.click(again.x + again.width * 0.5, again.y + again.height * 0.5);
  await page.keyboard.press("Escape");
  await expect(f.locator("#pop")).toHaveCount(0);
  await expect(f.locator(".found li")).toHaveCount(2);
  await expect(f.locator(".found li").nth(1)).toContainText("point at");

  await f.locator("#pair-name").click();
  await page.keyboard.press("a");
  await plugin.collect();
  await plugin.collect();
  const d = await plugin.nextSubmit();
  valid(d);
  const [box, pt] = d.decisions[0].comments;
  expect(d.decisions[0].action).toBe("accept");
  expect(box.region.x).toBeCloseTo(0.1, 1);
  expect(box.region.y).toBeCloseTo(0.2, 1);
  expect(box.region.w).toBeCloseTo(0.4, 1);
  expect(box.region.h).toBeCloseTo(0.2, 1);
  expect(box.pixels).toEqual({
    x: Math.round(box.region.x * 792),
    y: Math.round(box.region.y * 974),
    w: Math.round(box.region.w * 792),
    h: Math.round(box.region.h * 974),
  });
  expect(pt.region.w).toBe(0);
  expect(pt.region.h).toBe(0);
  expect(pt.region.x).toBeCloseTo(0.75, 1);
  expect(pt.note).toBe("Too much space under the footer");
});

test("verdicts by key, a warning before undecided work goes back, and every request fixed means accepted", async ({
  page,
}) => {
  const { plugin, f } = await open(page);
  // all three fixed and nothing found: accepted without a word
  await page.keyboard.press("f");
  await page.keyboard.press("n");
  await page.keyboard.press("f");
  await page.keyboard.press("n");
  await page.keyboard.press("f");
  await expect(f.locator('.choice[data-action="accept"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator('.choice[data-action="accept"]')).toHaveClass(/derived/);
  // said out loud, it holds even when a request is not fixed
  await page.keyboard.press("a");
  await page.keyboard.press("p");
  await expect(f.locator('.choice[data-action="accept"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator('.choice[data-action="accept"]')).not.toHaveClass(/derived/);
  await f.locator("#note").fill("Good enough to ship; tidy R3 later");

  await plugin.collect();
  await expect.poll(() => plugin.lastStatus()).toBe("Hand over with 1 pair undecided and 2 requests unchecked");
  await plugin.collect();
  const d = await plugin.nextSubmit();
  valid(d);
  expect(d).toEqual({
    decisions: [
      {
        id: "pricing",
        action: "accept",
        note: "Good enough to ship; tidy R3 later",
        requests: [
          { id: "R1", outcome: "fixed" },
          { id: "R2", outcome: "fixed" },
          { id: "R3", outcome: "partly" },
        ],
      },
    ],
    undecided: ["signup"],
  });
});

test("a pair checked part way goes back with the rest listed as unchecked", async ({ page }) => {
  const { plugin, f } = await open(page);
  await page.keyboard.press("f");
  // waiting for the rest, not yet a verdict
  await expect(f.locator(".pick").nth(0).locator(".chip")).toHaveText("—");
  await page.keyboard.press("j");
  await page.keyboard.press("r");
  await plugin.collect();
  await plugin.collect();
  const d = await plugin.nextSubmit();
  valid(d);
  expect(d.decisions).toEqual([
    { id: "pricing", action: "revise", requests: [{ id: "R1", outcome: "fixed" }], unchecked: ["R2", "R3"] },
    { id: "signup", action: "revise", requests: [], unchecked: ["R4", "R5"] },
  ]);
});

test("work in progress is kept as a draft and comes back as it was left", async ({ page }) => {
  const { plugin, f } = await open(page);
  await page.keyboard.press("x");
  await f.locator('[data-note-for="0"]').fill("Still smaller than the plan name");
  await f.locator("#pair-name").click();
  await page.keyboard.press("3");
  await expect
    .poll(async () => (await plugin.lastDraft())?.marks?.pricing?.requests?.R1?.note)
    .toBe("Still smaller than the plan name");
  await expect.poll(async () => (await plugin.lastDraft())?.ui?.mode).toBe("onion");
  await plugin.reinit();
  await expect(f.locator('[data-mode="onion"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator('[data-outcome="not_fixed"][data-for="0"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator('[data-note-for="0"]')).toHaveValue("Still smaller than the plan name");
});

test("a decided round is read-only and shows what was decided", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: decided(), readonly: true });
  const f = plugin.frame;
  await expect(f.locator("#stage canvas").first()).toBeAttached();
  await expect(f.locator(".pick").nth(0).locator(".chip")).toHaveText("Another pass");
  await expect(f.locator('.choice[data-action="revise"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator(".choice").first()).toBeDisabled();
  await expect(f.locator(".out").first()).toBeDisabled();
  await expect(f.locator('[data-outcome="not_fixed"][data-for="2"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator(".readnote")).toHaveText("Still misspelled, now as “projcts”.");
  await expect(f.locator(".found li")).toHaveCount(1);
  await expect(f.locator(".found li")).not.toContainText("Remove");
  await expect(f.locator("#note")).toHaveValue(/typo and the footer/);
  // looking still works: the modes switch, nothing can be drawn
  await f.locator("#pair-name").click();
  await page.keyboard.press("2");
  await expect(f.locator(".pane-label")).toHaveCount(2);
  await expect(f.locator(".overlay.drawable")).toHaveCount(0);
  await plugin.collect();
  expect((await plugin.messages()).filter((m: any) => m.type === "submit")).toHaveLength(0);
});

test("the next round shows what was said about each request last time", async ({ page }) => {
  const { f } = await open(page, { previous: decided() });
  await expect(f.locator(".previous")).toContainText("Another pass");
  await expect(f.locator(".previous")).toContainText("The typo and the footer");
  await expect(f.locator(".ask").nth(2).locator(".rmeta")).toContainText("Not fixed");
  await expect(f.locator(".ask").nth(2).locator(".rmeta")).toContainText("now as “projcts”");
});

test("an image that cannot be read says so, and the pair can still be judged", async ({ page }) => {
  const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "compare-")), "pricing-after.png");
  fs.writeFileSync(broken, "not a png");
  const files = Object.fromEntries(
    ["pricing-before.png", "signup-before.png", "signup-after.png"].map((n) => [n, `fixtures/acme/${n}`]),
  );
  const plugin = await mountPlugin(page, dir, {
    review: round(),
    attachments: { ...files, "pricing-after.png": broken },
  });
  const f = plugin.frame;
  await expect(f.locator(".broken")).toContainText("The after image could not be read");
  await expect(f.locator(".pick").nth(0)).toContainText("can't read it");
  await expect(f.locator(".pick .thumb img")).toHaveCount(1);
  await f.locator('.choice[data-action="revise"]').click();
  await f.locator("#note").fill("The screenshot came through broken; send it again");
  await f.locator(".pick").nth(1).click();
  await expect(f.locator("#stage canvas").first()).toBeAttached();
  await plugin.collect();
  await plugin.collect();
  const d = await plugin.nextSubmit();
  valid(d);
  expect(d.decisions[0]).toEqual({
    id: "pricing",
    action: "revise",
    note: "The screenshot came through broken; send it again",
    requests: [],
    unchecked: ["R1", "R2", "R3"],
  });
});

test("the images come from files the shell hands over", async ({ page }) => {
  const { plugin } = await open(page);
  const asked = (await plugin.messages())
    .filter((m: any) => m.type === "attachment")
    .map((m: any) => m.name)
    .sort();
  expect(asked).toEqual(["pricing-after.png", "pricing-before.png", "signup-after.png", "signup-before.png"]);
});

test("a decision the app refuses shows why", async ({ page }) => {
  const { plugin, f } = await open(page);
  await plugin.sendViolations([{ path: "/decisions/0/action", message: '"later" is not one of ["accept","revise"]' }]);
  await expect(f.locator(".errors-box")).toContainText("/decisions/0/action");
  await expect.poll(() => plugin.lastStatus()).toMatch(/^Check:/);
});

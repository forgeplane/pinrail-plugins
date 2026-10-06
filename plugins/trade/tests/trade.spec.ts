import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The view alone, under the harness: a buy of gold on sample candles.
const dir = path.resolve(__dirname, "..");
const gold = () => fixture(path.join(dir, "fixtures", "gold.json"));
const decidedGold = () => fixture(path.join(dir, "fixtures", "gold.decided.json"));

// the schemas, checked the way the app checks them
const sdk = createRequire(fs.realpathSync(path.join(dir, "..", "..", "node_modules", "pinrail-sdk", "package.json")));
const Ajv2020 = sdk("ajv/dist/2020").default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const validPayload = ajv.compile(read("schemas/payload.schema.json"));
const validDecision = ajv.compile(read("schemas/decision.schema.json"));

async function mount(page, opts: Record<string, any> = {}) {
  // the frame is the page's height; the drags below are measured on a chart
  // of this size
  await page.setViewportSize({ width: 1280, height: 800 });
  const plugin = await mountPlugin(page, dir, { review: gold(), ...opts });
  await expect(plugin.frame.locator("#canvas")).toHaveAttribute("data-candles", /\d+/);
  return plugin;
}

test("the payloads it ships with pass its schema, and so does the decided review", () => {
  expect(validPayload(read("samples/trade.json").payload)).toBe(true);
  expect(validPayload(read("fixtures/gold.json").payload)).toBe(true);
  expect(validDecision(read("fixtures/gold.decided.json").decision.data)).toBe(true);
  expect(validDecision({ verdict: "maybe" })).toBe(false);
});

test("shows the market, the proposal with its distances and multiples, and the reasoning", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await expect(f.locator("#symbol")).toHaveText("XAU/USD");
  await expect(f.locator('#timeframes [aria-pressed="true"]')).toHaveText("1h");
  await expect(f.locator("#last")).toHaveText("3,336.01");
  await expect(f.locator(".side-badge")).toHaveText("buy");
  await expect(f.locator(".headline .what")).toHaveText("Buy 10 oz XAU/USD");

  const figures = f.locator("#figures");
  await expect(figures).toContainText("Limit entry3,331.01−5.00 from last");
  await expect(figures).toContainText("Stop3,321.82−9.19");
  await expect(figures).toContainText("Target 13,344.80+13.79 · 1.5 R");
  await expect(figures).toContainText("Target 23,358.58+27.57 · 3.0 R");
  await expect(figures).toContainText("Loss at the stop91.90 USD");
  await expect(figures).toContainText("Risk1 % of the account");
  await expect(figures).toContainText("Valid untilOct 4, 08:00 UTC");
  await expect(f.locator("#confidence")).toContainText("62 %");

  await expect(f.locator("#reasoning table td").first()).toHaveText("Target 1");
  await expect(f.locator("#reasoning blockquote")).toContainText("not market data");
  await expect(f.locator("#source")).toContainText("not market data");
});

/** The fixture's hourly candles, merged into buckets of `hours`, in UTC. */
function merged(hours: number) {
  const out: any[] = [];
  for (const c of gold().payload.candles) {
    const t = Date.parse(c.t);
    const bucket = t - (t % (hours * 3600_000));
    const last = out[out.length - 1];
    if (last && last.bucket === bucket) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    } else out.push({ bucket, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
  }
  return out;
}
const money = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test("the chart shows the latest candles and zooms in and out", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "120");
  await expect(f.locator("#readout")).toContainText("C 3,336.01");
  await f.locator("#zoom-in").click();
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "80");
  await f.locator("#zoom-out").click();
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "120");

  // the wheel zooms, and a sideways scroll pans back in time
  const chart = f.locator("#chart");
  await chart.hover();
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => Number(await f.locator("#canvas").getAttribute("data-candles"))).toBeLessThan(120);
  await page.mouse.wheel(-600, 0);
  await expect(f.locator("#readout")).not.toContainText("C 3,336.01");

  // the readout follows the pointer: the first candle on the left
  await f.locator('#ranges [data-range="all"]').click();
  const box = (await chart.boundingBox())!;
  await chart.hover({ position: { x: 3, y: box.height / 2 } });
  await expect(f.locator("#readout")).toContainText(`C ${money(gold().payload.candles[0].c)}`);
});

test("a range shows the last day, three days or every candle", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  // the candles span less than a week, so no week
  await expect(f.locator("#ranges button")).toHaveText(["1D", "3D", "All"]);
  await f.locator('#ranges [data-range="1D"]').click();
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "24");
  await f.locator('#ranges [data-range="3D"]').click();
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "72");
  await f.locator('#ranges [data-range="all"]').click();
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "160");
  await expect(f.locator("#readout")).toContainText("C 3,336.01");
});

test("a longer timeframe merges the candles, and the draft keeps it", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  // a week would make two candles: too few to offer
  await expect(f.locator("#timeframes button")).toHaveText(["1h", "4h", "1D"]);

  await f.locator('#timeframes [data-timeframe="4h"]').click();
  await expect(f.locator('#timeframes [aria-pressed="true"]')).toHaveText("4h");
  const four = merged(4);
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", String(four.length));
  const last = four[four.length - 1];
  await expect(f.locator("#readout")).toContainText(
    `Oct 2, 20:00 UTCO ${money(last.o)}H ${money(last.h)}L ${money(last.l)}C ${money(last.c)}V ${last.v.toLocaleString("en-US")}`,
  );
  await expect.poll(async () => (await plugin.lastDraft())?.timeframe).toBe("4h");

  await f.locator('#timeframes [data-timeframe="1D"]').click();
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", String(merged(24).length));
  await expect(f.locator("#readout")).toContainText("Oct 2 UTC");
  await f.locator('#ranges [data-range="1D"]').click();
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "1");

  // drafts go out after a short delay: wait for this one before re-initialising
  await expect.poll(async () => (await plugin.lastDraft())?.timeframe).toBe("1D");
  await plugin.reinit();
  await expect(f.locator('#timeframes [aria-pressed="true"]')).toHaveText("1D");
});

/** The fair value gaps of a run of candles, found the textbook way. */
function gapsOf(cs: any[]) {
  const out: any[] = [];
  for (let i = 2; i < cs.length; i++) {
    const [a, c] = [cs[i - 2], cs[i]];
    let gap: any = null;
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
const shownGaps = async (f) => JSON.parse((await f.locator("#chart").getAttribute("data-gaps"))!);

test("marks the fair value gaps of each timeframe, until they are filled", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const hourly = gapsOf(gold().payload.candles);
  expect(hourly.length).toBeGreaterThan(0);
  expect(hourly.some((g) => g.filled === null)).toBe(true);
  await expect.poll(() => shownGaps(f)).toEqual(hourly);

  await f.locator('#timeframes [data-timeframe="4h"]').click();
  const four = gapsOf(merged(4));
  expect(four).not.toEqual(hourly);
  await expect.poll(() => shownGaps(f)).toEqual(four);

  // they can be hidden, and the draft keeps that
  await expect(f.locator("#show-gaps")).toHaveAttribute("aria-pressed", "true");
  await f.locator("#show-gaps").click();
  await expect.poll(() => shownGaps(f)).toEqual([]);
  await expect.poll(async () => (await plugin.lastDraft())?.gaps).toBe(false);
  await plugin.reinit();
  await expect(f.locator("#show-gaps")).toHaveAttribute("aria-pressed", "false");
});

/** Drags a line of the order on the chart by `dy` pixels. */
async function dragLine(plugin, page, name: string, dy: number) {
  const f = plugin.frame;
  const ys = JSON.parse((await f.locator("#chart").getAttribute("data-lines"))!);
  const box = (await f.locator("#chart").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + ys[name]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + ys[name] + dy / 2);
  await page.mouse.move(box.x + box.width * 0.4, box.y + ys[name] + dy);
  await page.mouse.up();
}
const stopShown = async (f) => Number((await f.locator("#figures dd.stop").first().innerText()).replace(/,/g, ""));

test("dragging the stop moves it, and the decision carries the new stop", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await expect(f.locator("#reset-lines")).toBeDisabled();
  await dragLine(plugin, page, "stop", 40);
  // a drag on a line does not pan the chart
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "120");
  const moved = await stopShown(f);
  expect(moved).toBeLessThan(3321.82);
  await expect(f.locator("#figures")).toContainText("was 3,321.82");
  // the multiples follow the wider stop
  await expect(f.locator("#figures")).not.toContainText("1.5 R");
  await expect(f.locator("#reset-lines")).toBeEnabled();
  await expect.poll(async () => (await plugin.lastDraft())?.stop_loss).toBe(moved);

  await f.locator('[data-verdict="approve"]').click();
  await expect.poll(() => plugin.lastStatus()).toBe("Approve buy XAU/USD · stop moved");
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(decision).toEqual({ verdict: "approve", stop_loss: moved });
  expect(validDecision(decision)).toBe(true);
});

test("a target cannot cross the entry, and the draft keeps the moved targets", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await dragLine(plugin, page, "t1", 400);
  const t1 = Number((await f.locator("#figures dd.target").first().innerText()).replace(/,/g, ""));
  expect(t1).toBeGreaterThan(3331.01);
  expect(t1).toBeLessThan(3332);
  await expect.poll(async () => (await plugin.lastDraft())?.take_profit).toEqual([t1, 3358.58]);

  await plugin.reinit();
  await expect(f.locator("#figures dd.target").first()).toHaveText(
    t1.toLocaleString("en-US", { minimumFractionDigits: 2 }),
  );
  await f.locator('[data-verdict="reject"]').click();
  await plugin.collect();
  expect(await plugin.nextSubmit()).toEqual({ verdict: "reject", take_profit: [t1, 3358.58] });
});

test("reset puts the stop and the targets back where the agent proposed them", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await dragLine(plugin, page, "stop", 30);
  await dragLine(plugin, page, "t2", -30);
  await expect(f.locator("#figures")).toContainText("was 3,358.58");
  await f.locator("#reset-lines").click();
  expect(await stopShown(f)).toBe(3321.82);
  await expect(f.locator("#figures")).not.toContainText("was");
  await expect(f.locator("#reset-lines")).toBeDisabled();
  await f.locator('[data-verdict="approve"]').click();
  await expect.poll(() => plugin.lastStatus()).toBe("Approve buy XAU/USD");
  await plugin.collect();
  expect(await plugin.nextSubmit()).toEqual({ verdict: "approve" });
});

test("a decided review shows the stop the person moved, and its lines do not drag", async ({ page }) => {
  const review = decidedGold();
  review.decision.data = { verdict: "approve", stop_loss: 3315 };
  const plugin = await mountPlugin(page, dir, { review, readonly: true });
  const f = plugin.frame;
  await expect(f.locator("#figures dd.stop").first()).toHaveText("3,315.00");
  await expect(f.locator("#figures")).toContainText("was 3,321.82");
  await expect(f.locator("#reset-lines")).toBeHidden();
  await dragLine(plugin, page, "stop", 40);
  await expect(f.locator("#figures dd.stop").first()).toHaveText("3,315.00");
});

test("draws the candles", async ({ page }) => {
  const plugin = await mount(page);
  // the canvas holds the up and the down colours, not only the background
  const painted = await plugin.frame.locator("#canvas").evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set<string>();
    for (let i = 0; i < data.length; i += 4 * 37)
      if (data[i + 3] > 200) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return colours.size;
  });
  expect(painted).toBeGreaterThan(3);
});

test("approves with a note", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await plugin.collect();
  await expect(f.locator("#errors")).toHaveText("Choose Approve or Reject first.");
  await f.locator('[data-verdict="approve"]').click();
  await expect.poll(() => plugin.lastStatus()).toBe("Approve buy XAU/USD");
  await f.locator("#note").fill("Half size.");
  await expect.poll(async () => (await plugin.lastDraft())?.note).toBe("Half size.");
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(decision).toEqual({ verdict: "approve", note: "Half size." });
  expect(validDecision(decision)).toBe(true);
});

test("rejects, and the draft keeps the verdict", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator('[data-verdict="reject"]').click();
  await expect.poll(() => plugin.lastStatus()).toBe("Reject buy XAU/USD");
  await expect.poll(async () => (await plugin.lastDraft())?.verdict).toBe("reject");
  await plugin.reinit();
  await expect(f.locator('[data-verdict="reject"]')).toHaveAttribute("aria-pressed", "true");
  await plugin.collect();
  expect(await plugin.nextSubmit()).toEqual({ verdict: "reject" });
});

test("a decided review shows its verdict and note, read-only", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: decidedGold(), readonly: true });
  const f = plugin.frame;
  await expect(f.locator(".decided")).toContainText("Rejected by Maya");
  await expect(f.locator(".decided")).toContainText("Wait for the US data at 12:30 before buying.");
  await expect(f.locator("[data-verdict]")).toHaveCount(0);
  await expect(f.locator("#canvas")).toHaveAttribute("data-candles", "120");
});

test("a market order measures from the last close", async ({ page }) => {
  const review = gold();
  delete review.payload.proposal.entry;
  review.payload.proposal.order_type = "market";
  const plugin = await mount(page, { review });
  await expect(plugin.frame.locator("#figures")).toContainText("Market entryat market");
  await expect(plugin.frame.locator("#figures")).toContainText("Stop3,321.82−14.19");
});

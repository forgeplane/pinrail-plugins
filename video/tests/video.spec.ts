import { expect as base, test, webkit } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The view alone, under the harness: no app, no CLI. The fixture is six
// seconds of a test pattern at 30 frames a second, with a beep every second,
// in three scenes of two seconds each.
const dir = path.resolve(__dirname, "..");
const round = () => fixture(path.join(dir, "fixtures", "clip.json"));
const decidedRound = () => fixture(path.join(dir, "fixtures", "clip.decided.json"));
const expect = base.configure({ timeout: 10_000 });

// the schemas, checked the way the app checks them
const sdk = createRequire(fs.realpathSync(path.join(dir, "..", "node_modules", "pinrail-sdk", "package.json")));
const Ajv2020 = sdk("ajv/dist/2020").default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const validDecision = ajv.compile(read("schemas/decision.schema.json"));
const validPayload = ajv.compile(read("schemas/payload.schema.json"));
const decided = (data: unknown) => {
  const ok = validDecision(data);
  if (!ok) throw new Error(JSON.stringify(validDecision.errors, null, 2));
  return ok;
};

async function mount(page, opts: Record<string, any> = {}) {
  const plugin = await mountPlugin(page, dir, { review: round(), ...opts });
  await expect(plugin.frame.locator("#timeline")).toHaveAttribute("data-duration", /^\d+$/);
  return plugin;
}
const pos = async (f) => Number(await f.locator("#timeline").getAttribute("data-pos"));
const press = async (f, ...keys: string[]) => {
  for (const key of keys) await f.locator("body").press(key);
};
/** Drags across an element, between two points given as fractions of its box. */
async function drag(page, target, from: [number, number], to: [number, number]) {
  const box = await target.boundingBox();
  const at = ([x, y]: [number, number]) => [box.x + x * box.width, box.y + y * box.height] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at(to), { steps: 6 });
  await page.mouse.up();
}
async function comment(f, note: string) {
  await f.locator("#mark-note").fill(note);
  await f.locator("#mark-note").press("Enter");
}

test("the payloads it ships with pass its schema, and so does the decided round", () => {
  expect(validPayload(read("samples/video.json").payload)).toBe(true);
  expect(validPayload(read("fixtures/clip.json").payload)).toBe(true);
  expect(decided(read("fixtures/clip.decided.json").decision.data)).toBe(true);
});

test("shows the video with its length, its scenes and its sound", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await expect(f.locator(".top h1")).toHaveText("Test pattern — cut 1");
  await expect(f.locator(".top")).toContainText("640×360");
  await expect(f.locator(".top")).toContainText("30 fps");
  await expect(f.locator("#frame")).toBeVisible();
  await expect(f.locator(".scene")).toHaveText(["Opening", "Middle", "Close"]);
  await expect(f.locator("#track-sound canvas.base")).toBeVisible();
  await expect(f.locator(".notes")).toContainText("test pattern");
  const length = Number(await f.locator("#timeline").getAttribute("data-duration"));
  expect(length).toBeGreaterThan(5900);
  expect(length).toBeLessThan(6100);
});

test("the picture lane fills with frames of the video, each where its moment is on the timeline", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const strip = f.locator("#strip");
  await expect(strip).toHaveAttribute("data-slots", /^[1-9]\d*$/);
  const slots = Number(await strip.getAttribute("data-slots"));
  expect(slots).toBeGreaterThanOrEqual(4);
  await expect(strip).toHaveAttribute("data-frames", String(slots));
  // every slot is painted, and the frames are not all one picture: the test pattern moves
  const sums = await strip.evaluate((canvas: HTMLCanvasElement, n) => {
    const g = canvas.getContext("2d")!;
    const slot = canvas.width / n;
    return Array.from({ length: n }, (_, i) => {
      const { data } = g.getImageData(Math.floor(i * slot + slot / 2) - 4, Math.floor(canvas.height / 2) - 4, 8, 8);
      let alpha = 0,
        colour = 0;
      for (let p = 0; p < data.length; p += 4) {
        alpha += data[p + 3];
        colour += data[p] * 3 + data[p + 1] * 5 + data[p + 2] * 7;
      }
      return { alpha, colour };
    });
  }, slots);
  expect(sums.every((x) => x.alpha === 8 * 8 * 255)).toBe(true);
  expect(new Set(sums.map((x) => x.colour)).size).toBeGreaterThan(1);
  // a comment's mark is still drawn over the frames
  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight", "c");
  await comment(f, "Here");
  await expect(f.locator("#track-picture .pin")).toHaveCount(1);
  await expect(strip).toHaveAttribute("data-frames", String(slots));
});

test("the arrows step one frame, with shift one second, and space plays and pauses", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator(".top").click();
  await press(f, "ArrowRight");
  await expect(f.locator("#clock")).toContainText("frame 1");
  await press(f, "ArrowRight", "ArrowRight");
  await expect(f.locator("#clock")).toContainText("frame 3");
  await press(f, "ArrowLeft");
  await expect(f.locator("#clock")).toContainText("frame 2");
  await press(f, "Shift+ArrowRight");
  await expect.poll(() => pos(f)).toBeGreaterThan(1000);
  await press(f, "Home");
  await expect.poll(() => pos(f)).toBe(0);

  await press(f, " ");
  await expect(f.locator("#play")).toHaveAttribute("aria-label", "Pause");
  await expect.poll(() => pos(f)).toBeGreaterThan(300);
  await press(f, " ");
  await expect(f.locator("#play")).toHaveAttribute("aria-label", "Play");
  const stopped = await pos(f);
  await page.waitForTimeout(300);
  expect(await pos(f)).toBe(stopped);

  // a click on a scene goes to its start
  await f.locator(".scene", { hasText: "Close" }).click();
  await expect.poll(() => pos(f)).toBe(4000);
  await expect(f.locator(".scene.now")).toHaveText("Close");
});

test("a comment at a moment comes back with its time, its frame and its scene", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight", "c");
  await expect(f.locator("#composing-when")).toContainText("0:01.00");
  await expect(f.locator("#composing-when")).toContainText("frame 30");
  await comment(f, "The pattern jumps here");
  await expect(f.locator("#marks li")).toHaveCount(1);
  await expect(f.locator("#marks li")).toContainText("The pattern jumps here");
  await expect(f.locator("#marks li")).toContainText("Opening");
  await expect(f.locator("#track-picture .pin")).toHaveCount(1);
  await expect.poll(() => plugin.lastStatus()).toBe("Request changes · 1 comment");

  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d.verdict).toBe("request_changes");
  expect(d.video).toMatchObject({ width: 640, height: 360, fps: 30 });
  expect(d.comments).toEqual([
    { on: "picture", at_ms: 1000, at_frame: 30, scenes: ["open"], note: "The pattern jumps here" },
  ]);
});

test("a stretch dragged on the sound lane is a comment on the sound", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await drag(page, f.locator("#track-sound"), [0.5, 0.5], [0.75, 0.5]);
  await expect(f.locator("#span")).toBeVisible();
  // the video went with the drag, to the frame the stretch ends on
  expect(Math.abs((await pos(f)) - 4500)).toBeLessThan(60);
  await f.locator('[data-do="comment-sound"]').click();
  await expect(f.locator('.seg [data-on="sound"]')).toHaveAttribute("aria-pressed", "true");
  await comment(f, "The beep is too loud here");
  await expect(f.locator("#track-sound .pin")).toHaveCount(1);
  await expect(f.locator("#track-picture .pin")).toHaveCount(0);
  await expect(f.locator(".tally")).toContainText("1 on the sound");

  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  const [c] = d.comments;
  expect(c.on).toBe("sound");
  expect(c.note).toBe("The beep is too loud here");
  expect(c.scenes).toEqual(["middle", "close"]);
  expect(Math.abs(c.start_ms - 3000)).toBeLessThan(60);
  expect(Math.abs(c.end_ms - 4500)).toBeLessThan(60);
  expect(c.start_frame).toBe(Math.floor((c.start_ms / 1000) * 30 + 1e-6));
  expect(c.end_frame).toBeGreaterThan(c.start_frame);
  expect(c.region).toBeUndefined();
});

test("an area dragged on the frame is a comment on that frame, in fractions and in pixels", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight", "Shift+ArrowRight");
  await drag(page, f.locator("#overlay"), [0.1, 0.2], [0.4, 0.45]);
  await expect(f.locator("#composing-area")).toContainText(/area \d+,\d+/);
  await expect(f.locator("#overlay .area.drawing")).toHaveCount(1);
  await comment(f, "This corner is too busy");
  await expect(f.locator("#overlay .area .tag")).toHaveText("1");

  // a second comment, on a spot: clicked while it is being written, high on
  // the picture, clear of the comment's dialog over the foot of the video
  await press(f, "Shift+ArrowRight", "c");
  const box = await f.locator("#overlay").boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.15);
  await expect(f.locator("#composing-area")).toContainText(/spot \d+,\d+/);
  await comment(f, "A stray pixel");

  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  const [area, spot] = d.comments;
  expect(area).toMatchObject({
    on: "picture",
    at_ms: 2000,
    at_frame: 60,
    scenes: ["middle"],
    note: "This corner is too busy",
  });
  expect(area.region.shape).toBe("box");
  for (const [key, want] of [
    ["x", 0.1],
    ["y", 0.2],
    ["width", 0.3],
    ["height", 0.25],
  ] as const) {
    expect(Math.abs(area.region[key] - want)).toBeLessThan(0.01);
  }
  expect(Math.abs(area.region.px.x - 64)).toBeLessThan(6);
  expect(Math.abs(area.region.px.width - 192)).toBeLessThan(6);
  expect(spot.region.shape).toBe("point");
  expect(Math.abs(spot.region.x - 0.75)).toBeLessThan(0.01);
  expect(Math.abs(spot.region.y - 0.15)).toBeLessThan(0.01);
  expect(spot.region.width).toBeUndefined();
  expect(Math.abs(spot.region.px.x - 480)).toBeLessThan(6);

  // a click on the first comment in the list opens it again, on its frame, with its area and its words
  await f.locator("#marks li").first().click();
  await expect.poll(() => pos(f)).toBe(2000);
  await expect(f.locator("#mark-note")).toHaveValue("This corner is too busy");
  await expect(f.locator("#composing-area")).toContainText("area");
  await expect(f.locator("#overlay .area.drawing")).toHaveCount(1);
});

test("the comment is a dialog on top of the video: beside the area it marks, and where it is moved to", async ({
  page,
}) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const box = (selector: string) => f.locator(selector).boundingBox();
  const apart = (a: any, b: any) =>
    a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height;

  // at a moment: over the foot of the video, above the playhead
  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight", "Shift+ArrowRight", "Shift+ArrowRight", "c");
  await expect(f.locator("#composer")).toHaveAttribute("role", "dialog");
  let dialog = await box("#composer");
  const stage = await box("#stage");
  const track = await box("#track-picture");
  expect(dialog.y).toBeGreaterThanOrEqual(stage.y);
  expect(dialog.y + dialog.height).toBeLessThanOrEqual(stage.y + stage.height);
  expect(Math.abs(dialog.x + dialog.width / 2 - (track.x + track.width / 2))).toBeLessThan(24);
  await press(f, "Escape");
  await expect(f.locator("#mark-note")).toHaveCount(0);

  // on an area: beside it, never over it
  await drag(page, f.locator("#overlay"), [0.1, 0.2], [0.4, 0.45]);
  await expect(f.locator("#mark-note")).toBeFocused();
  dialog = await box("#composer");
  expect(apart(dialog, await box("#overlay .area.drawing"))).toBe(true);

  // moved by its head, it stays there while the comment is written
  const head = await box(".composer-head");
  await page.mouse.move(head.x + 6, head.y + 6);
  await page.mouse.down();
  await page.mouse.move(head.x + 6 - 30, head.y + 6 + 40, { steps: 4 });
  await page.mouse.up();
  const moved = await box("#composer");
  expect(Math.round(moved.x - dialog.x)).toBe(-30);
  expect(Math.round(moved.y - dialog.y)).toBe(40);
  await f.locator("#mark-note").fill("Too busy");
  expect((await box("#composer")).x).toBe(moved.x);
  await f.locator("#mark-note").press("Enter");
  await expect(f.locator("#marks li")).toHaveCount(1);
});

test("i and o mark a stretch, a ready phrase fills the comment, and the stretch plays on its own", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight", "Shift+ArrowRight", "i", "Shift+ArrowRight", "Shift+ArrowRight", "o");
  await expect(f.locator("#span")).toHaveText("0:02.00–0:04.00");
  await press(f, "c");
  await expect(f.locator("#composing-when")).toContainText("frames 60–119");
  await f.locator(".quick", { hasText: "Make this shorter" }).click();
  await expect(f.locator("#mark-note")).toHaveValue("Make this shorter");
  await f.locator('[data-do="add"]').click();
  await expect(f.locator("#track-picture .mark.range")).toHaveCount(1);

  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d.comments).toEqual([
    {
      on: "picture",
      start_ms: 2000,
      end_ms: 4000,
      start_frame: 60,
      end_frame: 119,
      scenes: ["middle"],
      note: "Make this shorter",
    },
  ]);

  // shift and a click on a scene selects the whole of it
  await f.locator(".scene", { hasText: "Close" }).click({ modifiers: ["Shift"] });
  await expect(f.locator("#span")).toHaveText("0:04.00–0:06.00");
});

test("the limits of a stretch are dragged one by one, before and after the comment is written", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const length = Number(await f.locator("#timeline").getAttribute("data-duration"));
  const shown = () => f.locator("#video").evaluate((v: HTMLVideoElement) => Math.round(v.currentTime * 1000));
  /** Drags a limit of the selection to a time on the timeline; returns the moment the video showed before it was let go. */
  const pull = async (which: "start" | "end", ms: number) => {
    const grip = await f.locator(`.grip.${which}`).boundingBox();
    const track = await f.locator("#track-picture").boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + (ms / length) * track.width, grip.y + grip.height / 2, { steps: 5 });
    const during = await shown();
    await page.mouse.up();
    return during;
  };
  const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(40);

  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight", "Shift+ArrowRight", "i", "Shift+ArrowRight", "Shift+ArrowRight", "o");
  await expect(f.locator("#span")).toHaveText("0:02.00–0:04.00");
  await expect(f.locator(".grip")).toHaveCount(2);

  // the end, later: the start stays. The video goes to the frame the limit
  // is on while it is dragged, and stays there
  near(await pull("end", 5000), 5000);
  await expect(f.locator("#span")).toHaveText(/^0:02\.00–0:0[45]\.\d\d$/);
  near(await pos(f), 5000);
  // the playhead's line and the limit's line are one line: neither is drawn beside the other
  const middle = async (selector: string) => {
    const box = await f.locator(selector).boundingBox();
    return box.x + box.width / 2;
  };
  expect(Math.abs((await middle("#head")) - (await middle(".grip.end")))).toBeLessThan(0.3);

  // with the comment open, the start, earlier: the comment follows
  await press(f, "c");
  near(await pull("start", 1000), 1000);
  near(await pos(f), 1000);
  await expect(f.locator("#composing-when")).toContainText(/0:0[01]\.\d\d–0:0[45]\.\d\d/);
  await comment(f, "Make this shorter");
  await plugin.collect();
  let d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  near(d.comments[0].start_ms, 1000);
  near(d.comments[0].end_ms, 5000);
  expect(d.comments[0].scenes).toEqual(["open", "middle", "close"]);

  // a comment already made: Edit shows its limits again
  await f.locator("#marks li [data-edit]").click();
  await expect(f.locator(".grip")).toHaveCount(2);
  await expect(f.locator("#sel")).toBeVisible();
  await pull("end", 3000);
  await f.locator('[data-do="add"]').click();
  await expect(f.locator("#sel")).toBeHidden();
  await plugin.collect();
  d = await plugin.nextSubmit(1);
  near(d.comments[0].start_ms, 1000);
  near(d.comments[0].end_ms, 3000);
  expect(d.comments).toHaveLength(1);
});

test("a selection plays on its own, from the transport, from the comment's dialog and with shift and space", async ({
  page,
}) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const playing = () => f.locator("#play").getAttribute("aria-label");
  await f.locator(".top").click();
  await expect(f.locator('[data-do="play-range"]')).toHaveCount(0);
  await press(f, "Shift+ArrowRight", "Shift+ArrowRight", "i", "Shift+ArrowRight", "o", "End");
  await expect(f.locator("#span")).toHaveText("0:02.00–0:03.00");

  // it starts at the start of the selection, wherever the playhead was, and stops at its end
  await f.locator('#transport [data-do="play-range"]').click();
  await expect.poll(playing).toBe("Pause");
  expect(await pos(f)).toBeLessThan(3000);
  await expect.poll(playing).toBe("Play");
  expect(await pos(f)).toBe(3000);

  await press(f, "Home", "Shift+ ");
  await expect.poll(playing).toBe("Pause");
  expect(await pos(f)).toBeGreaterThanOrEqual(2000);
  await expect.poll(playing).toBe("Play");

  // and from the dialog, while the comment is written
  await press(f, "c");
  await f.locator("#mark-note").fill("Hold this longer");
  await f.locator('#composer [data-do="play-range"]').click();
  await expect.poll(playing).toBe("Pause");
  await expect.poll(playing).toBe("Play");
  expect(await pos(f)).toBe(3000);
  await expect(f.locator("#mark-note")).toHaveValue("Hold this longer");
});

test("a click on a comment in the list opens it again: its words in the dialog, and its stretch with both limits to drag", async ({
  page,
}) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const length = Number(await f.locator("#timeline").getAttribute("data-duration"));
  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight", "c");
  await comment(f, "A moment");
  await press(f, "Shift+ArrowRight", "i", "Shift+ArrowRight", "Shift+ArrowRight", "o", "a");
  await comment(f, "Too loud");
  await expect(f.locator("#marks li")).toHaveCount(2);
  await expect(f.locator("#sel")).toBeHidden();
  await press(f, "Home");

  // the comment on a stretch: where it starts and stops shows again, and can be changed
  await f.locator("#marks li").nth(1).click();
  await expect(f.locator("#mark-note")).toHaveValue("Too loud");
  await expect(f.locator('.seg [data-on="sound"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator("#sel")).toBeVisible();
  await expect(f.locator(".grip")).toHaveCount(2);
  await expect(f.locator("#span")).toHaveText("0:02.00–0:04.00");
  await expect(f.locator("#marks li").nth(1)).toHaveClass(/lit/);
  await expect.poll(() => pos(f)).toBe(2000);
  const grip = await f.locator(".grip.end").boundingBox();
  const track = await f.locator("#track-picture").boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + (5000 / length) * track.width, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await f.locator("#mark-note").fill("Too loud, to here");

  // a click on another comment keeps what was changed in the first, and opens the second
  await f.locator("#marks li").first().click();
  await expect(f.locator("#mark-note")).toHaveValue("A moment");
  await expect(f.locator("#sel")).toBeHidden();
  await expect.poll(() => pos(f)).toBe(1000);
  await press(f, "Escape");
  await expect(f.locator("#mark-note")).toHaveCount(0);
  await expect(f.locator("#marks li")).toHaveCount(2);

  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d.comments.map((c: any) => c.note)).toEqual(["A moment", "Too loud, to here"]);
  expect(d.comments[1].start_ms).toBe(2000);
  expect(Math.abs(d.comments[1].end_ms - 5000)).toBeLessThan(40);
  expect(d.comments[1].on).toBe("sound");
});

test("a comment can be edited and removed, and n and p go from one to the next", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight", "c");
  await comment(f, "First");
  await press(f, "Shift+ArrowRight", "Shift+ArrowRight", "a");
  await comment(f, "Second, on the sound");
  await expect(f.locator("#marks li")).toHaveCount(2);

  await press(f, "Home", "n");
  await expect.poll(() => pos(f)).toBe(1000);
  await press(f, "n");
  await expect.poll(() => pos(f)).toBe(3000);
  await press(f, "p");
  await expect.poll(() => pos(f)).toBe(1000);

  await f.locator("#marks li").first().locator("[data-edit]").click();
  await expect(f.locator("#mark-note")).toHaveValue("First");
  await f.locator("#mark-note").fill("First, reworded");
  await f.locator('[data-do="add"]').click();
  await expect(f.locator("#marks li")).toHaveCount(2);
  await expect(f.locator("#marks li").first()).toContainText("First, reworded");

  await f.locator("#marks li").nth(1).locator("[data-remove]").click();
  await expect(f.locator("#marks li")).toHaveCount(1);
  await expect(f.locator("#track-sound .pin")).toHaveCount(0);
});

test("with nothing said the hand-over asks for a verdict first; approve then goes at once", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await plugin.collect();
  await expect.poll(() => plugin.lastStatus()).toBe("Choose first: approve or request changes");
  await expect(f.locator("#choices")).toHaveClass(/ask/);
  expect((await plugin.messages()).filter((m) => m.type === "submit")).toHaveLength(0);

  await f.locator(".top").click();
  await press(f, "g");
  await expect(f.locator('.choice[data-verdict="approve"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => plugin.lastStatus()).toBe("Approve");
  await f.locator("#note").fill("Ship it");
  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d).toMatchObject({ verdict: "approve", note: "Ship it", comments: [] });
});

test("a comment still being written goes with the hand-over", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator(".top").click();
  await press(f, "r", "Shift+ArrowRight", "c");
  await f.locator("#mark-note").fill("Not yet added");
  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d.comments.map((c: any) => c.note)).toEqual(["Not yet added"]);
});

test("a draft comes back as it was left", async ({ page, context }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator(".top").click();
  await press(f, "Shift+ArrowRight");
  await drag(page, f.locator("#overlay"), [0.2, 0.2], [0.5, 0.6]);
  await comment(f, "Too dark here");
  await f.locator("#note").fill("Nearly there");
  await f.locator(".top").click();
  await press(f, "r");
  await expect.poll(async () => (await plugin.lastDraft())?.verdict).toBe("request_changes");

  const again = await mount(await context.newPage(), { draft: await plugin.lastDraft() });
  const g = again.frame;
  await expect(g.locator("#marks li")).toHaveCount(1);
  await expect(g.locator("#marks li")).toContainText("Too dark here");
  await expect(g.locator("#marks li")).toContainText("area");
  await expect(g.locator("#note")).toHaveValue("Nearly there");
  await expect(g.locator('.choice[data-verdict="request_changes"]')).toHaveAttribute("aria-pressed", "true");
});

test("a decided round is read-only and shows what was decided", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, { review: decidedRound(), readonly: true });
  const f = plugin.frame;
  await expect(f.locator("#timeline")).toHaveAttribute("data-duration", /^\d+$/);
  await expect(f.locator("#marks li")).toHaveCount(3);
  await expect(f.locator('.choice[data-verdict="request_changes"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator('.choice[data-verdict="approve"]')).toBeDisabled();
  await expect(f.locator("#note")).toBeDisabled();
  await expect(f.locator("#note")).toHaveValue(/Close\. Two things/);
  await expect(f.locator("[data-remove], [data-edit]")).toHaveCount(0);
  await expect(f.locator("#track-picture .pin")).toHaveCount(2);
  await expect(f.locator("#track-sound .pin")).toHaveCount(1);
  // watching still works, and a comment's area shows on its frame
  await f.locator("#marks li").first().click();
  await expect.poll(() => pos(f)).toBe(1017);
  await expect(f.locator("#overlay .area")).toHaveCount(1);
  await press(f, "c");
  await expect(f.locator("#mark-note")).toHaveCount(0);
});

test("the next round lists what was said about the last one", async ({ page }) => {
  const plugin = await mount(page, { previous: decidedRound() });
  const f = plugin.frame;
  await expect(f.locator(".earlier .verdict")).toContainText("Changes requested");
  await expect(f.locator(".earlier .marks li")).toHaveCount(3);
  await expect(f.locator("#marks li")).toHaveCount(0);
  await f.locator(".earlier .marks li").nth(1).click();
  await expect.poll(() => pos(f)).toBe(2000);
});

test("a video with no sound still plays, and the sound lane says there is no waveform", async ({ page }) => {
  const review = round();
  review.payload.file = { $attachment: "silent.webm" };
  const plugin = await mountPlugin(page, dir, { review, attachments: { "silent.webm": "fixtures/clip/silent.webm" } });
  const f = plugin.frame;
  await expect(f.locator("#timeline")).toHaveAttribute("data-duration", /^\d+$/);
  await expect(f.locator("#track-sound .none")).toContainText("No waveform");
  await expect(f.locator("#play")).toBeEnabled();
});

test("a file that cannot be played says so, and the review can still be sent back", async ({ page }) => {
  const review = round();
  review.payload.file = { $attachment: "broken.mp4" };
  const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "video-")), "broken.mp4");
  fs.writeFileSync(broken, "not a video at all");
  const plugin = await mountPlugin(page, dir, { review, attachments: { "broken.mp4": broken } });
  const f = plugin.frame;
  await expect(f.locator("#stage-msg")).toContainText("could not be played");
  await expect(f.locator("#play")).toBeDisabled();
  await f.locator('.choice[data-verdict="request_changes"]').click();
  await f.locator("#note").fill("It does not play");
  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d).toEqual({ verdict: "request_changes", note: "It does not play", comments: [] });
});

test("in WebKit, the engine of the app's window, a drag marks a stretch or an area and selects nothing on the page", async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const plugin = await mount(page);
    const f = plugin.frame;
    const selection = () => f.locator("body").evaluate(() => getSelection()?.type ?? "None");
    /** Starts a drag across an element and on past its foot, and reports what the page selected before it is let go. */
    const held = async (selector: string, from: [number, number], to: [number, number]) => {
      const box = await f.locator(selector).boundingBox();
      await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
      const type = await selection();
      await page.mouse.up();
      return type;
    };
    const selects: string[] = [];
    if ((await held("#track-sound", [0.3, 0.5], [0.8, 2.5])) === "Range") selects.push("a drag on the sound lane");
    await expect(f.locator("#span")).toBeVisible();
    await press(f, "Escape");
    // a double click, and shift with a click, are how a browser selects without a drag
    await f.locator("#track-sound").dblclick({ position: { x: 200, y: 20 } });
    if ((await selection()) === "Range") selects.push("a double click on the sound lane");
    await f.locator(".scene", { hasText: "Close" }).click({ modifiers: ["Shift"] });
    if ((await selection()) === "Range") selects.push("shift and a click on a scene");
    await press(f, "Escape");
    if ((await held("#overlay", [0.2, 0.2], [0.7, 1.6])) === "Range") selects.push("a drag on the picture");
    await expect(f.locator("#composing-area")).toContainText("area");
    expect(selects).toEqual([]);
    // the comment's own text can still be selected
    await f.locator("#mark-note").fill("Too busy");
    await f.locator("#mark-note").selectText();
    expect(
      await f.locator("#mark-note").evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart),
    ).toBe(8);
  } finally {
    await browser.close();
  }
});

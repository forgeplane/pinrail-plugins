import { expect as base, test } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The view alone, under the harness: no app, no CLI. Headless Chromium plays
// to no speaker, so these tests check what the view shows and hands back.
const dir = path.resolve(__dirname, "..");
const round = () => fixture(path.join(dir, "fixtures", "fieldnotes.json"));
const expect = base.configure({ timeout: 10_000 });

// the decision schema, checked the way the app checks it
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

// the word timings the fixture carries, for the times the decision should hold
const takes = read("fixtures/fieldnotes.json").payload.takes;
const words = (id: string) => takes.find((t: any) => t.id === id).transcript.segments.flatMap((s: any) => s.words);

async function mount(page, opts: Record<string, any> = {}) {
  const plugin = await mountPlugin(page, dir, { review: round(), ...opts });
  await expect(plugin.frame.locator(".mini canvas")).toHaveCount(4);
  return plugin;
}
const pos = async (f) => Number(await f.locator("#wave").getAttribute("data-pos"));

test("the payloads it ships with pass its schema, and so does the decided round", () => {
  expect(validPayload(read("samples/audio.json").payload)).toBe(true);
  expect(validPayload(read("fixtures/fieldnotes.json").payload)).toBe(true);
  expect(decided(read("fixtures/fieldnotes.decided.json").decision.data)).toBe(true);
});

test("every take in the rail with its waveform, the first on the stage with its transcript", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await expect(f.locator(".pick .pick-name")).toHaveText(["Samantha", "Daniel", "Moira", "Karen"]);
  await expect(f.locator("#take-name")).toHaveText("Samantha");
  await expect(f.locator("#wave canvas.base")).toBeVisible();
  const duration = Number(await f.locator("#wave").getAttribute("data-duration"));
  expect(duration).toBeGreaterThan(7500);
  expect(duration).toBeLessThan(8500);
  await expect(f.locator(".details .pinrail-chip")).toHaveText(["en-US", "175 wpm", "WAV"]);
  await expect(f.locator(".reasoning")).toContainText("newsreader");
  await expect(f.locator("[data-w]")).toHaveCount(27);
  await expect(f.locator(".seg-at .sid")).toHaveText(["s1", "s2", "s3"]);
  // every format decodes: WAV, MP3, M4A, Ogg Opus
  await expect(f.locator(".pick-meta")).toHaveText([/0:07\.9/, /0:06\.8/, /0:08\.9/, /0:07\.9/]);
});

test("the takes come from files the shell hands over", async ({ page }) => {
  const plugin = await mount(page);
  const asked = (await plugin.messages())
    .filter((m: any) => m.type === "attachment")
    .map((m: any) => m.name)
    .sort();
  expect(asked).toEqual(["daniel.mp3", "karen.ogg", "moira.m4a", "samantha.wav"]);
});

test("a click on the waveform, a word, or an arrow key moves the playhead", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const duration = Number(await f.locator("#wave").getAttribute("data-duration"));
  const box = (await f.locator("#wave").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(Math.abs((await pos(f)) - duration / 2)).toBeLessThan(duration / 100);

  await f
    .locator("[data-w]")
    .filter({ hasText: /^Nguyen$/ })
    .click();
  expect(await pos(f)).toBe(words("samantha")[8].start_ms);
  await expect(f.locator("[data-w].now")).toHaveText("Nguyen");
  await expect(f.locator("#clock")).toContainText(`0:0${Math.floor(words("samantha")[8].start_ms / 1000)}.`);

  await f.locator("body").press("ArrowRight");
  expect(await pos(f)).toBe(words("samantha")[8].start_ms + 1000);
  await f.locator("body").press("Shift+ArrowLeft");
  expect(await pos(f)).toBe(0);
  await f.locator(".seg-at").nth(2).click();
  expect(await pos(f)).toBe(words("samantha")[24].start_ms);

  // space plays and pauses; the button says which
  await f.locator("body").press(" ");
  await expect(f.locator("#play")).toHaveAttribute("aria-pressed", "true");
  await f.locator("body").press(" ");
  await expect(f.locator("#play")).toHaveAttribute("aria-pressed", "false");
});

test("a comment at a point, anchored to the word under it", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const w = words("samantha")[8];
  await f
    .locator("[data-w]")
    .filter({ hasText: /^Nguyen$/ })
    .click();
  await f.locator("body").press("c");
  await expect(f.locator(".composer-head")).toContainText("“Nguyen”");
  await f.locator("#mark-note").fill('Mispronounced: it is "Win"');
  await f.locator("#mark-note").press("Enter");
  await expect(f.locator(".marks li")).toHaveCount(1);
  await expect(f.locator("#wave .pin")).toHaveText(["1"]);
  await expect(f.locator("[data-w].noted")).toHaveText(["Nguyen"]);
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("Keep");

  await plugin.collect();
  await expect.poll(() => plugin.lastStatus()).toBe("Hand over with 3 undecided");
  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d.decisions).toEqual([
    {
      id: "samantha",
      action: "keep",
      duration_ms: expect.any(Number),
      comments: [
        { at_ms: w.start_ms, text: "Nguyen", words: [8, 8], segments: ["s2"], note: 'Mispronounced: it is "Win"' },
      ],
    },
  ]);
  expect(d.undecided).toEqual(["daniel", "moira", "karen"]);
});

test("a comment over a stretch of words, and a cut dragged on the waveform", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const ws = words("samantha");
  // drag across "walks … bridge," in the transcript
  await f.locator("[data-w]").nth(9).hover();
  await page.mouse.down();
  await f.locator("[data-w]").nth(15).hover();
  await page.mouse.up();
  await expect(f.locator("[data-w].in-sel")).toHaveCount(7);
  await expect(f.locator(".sel-info .span")).toBeVisible();
  await f.locator('[data-do="compose"]').click();
  await f.locator("#mark-note").fill("Too fast here");
  await f.locator('[data-do="add"]').click();

  // a drag on the waveform from 0 to about 1.5 s, then cut it
  const duration = Number(await f.locator("#wave").getAttribute("data-duration"));
  const box = (await f.locator("#wave").boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (1500 / duration), box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(f.locator("#wave .sel")).toHaveCount(1);
  await f.locator("body").press("Backspace");
  await expect(f.locator("#wave .cut")).toHaveCount(1);
  await expect(f.locator("[data-w].gone")).not.toHaveCount(0);
  await expect(f.locator(".marks li")).toHaveCount(2);

  // i and o mark a second cut from the playhead, which merges with the first
  await f.locator("[data-w]").nth(2).click();
  await f.locator("body").press("i");
  await f.locator("[data-w]").nth(5).click();
  await f.locator("body").press("o");
  await f.locator('[data-do="cut"]').click();
  await expect(f.locator("#wave .cut")).toHaveCount(1);

  await f.locator("body").press("s");
  await plugin.collect();
  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  const [take] = d.decisions;
  expect(take.comments).toEqual([
    {
      start_ms: ws[9].start_ms,
      end_ms: ws[15].end_ms,
      text: "walks us through the new harbour bridge,",
      words: [9, 15],
      segments: ["s2"],
      note: "Too fast here",
    },
  ]);
  expect(take.cuts).toHaveLength(1);
  const [c] = take.cuts;
  expect(c.start_ms).toBeLessThan(40);
  expect(c.end_ms).toBe(ws[5].start_ms);
  expect(c.words).toEqual([0, 4]);
  expect(c.text).toBe("Welcome back to Field Notes.");
  expect(c.segments).toEqual(["s1"]);
});

test("one favourite, verdicts by key, and the next take at the same word", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f
    .locator("[data-w]")
    .filter({ hasText: /^Nguyen$/ })
    .click();
  await f.locator("body").press("f"); // Samantha favourite
  await f.locator("body").press("j"); // Daniel, at his "Nguyen"
  await expect(f.locator("#take-name")).toHaveText("Daniel");
  expect(await pos(f)).toBe(words("daniel")[8].start_ms);
  await expect(f.locator(".matched")).toContainText("Nguyen");
  await f.locator("body").press("x");
  await f.locator("#note").fill("Too brisk");
  await f.locator("#take-name").click(); // out of the note, so keys reach the view
  await f.locator("body").press("b"); // back to Samantha, same word
  await expect(f.locator("#take-name")).toHaveText("Samantha");
  expect(await pos(f)).toBe(words("samantha")[8].start_ms);
  await f.locator("body").press("k"); // Karen, from the first take backwards
  await expect(f.locator("#take-name")).toHaveText("Karen");
  await f.locator('.choice[data-action="favorite"]').click(); // Karen favourite: Samantha steps down
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("Keep");
  await expect(f.locator(".pick").nth(3).locator(".verdict-chip")).toHaveText("★ Favourite");
  await expect(f.locator(".tally")).toContainText("1 favourite");
  // a key pressed while the app, not the view, had focus
  await plugin.sendKey("j");
  await expect(f.locator("#take-name")).toHaveText("Samantha");

  await plugin.collect();
  await expect.poll(() => plugin.lastStatus()).toBe("Hand over with 1 undecided");
  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d.decisions.map(({ id, action, note }: any) => ({ id, action, note }))).toEqual([
    { id: "samantha", action: "keep", note: undefined },
    { id: "daniel", action: "drop", note: "Too brisk" },
    { id: "karen", action: "favorite", note: undefined },
  ]);
  expect(d.undecided).toEqual(["moira"]);
});

test("a draft comes back as it was left", async ({ page, context }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator("[data-w]").nth(3).click();
  await f.locator("body").press("c");
  await f.locator("#mark-note").fill("A breath here");
  await f.locator("#mark-note").press("Enter");
  await f.locator("body").press("j");
  await f.locator("body").press("x");
  await expect.poll(async () => Object.keys((await plugin.lastDraft()) ?? {}).sort()).toEqual(["daniel", "samantha"]);

  const again = await mount(await context.newPage(), { draft: await plugin.lastDraft() });
  const g = again.frame;
  await expect(g.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("Keep");
  await expect(g.locator(".pick").nth(1).locator(".verdict-chip")).toHaveText("Drop");
  await expect(g.locator(".marks li")).toHaveCount(1);
  await expect(g.locator(".marks li")).toContainText("A breath here");
});

test("a decided round is read-only and shows what was decided", async ({ page }) => {
  const plugin = await mountPlugin(page, dir, {
    review: fixture(path.join(dir, "fixtures", "fieldnotes.decided.json")),
    readonly: true,
  });
  const f = plugin.frame;
  await expect(f.locator(".pick .verdict-chip")).toHaveText(["—", "★ Favourite", "Keep", "Drop"]);
  await f.locator(".pick").nth(1).click();
  await expect(f.locator("#wave canvas.base")).toBeVisible();
  await expect(f.locator('.choice[data-action="keep"]')).toBeDisabled();
  await expect(f.locator("#note")).toHaveValue(/The one/);
  await expect(f.locator(".marks li")).toHaveCount(3);
  await expect(f.locator("#wave .cut")).toHaveCount(1);
  await expect(f.locator("[data-remove]")).toHaveCount(0);
  await expect(f.locator('[data-do="compose"]')).toHaveCount(0);
  // listening still works
  await f.locator(".marks .when").first().click();
  expect(await pos(f)).toBe(words("daniel")[8].start_ms);
  await f.locator("body").press("c");
  await expect(f.locator("#mark-note")).toHaveCount(0);
});

test("a take that cannot be read says so, and the others still play", async ({ page }) => {
  const review = round();
  review.payload.takes[0].file = { $attachment: "broken.wav" };
  const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "audio-")), "broken.wav");
  fs.writeFileSync(broken, "not audio at all");
  const files = {
    "daniel.mp3": "fixtures/fieldnotes/daniel.mp3",
    "moira.m4a": "fixtures/fieldnotes/moira.m4a",
    "karen.ogg": "fixtures/fieldnotes/karen.ogg",
  };
  const plugin = await mountPlugin(page, dir, { review, attachments: { ...files, "broken.wav": broken } });
  const f = plugin.frame;
  await expect(f.locator("#wave .broken")).toContainText("could not be read");
  await expect(f.locator("#play")).toBeDisabled();
  await expect(f.locator(".pick").nth(0)).toContainText("can't read it");
  await expect(f.locator(".mini canvas")).toHaveCount(3);
  // a verdict still goes back, without a length
  await f.locator("#take-name").click();
  await f.locator("body").press("x");
  await f.locator("body").press("j");
  await expect(f.locator("#wave canvas.base")).toBeVisible();
  await f.locator("body").press("f");
  await plugin.collect();
  await plugin.collect();
  const d = await plugin.nextSubmit();
  expect(decided(d)).toBe(true);
  expect(d.decisions[0]).toEqual({ id: "samantha", action: "drop" });
  expect(d.decisions[1]).toMatchObject({ id: "daniel", action: "favorite" });
});

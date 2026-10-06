import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The view alone, under the harness: no app, no CLI.
const dir = path.resolve(__dirname, "..");
const round = () => fixture(path.join(dir, "fixtures", "fernway.json"));
const mount = async (page: any, opts: any = {}) => {
  const plugin = await mountPlugin(page, dir, { review: round(), ...opts });
  // a key reaches the view once its frame has focus
  await plugin.frame.locator("#palette-name").click();
  return plugin;
};

// Every decision is held to the plugin's own schema, as the app holds it.
const sdk = path.dirname(require.resolve("pinrail-sdk/package.json"));
const Ajv = createRequire(path.join(sdk, "package.json"))("ajv/dist/2020").default;
const ajv = new Ajv({ allErrors: true, strict: false });
const validDecision = ajv.compile(
  JSON.parse(fs.readFileSync(path.join(dir, "schemas", "decision.schema.json"), "utf8")),
);
const validPayload = ajv.compile(JSON.parse(fs.readFileSync(path.join(dir, "schemas", "payload.schema.json"), "utf8")));
const expectValid = (d: unknown) => {
  validDecision(d);
  expect(validDecision.errors ?? []).toEqual([]);
};

test("the fixtures and the example pass the schemas", () => {
  for (const f of ["fernway.json", "fernway.decided.json"]) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, "fixtures", f), "utf8"));
    expect(validPayload(j.payload), JSON.stringify(validPayload.errors)).toBe(true);
    if (j.decision) expectValid(j.decision.data);
  }
  for (const sample of ["ledger", "palette"]) {
    expect(validPayload(JSON.parse(fs.readFileSync(path.join(dir, "samples", `${sample}.json`), "utf8")).payload)).toBe(
      true,
    );
  }
});

test("shows every palette in the rail, and the chosen one on the sample screen in light and dark", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await expect(f.locator(".pick")).toHaveCount(4);
  await expect(f.locator("#palette-name")).toHaveText("Moss");
  await expect(f.locator(".mock")).toHaveCount(2);
  await expect(f.locator('.mock[data-mode="light"]')).toBeVisible();
  // the screen is painted in the palette's own values
  await expect(f.locator('.mock[data-mode="light"] [data-el="Primary button"]')).toHaveCSS(
    "background-color",
    "rgb(47, 107, 79)",
  );
  await expect(f.locator('.mock[data-mode="dark"] [data-el="Primary button"]')).toHaveCSS(
    "background-color",
    "rgb(111, 191, 146)",
  );
  // every token, the value for both themes on one row
  await expect(f.locator("table.tokens tbody tr")).toHaveCount(17);
  await expect(f.locator("table.tokens tbody tr").last()).toContainText("both themes");
  // thirteen standard pairs and the agent's own
  await expect(f.locator("#checks-body tr")).toHaveCount(14);
  await expect(f.locator("#checks-body tr").last()).toContainText("Links on the page");
  await expect(f.locator(".reasoning")).toContainText("white text in light");

  // Ember's orange button fails with white text, in both themes
  await f.locator(".pick").nth(2).click();
  const button = f.locator("#checks-body tr").filter({ hasText: "Primary button" });
  await expect(button.locator(".lvl")).toHaveText(["fail", "fail"]);
  await expect(f.locator(".pick").nth(2).locator(".pick-meta")).toContainText("11 fails");

  // one theme at a time
  await f.locator("body").press("m");
  await expect(f.locator(".mock")).toHaveCount(1);
  await expect(f.locator(".mock")).toHaveAttribute("data-mode", "light");
  await f.locator('[data-mode-show="dark"]').click();
  await expect(f.locator(".mock")).toHaveAttribute("data-mode", "dark");

  // a declared key pressed while the app has focus is handed to the view
  await plugin.sendKey("k");
  await expect(f.locator("#palette-name")).toHaveText("Harbour");
});

test("one favourite, keys to decide, and a warning before undecided palettes go back", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator("body").press("f"); // P1 favourite
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("★ Favourite");
  await f.locator("body").press("j");
  await f.locator("body").press("x"); // P2 dropped
  await f.locator("#note").fill("Too corporate");
  await f.locator("#palette-name").click();
  await f.locator("body").press("j");
  await f.locator('.choice[data-action="favorite"]').click(); // P3 favourite: P1 steps down
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("Keep");
  await expect(f.locator(".pick").nth(2).locator(".verdict-chip")).toHaveText("★ Favourite");
  await expect.poll(() => plugin.lastStatus()).toBe("Hand over: ★ Ember, 1 kept, 1 dropped");

  await plugin.collect();
  await expect.poll(() => plugin.lastStatus()).toBe("Hand over with 1 undecided");
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(decision).toEqual({
    decisions: [
      { id: "P1", action: "keep" },
      { id: "P2", action: "drop", note: "Too corporate" },
      { id: "P3", action: "favorite" },
    ],
    undecided: ["P4"],
  });
  expectValid(decision);
});

test("a click on the screen comments on the colour under it, and a new value repaints the screen", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  const darkButton = f.locator('.mock[data-mode="dark"] [data-el="Primary button"]');
  await darkButton.click();
  const pop = f.locator("#pop");
  await expect(pop).toContainText("color.primary");
  await expect(pop.locator("[data-choose]")).toHaveText(["color.primary", "color.on-primary"]);
  await expect(pop.locator('[data-cmode="dark"]')).toHaveAttribute("aria-pressed", "true");
  await expect(f.locator("#pop-note")).toBeFocused();

  // what is typed shows at once, on the screen and in the pairs it is in
  await f.locator("#pop-note").fill("Warmer, less minty");
  await pop.locator('[data-value="dark"]').fill("#7cc28a");
  await expect(darkButton).toHaveCSS("background-color", "rgb(124, 194, 138)");
  await expect(pop.locator("#pop-checks")).toContainText("Primary button");
  await expect(pop.locator("#pop-checks .up").first()).toBeVisible();
  await pop.locator('[data-value="dark"]').press("Enter");

  await expect(pop).toHaveCount(0);
  await expect(f.locator(".asks li")).toHaveCount(2);
  await expect(f.locator('.mock[data-mode="dark"] .pin')).toHaveCount(1);
  await expect(f.locator('.mock[data-mode="light"] .pin')).toHaveCount(0);
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("Keep");
  // the saved value shows until it is switched off
  await expect(darkButton).toHaveCSS("background-color", "rgb(124, 194, 138)");
  await f.locator("body").press("e");
  await expect(darkButton).toHaveCSS("background-color", "rgb(111, 191, 146)");
  await f.locator("body").press("e");

  // the other colour of the same element
  await f.locator('.mock[data-mode="light"] [data-el="Primary button"]').click();
  await pop.locator('[data-choose="color.on-primary"]').click();
  await expect(pop.locator(".pop-head b")).toHaveText("color.on-primary");
  await f.locator("#pop-note").fill("Off-white, not pure white");
  await f.locator("#pop-note").press("Enter");

  await plugin.collect();
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(decision.decisions).toEqual([
    {
      id: "P1",
      action: "keep",
      comments: [
        { token: "color.primary", role: "primary", mode: "dark", where: "Primary button", note: "Warmer, less minty" },
        {
          token: "color.on-primary",
          role: "on-primary",
          mode: "light",
          where: "Primary button",
          note: "Off-white, not pure white",
        },
      ],
      edits: [{ token: "color.primary", role: "primary", mode: "dark", from: "#6fbf92", to: "#7cc28a" }],
    },
  ]);
  expectValid(decision);
});

test("a token's value, reached by keyboard, takes a new value; one sent for both themes comes back for both", async ({
  page,
}) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator(".pick").nth(1).click(); // Harbour: the amber accent is one value
  const accent = f.locator('.sw[data-token="color.accent"]');
  await expect(accent).toHaveAttribute("data-mode", "both");
  await accent.focus();
  await accent.press("Enter");
  const pop = f.locator("#pop");
  await expect(pop.locator("[data-value]")).toHaveCount(1);
  await pop.locator('[data-value="both"]').fill("not a colour");
  await expect(pop.locator('[data-value="both"]')).toHaveClass(/invalid/);
  await pop.locator('[data-value="both"]').fill("oklch(0.8 0.15 75)");
  await pop.locator('[data-value="both"]').press("Enter");
  await expect(accent).toContainText("oklch(0.8 0.15 75)");
  await expect(accent).toBeFocused();

  // a ratio opens its foreground, and a typed value that is not a colour is not kept
  await f.locator('.ratio[data-where="Body text"][data-mode="light"]').click();
  await expect(pop.locator(".pop-head")).toContainText("Contrast: Body text");
  await pop.locator('[data-value="light"]').fill("nope");
  await pop.locator('[data-value="light"]').press("Enter");

  await plugin.collect();
  await plugin.collect();
  const decision = await plugin.nextSubmit();
  expect(decision.decisions).toEqual([
    {
      id: "P2",
      action: "keep",
      edits: [{ token: "color.accent", role: "accent", mode: "both", from: "#ffb547", to: "oklch(0.8 0.15 75)" }],
    },
  ]);
  expectValid(decision);

  // and it can be taken back
  await f.locator("[data-remove-edit]").click();
  await expect(f.locator(".asks li")).toHaveCount(0);
});

test("a draft comes back as it was left", async ({ page }) => {
  const plugin = await mount(page);
  const f = plugin.frame;
  await f.locator("body").press("f");
  await f.locator('.mock[data-mode="light"] [data-el="Warning message"]').click();
  await f.locator("#pop-note").fill("Browner");
  await f.locator('#pop [data-value="light"]').fill("#7a4d00");
  await f.locator('#pop [data-pop="save"]').click();
  await f.locator("body").press("j");
  await f.locator("#note").fill("Maybe");
  await f.locator("#palette-name").click();
  await f.locator("body").press("m");
  await expect.poll(async () => (await plugin.lastDraft())?.verdicts?.P2?.note).toBe("Maybe");

  await plugin.reinit();
  await expect(f.locator("#palette-name")).toHaveText("Harbour");
  await expect(f.locator("#note")).toHaveValue("Maybe");
  await expect(f.locator(".mock")).toHaveCount(1);
  await f.locator("body").press("k");
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("★ Favourite");
  await expect(f.locator(".asks li")).toHaveCount(2);
  await expect(f.locator('.mock [data-el="Warning message"]')).toHaveCSS("color", "rgb(122, 77, 0)");
});

test("a decided round is read-only and shows what was decided", async ({ page }) => {
  const review = fixture(path.join(dir, "fixtures", "fernway.decided.json"));
  const plugin = await mountPlugin(page, dir, { review, readonly: true });
  const f = plugin.frame;
  await expect(f.locator(".pick").nth(0).locator(".verdict-chip")).toHaveText("★ Favourite");
  await expect(f.locator(".pick").nth(2).locator(".verdict-chip")).toHaveText("Drop");
  await expect(f.locator('.choice[data-action="keep"]')).toBeDisabled();
  await expect(f.locator("#note")).toHaveValue(/more contrast in dark/);
  await expect(f.locator(".asks li")).toHaveCount(4);
  await expect(f.locator("[data-remove-comment], [data-remove-edit]")).toHaveCount(0);
  await expect(f.locator('.mock[data-mode="dark"] [data-el="Primary button"]')).toHaveCSS(
    "background-color",
    "rgb(124, 194, 138)",
  );
  await f.locator('.mock[data-mode="dark"] [data-el="Primary button"]').click();
  await expect(f.locator("#pop")).toHaveCount(0);
  await expect(f.locator('.sw[data-token="color.primary"]').first()).toBeDisabled();
});

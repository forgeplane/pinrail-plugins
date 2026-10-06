import { expect, test } from "@playwright/test";
import path from "node:path";
import { fixture, mountPlugin } from "pinrail-sdk/testing";

// The pictures in screenshots/, taken only when asked: SCREENSHOTS=1 npx playwright test audio/tests/screenshots
const dir = path.resolve(__dirname, "..");
const out = (name: string) => path.join(dir, "screenshots", name);
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to take the screenshots");
test.use({ viewport: { width: 1280, height: 860 } });

async function mount(page, theme: "dark" | "light", file = "fieldnotes.json", readonly = false) {
  const plugin = await mountPlugin(page, dir, { review: fixture(path.join(dir, "fixtures", file)), theme, readonly });
  await page.evaluate(() => {
    (document.getElementById("plugin-frame") as HTMLIFrameElement).style.height = "860px";
  });
  await expect(plugin.frame.locator(".mini canvas")).toHaveCount(4);
  return plugin;
}

test("a take being marked, dark", async ({ page }) => {
  const plugin = await mount(page, "dark");
  const f = plugin.frame;
  await f.locator(".pick").nth(1).click();
  await f
    .locator("[data-w]")
    .filter({ hasText: /^Nguyen$/ })
    .click();
  await f.locator("body").press("c");
  await f.locator("#mark-note").fill('Mispronounced: it is "Win", one syllable');
  await f.locator("#mark-note").press("Enter");
  const words = f.locator("[data-w]");
  await words.nth(9).hover();
  await page.mouse.down();
  await words.nth(15).hover();
  await page.mouse.up();
  await f.locator("body").press("c");
  await f.locator("#mark-note").fill("Too fast here; give the bridge a beat");
  await f.locator("#mark-note").press("Enter");
  await words.nth(5).hover();
  await page.mouse.down();
  await words.nth(6).hover();
  await page.mouse.up();
  await f.locator("body").press("Backspace");
  await f.locator("body").press("f");
  await f.locator("[data-w]").nth(12).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out("audio-dark.png") });
});

test("a range selected, light", async ({ page }) => {
  const plugin = await mount(page, "light");
  const f = plugin.frame;
  const box = (await f.locator("#wave").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.34, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out("audio-light.png") });
});

test("a decided round, light", async ({ page }) => {
  const plugin = await mount(page, "light", "fieldnotes.decided.json", true);
  await plugin.frame.locator(".pick").nth(1).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: out("audio-decided-light.png") });
});

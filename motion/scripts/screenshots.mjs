// Screenshots of the view under the SDK harness, into screenshots/:
//   node scripts/screenshots.mjs
import { chromium } from "@playwright/test";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { fixture, mountPlugin } = require("pinrail-sdk/testing");
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = (name) => path.join(dir, "screenshots", name);

const browser = await chromium.launch();
async function shot(theme, name, arrange) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 800 }, deviceScaleFactor: 2 });
  const plugin = await mountPlugin(page, dir, { review: fixture(path.join(dir, "fixtures", "save.json")), theme });
  const f = plugin.frame;
  await f.locator(".pick-meta").nth(3).filter({ hasText: "Lottie" }).waitFor();
  await f.locator("body").click({ position: { x: 600, y: 5 } });
  await arrange(f, page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: out(name) });
  await page.close();
}
const keys = async (f, ...list) => {
  for (const k of list) await f.locator("body").press(k);
};

await shot("light", "light.png", async (f) => {
  await keys(
    f,
    "j",
    "j",
    "Home",
    "Shift+ArrowRight",
    "i",
    "Shift+ArrowRight",
    "Shift+ArrowRight",
    "Shift+ArrowRight",
    "o",
    "c",
  );
  await f.locator("#comment-note").fill("Ease out slower into the circle, over about 450 ms");
  await f.locator("#comment-note").press("Enter");
  await keys(f, "Home", ...Array(14).fill("Shift+ArrowRight"), "c");
  await f.locator("#comment-note").fill("Less overshoot as it grows back");
  await f.locator("#comment-note").press("Enter");
  await keys(f, "f", "Home", "Shift+ArrowRight", "Shift+ArrowRight");
  await f.locator("#sheet").evaluate((el) => el.scrollTo(0, 560));
});
await shot("dark", "dark.png", async (f) => {
  await keys(f, "s", "Home", "Shift+ArrowRight", "c");
  await f.locator("#comment-note").fill("Hold the press 40 ms longer");
  await f.locator("#comment-note").press("Enter");
  await keys(f, ...Array(6).fill("Shift+ArrowRight"));
  await f.locator("#sheet").evaluate((el) => el.scrollTo(0, 150));
});
await shot("dark", "compare.png", async (f) => {
  await keys(f, "v", "Home", ...Array(9).fill("Shift+ArrowRight"));
  await f.locator("#sheet").evaluate((el) => el.scrollTo(0, 150));
});
await browser.close();

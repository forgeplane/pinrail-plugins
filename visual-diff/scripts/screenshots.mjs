// Screenshots of the view under the test harness, for the README and the
// docs: the wipe in the dark theme, the difference in the light one, and a
// decided round. node visual-diff/scripts/screenshots.mjs
import path from "node:path";
import { chromium } from "@playwright/test";
import testing from "pinrail-sdk/testing";

const { fixture, mountPlugin } = testing;
const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(dir, "screenshots");
const pending = () => fixture(path.join(dir, "fixtures", "acme.json"));

const browser = await chromium.launch();
const shot = async (name, theme, opts, act) => {
  const page = await browser.newPage({ viewport: { width: 1360, height: 980 }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(name, m.text());
  });
  page.on("pageerror", (e) => console.error(name, e.message));
  const plugin = await mountPlugin(page, dir, { theme, ...opts });
  const f = plugin.frame;
  await f.locator(".pick .thumb img").first().waitFor();
  await f.locator("#stage canvas").first().waitFor();
  await f.locator("#pair-name").click(); // the frame takes the keys from here
  if (act) await act(f, page);
  await page.waitForTimeout(200);
  await page.locator("#plugin-frame").screenshot({ path: path.join(out, `${name}.png`) });
  await page.close();
};

await shot("wipe-dark", "dark", { review: pending() }, async (f) => {
  await f.locator("body").press("f");
  await f.locator("body").press("n");
  await f.locator(".rnote").first().waitFor();
  await f.locator("#amount").fill("42");
  await f.locator("#pair-name").click();
});
await shot("diff-light", "light", { review: pending() }, async (f) => {
  await f.locator("body").press("4");
  await f.locator("body").press("n");
  await f.locator("body").press("n");
  await f.locator("body").press("x");
  await f.locator('[data-note-for="2"]').fill("Still misspelled, now as “projcts”.");
  await f.locator("#sheet").evaluate((el) => {
    el.scrollTop = 150;
  });
});
await shot(
  "decided-light",
  "light",
  { review: fixture(path.join(dir, "fixtures", "acme.decided.json")), readonly: true },
  async (f) => {
    await f.locator("body").press("2");
  },
);
await browser.close();

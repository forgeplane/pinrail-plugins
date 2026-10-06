// One screenshot of each plugin, for its README: the view under the SDK's
// harness, as the tests mount it, with no app. It shows the sample named
// after the plugin, samples/<name>.json, or the first sample when there is
// none of that name, in the light theme, and writes <plugin>/screenshot.png.
// Build a plugin that has a build before you take its screenshot.
//
//   node scripts/screenshot.mjs              # every plugin
//   node scripts/screenshot.mjs email audio  # these plugins
//
// The image is not part of a plugin's bundle: an install copies only the
// manifest, the icon, the README, the licence and the fixed folders.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const { fixture, mountPlugin } = require("pinrail-sdk/testing");

/** How long the view gets to draw after it is mounted: fonts, images,
 *  waveforms, a 3D stage. */
const SETTLE_MS = 2500;

/** What to do before the screenshot of a view whose first state shows little:
 *  the video opens on a black frame, so it moves five seconds in. */
const STEPS = {
  video: async (frame, page) => {
    // a click on the header gives the view the keyboard
    await frame
      .locator(".top, header, h1")
      .first()
      .click({ position: { x: 2, y: 2 } });
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  },
};

const plugins = (process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync(root))
  .filter((name) => fs.existsSync(path.join(root, name, "manifest.json")))
  .sort();

/** The sample to show: the one named after the plugin, or the first by name. */
function sampleOf(dir, name) {
  const samples = path.join(dir, "samples");
  const own = path.join(samples, `${name}.json`);
  if (fs.existsSync(own)) return own;
  const first = fs
    .readdirSync(samples)
    .filter((f) => f.endsWith(".json"))
    .sort()[0];
  if (!first) throw new Error(`${name} has no sample to show`);
  return path.join(samples, first);
}

const browser = await chromium.launch();
let failed = false;
for (const name of plugins) {
  const dir = path.join(root, name);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const plugin = await mountPlugin(page, dir, { review: fixture(sampleOf(dir, name)), theme: "light" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(SETTLE_MS);
    if (STEPS[name]) {
      await STEPS[name](plugin.frame, page);
      await page.waitForTimeout(SETTLE_MS);
    }
    const out = path.join(dir, "screenshot.png");
    await page.screenshot({ path: out });
    console.log(`${name}: ${path.relative(root, out)}`);
    await page.close();
  } catch (error) {
    failed = true;
    console.error(`${name}: ${error.message}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);

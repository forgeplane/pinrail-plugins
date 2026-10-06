// One screenshot of each plugin, for its README: the view under the SDK's
// harness, as the tests mount it, with no app. It shows the sample named
// after the plugin, samples/<name>.json, or the first sample when there is
// none of that name, in the light theme, and writes
// plugins/<name>/screenshot.png.
// Build a plugin that has a build before you take its screenshot.
//
//   node scripts/screenshot.mjs              # every plugin
//   node scripts/screenshot.mjs email audio  # these plugins
//
// Then it lays every plugin's screenshot out in a grid, with the plugin's
// icon and title, as .github/plugins.png for the repository's README.
//
// The image is not part of a plugin's bundle: an install copies only the
// manifest, the icon, the README, the licence and the fixed folders.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const folder = path.join(root, "plugins");
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

const plugins = (process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync(folder))
  .filter((name) => fs.existsSync(path.join(folder, name, "manifest.json")))
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
  const dir = path.join(folder, name);
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

/** Every plugin's screenshot in a grid of four columns, each with its icon
 *  and title, on one image. */
async function collage(browser) {
  const all = fs
    .readdirSync(folder)
    .filter((name) => fs.existsSync(path.join(folder, name, "screenshot.png")))
    .map((name) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, name, "manifest.json"), "utf8"));
      const icon = path.join(folder, name, "icon.svg");
      return {
        title: manifest.title,
        image: fs.readFileSync(path.join(folder, name, "screenshot.png")).toString("base64"),
        icon: fs.existsSync(icon) ? fs.readFileSync(icon, "utf8").replace(/<!--.*?-->/gs, "") : "",
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cards = all
    .map(
      (p) => `<figure>
        <img src="data:image/png;base64,${p.image}" alt="">
        <figcaption>${p.icon}<span>${escape(p.title)}</span></figcaption>
      </figure>`,
    )
    .join("");
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: #2b2f3a; background: radial-gradient(circle at 20% 0%, #eef0ff, transparent 60%),
      radial-gradient(circle at 90% 100%, #fff1e8, transparent 55%), #f6f7f9; }
    main { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px 20px; padding: 32px; }
    figure { margin: 0; }
    img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top left;
      border-radius: 10px; border: 1px solid #dde0e7; box-shadow: 0 8px 24px -12px rgba(30, 35, 60, 0.35); }
    figcaption { display: flex; align-items: center; gap: 7px; margin-top: 10px; }
    figcaption svg { width: 15px; height: 15px; color: #5b5bd6; flex: none; }
  </style><main>${cards}</main>`);
  await page.waitForLoadState("load");
  const out = path.join(root, ".github", "plugins.png");
  await page.locator("main").screenshot({ path: out });
  console.log(`collage: ${path.relative(root, out)}`);
  await page.close();
}

if (!failed) await collage(browser);
await browser.close();
process.exit(failed ? 1 : 0);

// The Acme fixture: a pricing card and a sign-up form, each drawn before and
// after a round of fixes and screenshotted with Playwright, the way an agent
// would send them with --attach. Writes the PNGs to fixtures/acme/ and,
// beside them, the pending fixture, a decided one and the manifest's
// example, with each request's region measured from the page itself:
// node visual-diff/scripts/fixture.mjs
//
// The pricing card fixes two of the three things asked (the price, the
// button), gets the third wrong (the typo is still there, moved), and drops
// "Cancel anytime" from the footer, which nobody asked for. The sign-up form
// grows taller: the password rules now show up front, and the error is a
// darker red on the same pink.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "..", "fixtures");
const files = path.join(out, "acme");
fs.mkdirSync(files, { recursive: true });

const base = `
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #f3f4f7; font: 15px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1c2030; }
  .wrap { padding: 28px; display: inline-block; }
  .card { width: 340px; background: #fff; border-radius: 16px; padding: 26px 26px 20px; box-shadow: 0 1px 2px rgba(20,24,40,.06), 0 8px 24px -12px rgba(20,24,40,.18); }
`;

function pricing(after) {
  return `<!doctype html><html><head><style>${base}
    .plan { height: 32px; display: flex; align-items: flex-end; font-size: ${after ? "12px" : "22px"}; font-weight: 700; letter-spacing: ${after ? ".12em" : "0"}; text-transform: ${after ? "uppercase" : "none"}; color: ${after ? "#5b6275" : "#1c2030"}; }
    .blurb { color: #5b6275; font-size: 13.5px; margin: 4px 0 14px; }
    .price { display: flex; align-items: flex-end; gap: 4px; height: 52px; margin-bottom: 18px; line-height: 1; }
    .price b { font-size: ${after ? "44px" : "20px"}; font-weight: ${after ? 800 : 600}; letter-spacing: -0.02em; }
    .price span { color: #5b6275; font-size: 13px; padding-bottom: ${after ? 5 : 1}px; }
    ul { list-style: none; padding: 0; margin: 0 0 20px; display: grid; gap: 8px; font-size: 14px; }
    li::before { content: "✓"; color: #1f9d6b; font-weight: 700; margin-right: 8px; }
    .cta { display: block; width: 100%; text-align: center; padding: 11px 0; border-radius: 10px; font-weight: 600; font-size: 14.5px; ${
      after
        ? "background: #4f46e5; color: #fff; border: 1px solid #4f46e5;"
        : "background: #eef0f4; color: #4a5064; border: 1px solid #d9dce5;"
    } }
    .alt { display: block; text-align: center; margin-top: 10px; font-size: 13px; color: #4a5064; text-decoration: underline; }
    .foot { margin-top: 16px; padding-top: 12px; border-top: 1px solid #eceef3; font-size: 12px; color: #7a8093; text-align: center; }
  </style></head><body><div class="wrap"><div class="card">
    <div class="plan" id="plan">Pro</div>
    <div class="blurb">For teams shipping every week.</div>
    <div class="price" id="price"><b>$29</b><span>per seat / month</span></div>
    <ul>
      <li id="typo">${after ? "Unlimited projcts" : "Unlimted projects"}</li>
      <li>5 team seats included</li>
      <li>Priority support</li>
      <li>SSO and audit log</li>
    </ul>
    <a class="cta" id="cta">Start free trial</a>
    <a class="alt">Compare plans</a>
    <div class="foot" id="foot">No credit card required${after ? "" : " · Cancel anytime"}</div>
  </div></div></body></html>`;
}

function signup(after) {
  return `<!doctype html><html><head><style>${base}
    h2 { margin: 0 0 4px; font-size: 20px; }
    .sub { color: #5b6275; font-size: 13.5px; margin-bottom: 18px; }
    label { display: block; font-size: 12.5px; font-weight: 600; margin: 0 0 6px; color: #3a3f52; }
    .input { height: 40px; border: 1px solid #d3d7e0; border-radius: 9px; padding: 0 12px; display: flex; align-items: center; color: #1c2030; margin-bottom: 14px; font-size: 14px; }
    .input.bad { border-color: #e0567a; margin-bottom: 8px; }
    .rules { font-size: 12.5px; color: #5b6275; margin: -6px 0 12px; display: grid; gap: 3px; }
    .rules div::before { content: "•"; margin-right: 6px; color: #9aa0b2; }
    .error { background: #fde8ee; color: ${after ? "#b4234a" : "#f06b8e"}; font-size: 13px; padding: 8px 10px; border-radius: 8px; margin-bottom: 16px; font-weight: ${after ? 600 : 400}; }
    .btn { display: block; text-align: center; padding: 11px 0; border-radius: 10px; font-weight: 600; background: #1c2030; color: #fff; font-size: 14.5px; }
    .legal { margin-top: 12px; font-size: 11.5px; color: #7a8093; text-align: center; }
  </style></head><body><div class="wrap"><div class="card">
    <h2>Create your account</h2>
    <div class="sub">Free for 14 days. No card needed.</div>
    <label>Work email</label>
    <div class="input">dana@northwind.io</div>
    <label>Password</label>
    <div class="input bad" id="password">••••••</div>
    ${after ? `<div class="rules" id="rules"><div>At least 12 characters</div><div>One number or symbol</div></div>` : ""}
    <div class="error" id="error">Password is too short.</div>
    <a class="btn">Create account</a>
    <div class="legal">By signing up you agree to the Terms and Privacy Policy.</div>
  </div></div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

/** Renders the page, saves the .wrap as a PNG, and measures elements as regions of it, 0 to 1. */
async function shoot(html, name, ids) {
  await page.setContent(html);
  const wrap = page.locator(".wrap");
  await wrap.screenshot({ path: path.join(files, name) });
  const box = await wrap.boundingBox();
  const regions = {};
  for (const id of ids) {
    const r = await page.locator(`#${id}`).boundingBox();
    const pad = 6;
    const x = r.x - pad - box.x,
      y = r.y - pad - box.y;
    regions[id] = {
      x: +(x / box.width).toFixed(4),
      y: +(y / box.height).toFixed(4),
      w: +((r.width + pad * 2) / box.width).toFixed(4),
      h: +((r.height + pad * 2) / box.height).toFixed(4),
    };
  }
  const png = fs.readFileSync(path.join(files, name));
  regions.size = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
  return regions;
}

const pb = await shoot(pricing(false), "pricing-before.png", ["price", "plan", "cta", "typo", "foot"]);
const pa = await shoot(pricing(true), "pricing-after.png", ["price", "cta", "typo", "foot"]);
const sb = await shoot(signup(false), "signup-before.png", ["password", "error"]);
const sa = await shoot(signup(true), "signup-after.png", ["rules", "error"]);
await browser.close();

const union = (a, b) => {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: +(Math.max(a.x + a.w, b.x + b.w) - x).toFixed(4),
    h: +(Math.max(a.y + a.h, b.y + b.h) - y).toFixed(4),
  };
};

const payload = {
  notes:
    "Round 2 of the **Acme** checkout pages. Each request is one of your comments from round 1, with what I changed for it. Check each one, and say if anything else broke.",
  pairs: [
    {
      id: "pricing",
      name: "Pro plan card",
      before: { $attachment: "pricing-before.png" },
      after: { $attachment: "pricing-after.png" },
      pixel_ratio: 2,
      summary: "Price and button reworked; plan name set in small caps above the blurb.",
      requests: [
        {
          id: "R1",
          text: "The price is smaller than the plan name. Make $29 the first thing you read.",
          region: union(pb.plan, pb.price),
          after_region: pa.price,
          claim: "Price at 44 px, extra bold; the plan name down to 12 px caps.",
        },
        {
          id: "R2",
          text: "“Start free trial” is the same grey as “Compare plans”. It should be the obvious action.",
          region: pb.cta,
          after_region: pa.cta,
          claim: "A solid indigo button, full width.",
        },
        {
          id: "R3",
          text: "“Unlimted projects” is misspelled.",
          region: pb.typo,
          after_region: pa.typo,
          claim: "Fixed the typo.",
        },
      ],
    },
    {
      id: "signup",
      name: "Sign-up form",
      before: { $attachment: "signup-before.png" },
      after: { $attachment: "signup-after.png" },
      pixel_ratio: 2,
      summary: "Password rules added under the field, so the form is taller.",
      requests: [
        {
          id: "R4",
          text: "Show the password rules before I type, not only after an error.",
          region: sb.password,
          after_region: sa.rules,
          claim: "The two rules sit under the field from the start.",
        },
        {
          id: "R5",
          text: "The error text is hard to read on the pink background.",
          region: sb.error,
          after_region: sa.error,
          claim: "A darker red, semibold.",
        },
      ],
    },
  ],
};

const attachments = Object.fromEntries(
  ["pricing-before.png", "pricing-after.png", "signup-before.png", "signup-after.png"].map((n) => [
    n,
    { path: `acme/${n}` },
  ]),
);
const pending = {
  title: "Acme checkout — round 2",
  origin: { repo: "acme/web", workflow: "design" },
  payload,
  attachments,
};

const decided = {
  ...pending,
  decision: {
    decided_by: "dana",
    decided_at: "2026-09-24T09:12:00Z",
    data: {
      decisions: [
        {
          id: "pricing",
          action: "revise",
          note: "Close. The typo and the footer, then it can ship.",
          requests: [
            { id: "R1", outcome: "fixed" },
            { id: "R2", outcome: "fixed" },
            { id: "R3", outcome: "not_fixed", note: "Still misspelled, now as “projcts”." },
          ],
          comments: [
            {
              note: "“Cancel anytime” is gone from the footer. Put it back; legal asked for it.",
              region: pa.foot,
              pixels: px(pa.foot, pa.size),
            },
          ],
        },
        {
          id: "signup",
          action: "revise",
          requests: [
            { id: "R4", outcome: "fixed" },
            {
              id: "R5",
              outcome: "partly",
              note: "Better, but the pink still washes it out. Try white with a red border.",
            },
          ],
        },
      ],
      undecided: [],
    },
  },
  agent_note: "Fixing R3 and the footer on the card, and the error style on the form.",
};

function px(r, { w, h }) {
  return { x: Math.round(r.x * w), y: Math.round(r.y * h), w: Math.round(r.w * w), h: Math.round(r.h * h) };
}

fs.writeFileSync(path.join(out, "acme.json"), JSON.stringify(pending, null, 2) + "\n");
fs.writeFileSync(path.join(out, "acme.decided.json"), JSON.stringify(decided, null, 2) + "\n");
for (const f of fs.readdirSync(files)) console.log(f, fs.statSync(path.join(files, f)).size, "bytes");

// A plugin's changelog section for one version, as the release notes.
//
//   node scripts/release-notes.mjs review 1.2.0
//
// Exits 1 when the plugin's CHANGELOG.md says nothing about that version, so
// a release stops before it is published rather than going out with no
// account of what changed.

import fs from "node:fs";
import path from "node:path";

const [plugin, given] = process.argv.slice(2);
const version = (given ?? "").replace(/^v/, "");
if (!plugin || !version) {
  console.error("release-notes: which plugin, and which version?");
  process.exit(1);
}

const file = path.join(plugin, "CHANGELOG.md");
if (!fs.existsSync(file)) {
  console.error(`release-notes: ${file} not found`);
  process.exit(1);
}
const changelog = fs.readFileSync(file, "utf8");
const heading = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\].*$`, "m");
const start = changelog.match(heading);
if (!start) {
  console.error(`release-notes: ${file} has no section for ${version}`);
  process.exit(1);
}

const after = changelog.slice(start.index + start[0].length);
const next = after.search(/^## /m);
const notes = (next === -1 ? after : after.slice(0, next))
  // the link references at the foot belong to the file, not to the notes
  .replace(/^\[[^\]]+\]:.*$/gm, "")
  .trim();

if (!notes) {
  console.error(`release-notes: the section for ${version} is empty`);
  process.exit(1);
}
console.log(notes);

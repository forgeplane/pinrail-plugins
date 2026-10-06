// The release notes come from the plugin's changelog, and a release without
// a section for its version stops.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "release-notes.mjs");

const run = (root, ...args) => spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });

function repo(changelog) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notes-"));
  fs.mkdirSync(path.join(root, "notes"));
  fs.writeFileSync(path.join(root, "notes/CHANGELOG.md"), changelog);
  return root;
}

test("the notes are the version's section, without the link references", () => {
  const root = repo(`# Changelog

## [1.1.0]

### Fixed

- A note no longer loses its last line.

## [1.0.0]

### Added

- The first release.

[1.1.0]: https://github.com/forgeplane/pinrail-plugins/releases/tag/notes-v1.1.0
`);
  const done = run(root, "notes", "1.1.0");
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.stdout, "### Fixed\n\n- A note no longer loses its last line.\n");
  assert.equal(run(root, "notes", "1.0.0").stdout, "### Added\n\n- The first release.\n");
});

test("a version the changelog does not name, or names with nothing, stops the release", () => {
  const root = repo("# Changelog\n\n## [Unreleased]\n\n- Something.\n\n## [1.0.0]\n\n## [0.9.0]\n\n- Old.\n");
  const missing = run(root, "notes", "1.2.0");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /notes\/CHANGELOG\.md has no section for 1\.2\.0/);
  const empty = run(root, "notes", "1.0.0");
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /the section for 1\.0\.0 is empty/);
  const nofile = run(root, "other", "1.0.0");
  assert.equal(nofile.status, 1);
  assert.match(nofile.stderr, /other\/CHANGELOG\.md not found/);
});

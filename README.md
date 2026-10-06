# Pinrail plugins

The official plugins for [Pinrail](https://pinrail.dev). A plugin defines
one kind of review: the payload an agent sends, the decision the person
gives back, and the view the person decides in.

![The plugins in this repository, each showing a sample review](.github/plugins.png)

Pinrail's core plugins, `list`, `feedback`, `code-review`, `image` and
`markdown`, come with the app and live in its repository,
[forgeplane/pinrail](https://github.com/forgeplane/pinrail). This repository
holds the other official plugins.

| Plugin | For |
|---|---|
| [`artifact`](artifact/README.md) | an HTML page an agent designed, commented on element by element |
| [`audio`](audio/README.md) | audio takes, such as voices reading one script, played and compared with their waveforms and transcripts |
| [`calendar`](calendar/README.md) | times to arrange around what is already booked |
| [`canvas`](canvas/README.md) | a set of designs on a canvas, the steps of a flow or variants of a screen, commented and approved frame by frame |
| [`email`](email/README.md) | emails an agent wants to send, to edit, send, revise or discard |
| [`logo`](logo/README.md) | candidate logo marks and icons, shown at every size |
| [`model-3d`](model-3d/README.md) | candidate 3D models, viewed on a stage, with changes requested on their parts |
| [`motion`](motion/README.md) | candidate animations, in CSS or Lottie, played frame by frame and side by side |
| [`palette`](palette/README.md) | colour palettes or design tokens, light and dark, checked for contrast on the parts of a product |
| [`trade`](trade/README.md) | a trade an agent proposes, on its candlestick chart with the entry, stop and targets to adjust |
| [`video`](video/README.md) | a video, such as a promo cut or a screen recording, commented at a moment or over a stretch, on its picture or its sound |
| [`visual-diff`](visual-diff/README.md) | before and after images of a revision, compared with a wipe, side by side, a fade or a difference highlight |

## Installing a plugin

Each plugin is released as a zip of its built bundle. Download
`<name>-<version>.zip` from this repository's releases and install it:

```sh
pinrail plugins install ~/Downloads/email-1.0.0.zip
```

To install a plugin from a checkout of this repository, install its folder.
A plugin with a build step, whose `package.json` has a `build` script, needs
`npm ci && npm run build` in its folder first:

```sh
pinrail plugins install ./email
```

## Layout

Every plugin uses the same layout:

```
email/
  manifest.json           # name, version, title and the plugin's declarations
  README.md
  icon.svg                # the plugin's icon
  screenshot.png          # the image in the README, taken by pnpm screenshot
  view/index.html         # the page the app serves, with the files it loads
  schemas/                # payload.schema.json and decision.schema.json
  templates/              # decision.md.j2, when the plugin writes its own Markdown
  samples/                # <name>.json, reviews to try the plugin with; the first is the agents' example
  fixtures/               # payloads for development and tests, and recorded decisions
  tests/                  # the plugin's Playwright tests under the SDK's harness
  src/                    # only for a plugin with a build: the sources the build turns into view/
```

When a plugin is installed, only `manifest.json`, `icon.svg`, `README.md`,
`LICENSE` and the folders `schemas/`, `view/`, `templates/` and `samples/`
are copied into the app, without hidden files. A plugin's view always runs
in a sandbox, and installing a plugin runs nothing. See
[What runs where](https://pinrail.dev/docs/concepts/trust/).

## Development

The repository uses pnpm. The plugin SDK, `pinrail-sdk`, comes from the
`main` branch of the app's repository until it is published on npm.
`pnpm-lock.yaml` records the commit it was last taken from, and CI always
takes the newest. Checking a plugin needs the `pinrail` command.

```sh
pnpm install
(cd artifact && npm ci && npm run build)   # each plugin with a build step
pnpm test                                  # every plugin's tests
pnpm format                                # format the views, scripts, tests and styles
pinrail plugins check email                # what the app would say of a plugin
pnpm exec pinrail-sdk dev email            # its view in a browser, with its fixtures
pnpm screenshot email                      # retake its screenshot.png
```

`pnpm screenshot` without a name retakes every plugin's screenshot. Either
way, it then rebuilds `.github/plugins.png`, the grid of every plugin's
screenshot at the top of this README. It mounts each view under the SDK's
harness with the plugin's own sample, in the light theme, so build a
plugin that has a build step first. A screenshot is not part of the
plugin when it is installed.

CI checks that the HTML, JavaScript, TypeScript and CSS files are formatted
with Prettier. `pnpm format` formats them. The recorded reviews in each
plugin's `fixtures/` are left as they are.

Each plugin's `tests/` mount its view under the SDK's harness, with the
payloads in its `fixtures/`. A recorded decision,
`fixtures/<name>.decided.json`, holds a review's `title`, `payload` and
`decision`, and optionally its `origin` and `agent_note`. Beside it,
`<name>.decided.md` holds the Markdown the app renders from it for an agent,
and `<name>.decided.summary.json` the summary the inbox shows.
`pinrail plugins check` compares both with what the app makes of the
recorded decision. When a change to a plugin is meant to change them,
rewrite the files and review the difference before you commit it:

```sh
pinrail plugins check email --update-fixtures
```

To take the newest SDK locally, install without the lock file and the
installed packages, which resolves the `main` branch again. With
`node_modules` in place, pnpm keeps the commit it installed before.
`pnpm update` and `pnpm add` lose the folder that a git dependency names,
so do not use them for the SDK:

```sh
rm -rf node_modules pnpm-lock.yaml && pnpm install
```

## Releasing

Each plugin has its own `CHANGELOG.md`, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Record a
change under *Unreleased* when you make it. To release a plugin:

1. Rename *Unreleased* in its changelog to the new version, such as
   `## [1.2.0]`, and set the same version in its `manifest.json`.
2. Commit, then tag the commit `<name>-v<version>`, such as `email-v1.1.0`,
   and push the tag.

The tag runs [`release.yml`](.github/workflows/release.yml). It takes the
changelog's section for the version as the release notes, builds the plugin
when its `package.json` has a `build` script, checks that the manifest's
version matches the tag, and attaches the bundle, `<name>-<version>.zip`, to
a GitHub release of the same tag. A tag without a changelog section for its
version releases nothing.

## Writing your own plugin

Plugins live in their own repositories, and this repository holds only the
official ones. To write your own, start with
[Writing a plugin](https://pinrail.dev/docs/building/writing/) and
[Publishing a plugin](https://pinrail.dev/docs/building/publishing/).

## Licence

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

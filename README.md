![Armazi Hud](./cover.png)

# armazi-hud

Presentation-only status strip (HUD) for the DeepSeek Harness (DSH) web GUI.
It renders **existing** session state — thinking, tool activity, runtime
metrics, todos, compaction state — into a collapsible strip in the
conversation dock. It changes nothing about the model: no prompts, no tools,
zero dependencies, one render path.

By [Caqtus](https://github.com/Caqtus) · MIT · DSH 0.2.x (web platform)

## What it shows

- **Thinking row** — live preview of the latest reasoning/text and the todo list
- **Tool activity** — per-tool icons, counts, relative weight bars
- **Runtime metrics** — model, reasoning effort, tok/s, context pressure, turns, subagents
- **Compaction chip** — live/hold state with `×N` and elapsed time
- **Details toggle** — `hide details` / `details` collapses the expanded strip to a single-line bar

## Install

Armazi-hud ships as a DSH **bundle** (it declares `dsh.bundle` with a
one-row patch file), so it installs and enables in one step — no manual
profile editing needed.

### Easiest: the GUI's Plugins page (one click)

1. In the DSH web sidebar, open **Plugins** → **Add plugin**.
2. Enter one of:
   - `armazi-hud` — the npm name (works once the package is published: `npm publish`)
   - `https://github.com/Caqtus/armazi-hud` — the Git address (works once the repo is public/pushed)
   - an absolute path to the tarball `armazi-hud-0.1.0.tgz` or a local clone
3. Click **Install** and confirm. The bundle is **enabled automatically**.
4. Reload the web page — the HUD strip appears in the conversation dock.

### Command line

```sh
dsh plugin --profile <your-profile> add armazi-hud           # after npm publish
dsh plugin --profile <your-profile> add https://github.com/Caqtus/armazi-hud
dsh plugin --profile <your-profile> add /path/to/armazi-hud-0.1.0.tgz   # local tarball
```

That adds the package to your profile (a plain pnpm forward). Then flip the
plugin's toggle on the **Plugins → Installed** sidebar page — that selects
the bundle (`dsh.profile.bundles`) — and reload the page (restart DSH if
hot reload is off).

### Manual wiring (no manager)

1. Add the dependency in `profiles/<name>/package.json`
   (e.g. `"armazi-hud": "0.1.0"`, or `link:/path/to/armazi-hud` for local dev).
2. Select the bundle: add `"armazi-hud"` to `dsh.profile.bundles`.
   (Equivalent: the one-row `insert` entry shown in the bundled
   `cordis.patch.yml`.)
3. Restart DSH and reload the web GUI.

> The plugin declares `engines.dsh: "0.2.x"`. If your DSH version is not
> accepted by the plugin-manager gate, ask the operator to grant a
> version exemption for `armazi-hud` — the plugin is presentation-only
> and keeps no state that could be corrupted by a DSH upgrade.

### Verify

```sh
node smoke.js
# expected: SMOKE OK (12 cases)
```

The smoke test renders real client.js snapshots headlessly — no DSH or
browser required.

## Files

- `lib/index.js` — host-side no-op entry (required by the plugin contract)
- `lib/client.js` — the whole plugin: styles + render + dock mounting
- `cordis.patch.yml` — the bundle config entry `dsh.bundle.patch` points to
- `smoke.js` — headless render smoke test (12 cases)

## Publish & discoverability

- **npm** — `npm publish` (scope unscoped, name already `armazi-hud`).
  After that, the npm name works in every install path above, and the
  package is findable via npm search (keywords: `dsh`, `deepseek-harness`).
- **GitHub** — push to [github.com/Caqtus](https://github.com/Caqtus) with
  topics `dsh`, `dsh-plugin` (the topics of the upstream
  `deepseek-ai/deepseek-harness` repo) — that is how the project's own
  community tags plugins; the repo's Discussions are the natural place to
  announce it.
- **Discover tab** — DSH has an experimental Discover surface
  (`plugin-market-bundle`, off by default) that lists plugins from
  third-party JSON indexes (format 1). A ready-made index entry for this
  package (validated against DSH's own `parseMarketIndex` rule set) lives
  at [`../discover-index.example.json`](../discover-index.example.json);
  any market index generator can include it, or you can host and point
  DSH's `pluginMarket.indexes` config at your own.

## License

MIT — see [LICENSE](./LICENSE).

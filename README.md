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

Armazi-hud is a regular DSH client plugin. Wire it into your profile:

1. **`profiles/<name>/package.json`** — add the dependency (link for local dev):

   ```json
   "armazi-hud": "link:/path/to/armazi-hud"
   ```

   …or install from the published tarball / GitHub clone instead.

2. **`profiles/<name>/cordis.patch.yml`** — add the plugin entry:

   ```yaml
   - insert:
     - id: armazi-hud
       name: armazi-hud
       config:
   ```

3. **Restart DSH** and reload the web GUI.

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
- `smoke.js` — headless render smoke test (12 cases)

## License

MIT — see [LICENSE](./LICENSE).

# Compatibility harness (current latest only)

One version, one run: current latest DSH (`compat/versions.json`), the packed tarball, a headless Edge page, and a short pass/fail report. No version matrix, no CI yet.

## Run

```bash
npm run pack
npm run compat
```

Or:

```bash
node compat/run.mjs --tarball dist/dsh-free-pane-0.10.18.tgz --keep
```

`--keep` keeps the isolated `DSH_HOME`, Edge profile, screenshot and `report.json` under `.tmp/compat-latest-*`. Without it, a passing run is deleted.

Environment overrides:

- `DSH_BIN` — `dsh` executable (default: `dsh` on PATH).
- `EDGE_BIN` — Edge/Chrome executable (default: standard Windows install paths).

## What it checks

1. Creates an isolated `DSH_HOME` and a fresh `web` profile.
2. Installs the **packed tarball** with `dsh plugin --profile compat add`.
3. Boots `dsh --profile compat --no-open --port 0` and reads the printed URL.
4. Opens it in headless Edge over CDP (no Playwright dependency).
5. Asserts:
   - the app boots and the `自由窗格` rail exists;
   - the canvas mounts and the `添加` button exists;
   - adding a `笔记` card creates a `.fp-win`;
   - `/_dsh/dsh-free-pane/diagnostics` returns `{ ok: true }`;
   - no `Runtime.exceptionThrown` on the page.
6. Saves `screen.png` and `report.json`.

The pinned version is exact. If `dsh --version` differs from `compat/versions.json`, the harness fails instead of silently testing an unverified version.

## Limits

- Windows + local Edge/Chrome only for now (the current development platform).
- Web profile only. Desktop-only surfaces (Office preview, host right sidebar, PowerShell terminal) are not covered by this harness.
- It is a smoke/contract test, not a full UI regression suite. It does not replace the manual checks in `COMPATIBILITY.md`.

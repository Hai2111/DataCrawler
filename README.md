# DataCrawler

Chrome Manifest V3 tooling for user-initiated research of Facebook Groups that the signed-in user can already access.

## Project contents

- `facebook-group-probe-extension/`: URL-driven Facebook Group collector.
- `analysis/`: scripts for inspecting collector exports and demand signals.
- `fb_ui_probe/`: sanitized UI reconnaissance notes and selector maps.
- `RUN_FB_UI_SCAN.bat` and `CODEX_FB_UI_SCAN.md`: optional one-pass UI reconnaissance workflow.

## Collector capabilities

- Sequential collection from supplied Facebook Group URLs.
- Resumable checkpoints and configurable post/group targets.
- Demand detection and public contact extraction for demand posts.
- Cross-group content de-duplication.
- Per-post extraction provenance and missing-field reporting.
- Optional export to a user-selected directory, with a Downloads fallback.

See [the extension README](facebook-group-probe-extension/README.md) for installation, privacy modes, output schema and limitations.

## Privacy and boundaries

Generated crawl exports are ignored by Git and should not be committed. The extension does not join groups, bypass access controls, post, react, comment or send messages. Use collected data only for a legitimate purpose and respect group rules, applicable privacy law and platform terms.

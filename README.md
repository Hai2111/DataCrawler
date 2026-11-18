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
- Validation-gated demand detection and public contact extraction for `VALID` posts only.
- Cross-group content de-duplication.
- Top-level post-body/comment isolation, canonical identity validation, timestamp confidence and sanitized failure diagnostics.
- Multi-pass viewport observation with safe `PARTIAL`-record correlation and overlapping scroll recovery.
- Optional export to a user-selected directory, with a Downloads fallback.

See [the extension README](facebook-group-probe-extension/README.md) for installation, privacy modes, output schema and limitations.

Run `node --test tests/extractor-core.test.js` for the 20-case extraction regression suite. See [the v0.7.0 validation report](reports/extraction-validation-v0.7.0.md) for manual-review precision, coverage and failure analysis.

## Privacy and boundaries

Generated crawl exports are ignored by Git and should not be committed. The extension does not join groups, bypass access controls, post, react, comment or send messages. Use collected data only for a legitimate purpose and respect group rules, applicable privacy law and platform terms.

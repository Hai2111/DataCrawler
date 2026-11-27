# DataCrawler

Chrome Manifest V3 tooling for user-initiated research of Facebook Groups that the signed-in user can already access.

## Windows setup (PowerShell)

Requires Git for Windows, Node.js 22+ and Chrome. No administrator access is normally needed.

For a fresh installation, run in PowerShell:

```powershell
git clone https://github.com/Hai2111/DataCrawler.git D:\codex\DataCrawler
cd D:\codex\DataCrawler
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\SETUP.ps1
```

For subsequent runs, open the existing checkout and run the same script. It updates main with fast-forward only, creates storage folders, runs both regression suites, starts the localhost debug server and opens Chrome Extensions. It refuses to update a dirty working tree or another branch. It never resets local changes or deletes collected data.

The script uses its own checkout directory by default, or `D:\codex\DataCrawler` if copied outside a checkout. Options: `-Root "E:\DataCrawler"`, `-SkipUpdate`, `-SkipLogServer`, `-SkipBrowser`. Execution policy is process-scoped in the example; no system-wide policy change is needed.

In Chrome (`chrome://extensions/`), enable Developer mode, use Load unpacked for each extension directory (or Reload after updates), and select the corresponding local export directory in its popup:

| Extension directory | Local export directory |
| --- | --- |
| `facebook-group-probe-extension/` | `collected_data/facebook/` |
| `linkedin-post-collector-extension/` | `collected_data/linkedin/` |

The local export and debug directories are gitignored. Keep collected data local. The setup does not sign in, install extensions silently, or start collection. Use only sources for which collection is permitted.

## Project contents

- `facebook-group-probe-extension/`: URL-driven Facebook Group collector.
- `linkedin-post-collector-extension/`: URL-driven LinkedIn post/search/company-feed collector.
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

Run `node --test tests/linkedin-extractor-core.test.js` for LinkedIn Activity ID, validation, timestamp, number parsing and safe partial-merge regression tests.

## Privacy and boundaries

Generated crawl exports are ignored by Git and should not be committed. The extension does not join groups, bypass access controls, post, react, comment or send messages. Use collected data only for a legitimate purpose and respect group rules, applicable privacy law and platform terms.

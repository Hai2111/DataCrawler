# LinkedIn URL Demand Collector v0.1.0

Chrome Manifest V3 extension for user-started, read-only collection of LinkedIn posts already visible to the signed-in account.

## Supported source URLs

- LinkedIn content search: `/search/results/content/?keywords=...`
- Company post feeds: `/company/<slug>/posts/`
- Profile recent activity: `/in/<slug>/recent-activity/all/`
- Hashtag feeds, the main feed and individual LinkedIn post URLs

Paste one URL per line. The collector processes up to 50 normalized URLs sequentially and targets 100 `VALID` posts per URL by default.

## Extraction safeguards

- A `VALID` record requires an original top-level post body, canonical Activity ID, canonical permalink and verified top-level post container.
- Comments and nested repost content never substitute for the original post body.
- Each viewport is observed twice after expanding **See more**, with a settle delay and 35% scroll overlap.
- `PARTIAL` observations persist in sanitized checkpoints and merge only through matching Activity ID, stable author/time evidence or a verified body fingerprint.
- Demand classification and public-contact extraction run only after validation.
- Stable failures retain diagnostics and a text-free sanitized DOM structure snapshot.

## Session behavior

- Pause/resume and checkpoint export do not end the scan.
- Saturated feeds scroll to the end and reload periodically. After eight unsuccessful recoveries, an incomplete source is recorded and the next URL starts.
- Exact Activity ID/fingerprint duplicates are removed across all supplied URLs.
- Output goes to the selected directory when permission remains available, otherwise to `Downloads/LinkedInDemandCollector`.
- Developer mode sends metadata-only progress logs to the existing localhost bridge at `127.0.0.1:32145`.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `linkedin-post-collector-extension`.
3. Open LinkedIn while signed in.
4. Open the extension, paste source URLs, optionally select an export directory, and click **Quét URL**.

## Boundaries

The extension does not connect, follow, message, react, comment, apply for jobs, bypass login/challenges, or call private LinkedIn APIs. Use collected data for a legitimate purpose and comply with applicable privacy law, LinkedIn terms and source-page expectations.

Run `node --test tests/linkedin-extractor-core.test.js` for the core regression suite.

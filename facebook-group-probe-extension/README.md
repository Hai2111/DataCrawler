# Facebook URL Demand Collector v0.7.1

Chrome Manifest V3 extension for a user-started, read-only research session on Facebook content the signed-in user can already access.

## Automated session

1. Enter one Facebook Group URL per line.
2. The extension normalizes and removes duplicate URLs.
3. In URL mode it attempts every normalized URL sequentially and finishes only when the URL queue is exhausted or the user explicitly stops the session.
4. It classifies visible post text as demand, purchase, design-service, repair/support or pricing intent.
5. For demand posts only, it can retain phone numbers and email addresses explicitly written in the visible post.
6. It removes exact content duplicates across groups and exports JSON automatically at the end.

Version 0.5 enriches each post across repeated observations instead of replacing the whole record. It separately fills missing permalink, timestamp, author, engagement, media and visible comments, and writes `data_completeness.missing_fields` plus extraction-source metadata for auditing.

Version 0.6 treats saturation as a recovery signal, not a completion condition. It scrolls to the feed end, periodically reloads and resumes from the saved checkpoint until the configured post target is reached. Running checkpoint files may be exported every N collected posts and after each completed group without stopping the session.

The popup shows current-group progress, total posts retained, completed groups and recovery attempts. **Xuất checkpoint ngay — không dừng** writes a snapshot while leaving the collector running.

Version 0.6.1 adds a persistent debug log to the popup and every exported JSON payload. It records session lifecycle, per-group scan counts, total retained posts, completed groups, recovery attempts and export destinations without logging post text or contact values. The popup can copy or clear the latest 500 entries.

Version 0.6.2 makes URL mode exhaustive. The completed-group target can no longer end a URL session early; inaccessible groups are recorded and skipped, and scanning continues with the next URL until every supplied URL has been attempted.

Version 0.6.3 adds an opt-in local developer bridge. While developer mode is enabled, every debug event is forwarded immediately to `http://127.0.0.1:32145` and appended to `debug_logs/extension-live.jsonl` inside the project. The bridge listens only on localhost and does not receive post text or contact values.

Version 0.7.0 replaces permissive text fallback with a validation-gated extraction pipeline. Only a verified top-level message with a canonical Facebook post identity and trustworthy provenance is `VALID`. Comments and nested shared-post bodies remain separate and can never substitute for a missing original body. Only `VALID` records count toward collection targets or enter demand classification.

Version 0.7.1 handles Facebook's partially rendered viewport. It observes each viewport twice with a settle delay, expands **See more** before the second observation, scrolls with 35% overlap, and retains `PARTIAL` observations across rounds. Complementary observations are merged only when they share a canonical post ID, a stable author/time correlation key, or the same verified original-body fingerprint. A failure is reported only after at least two matching observations, and only `VALID` merged records increase the target counter.

The default is 100 posts per group, with up to 50 unique supplied URLs per session. A temporary feed saturation no longer ends a group: the collector keeps recovering and retrying until the target is reached or the user presses **Dừng & xuất**. A group that remains inaccessible behind a join/request screen is recorded as incomplete and skipped so the URL queue can continue.

## Data minimization

The recommended `contacts_only` mode:

- redacts author names and phone-like strings from stored post text;
- retains normalized public contact fields only when the post is classified as demand;
- does not read cookies, passwords, authentication tokens, browser history or Facebook network/API traffic.

`redacted` stores no contact fields. `full` retains visible author/profile/contact data and should only be used with an appropriate purpose and retention policy.

## Boundaries

- The extension does not join groups, bypass access controls, post, react, comment or message people.
- It works only with content rendered in the current browser session.
- Facebook may change its markup or search URL, requiring selector maintenance.
- Demand classification is heuristic. Review `demand_posts` and `contact_leads` before using them.
- Respect group rules, applicable privacy law and Facebook terms. Avoid unsolicited bulk outreach.

## Install or upgrade

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Reload** on the existing extension, or use **Load unpacked** and select this folder.
4. Open Facebook while signed in.
5. Open the extension, paste the group URLs, review settings, then click **Quét danh sách URL**.

## Realtime developer log

1. Run `RUN_DEV_LOG_SERVER.bat` from the project root, or run `node tools/dev-log-server.js`.
2. Reload the unpacked extension after upgrading.
3. Keep **Developer mode: gửi log realtime về project** enabled in the popup.
4. Confirm that the popup reports `Dev log bridge: đã kết nối`.
5. Inspect `debug_logs/extension-live.jsonl` for the append-only event stream and `debug_logs/extension-live-latest.json` for the latest event.

The local server binds to `127.0.0.1:32145` only. If it is not running, collection continues normally and the service worker prints a bridge warning to its console.

## Export directory

- Click **Chọn thư mục** in the popup before starting the session.
- Chrome shows a native directory picker; the selected directory handle is stored in extension IndexedDB.
- At completion, JSON is written directly into that directory when write permission is still available.
- Chrome may require the directory to be selected again after a browser restart or permission reset.
- If direct writing is unavailable, the extension automatically falls back to `Downloads/FacebookDemandCollector`.

## Output schema 0.7.1

The downloaded JSON contains:

- supplied and normalized group URLs;
- attempted, complete and incomplete groups;
- per-group posts and checkpoints;
- `unique_posts` after cross-group content de-duplication;
- `duplicates` with their canonical record;
- `demand_posts` with classification signals;
- `contact_leads` with public phones/emails found in demand posts;
- per-post `extraction` sources and `data_completeness` flags;
- run totals, configuration and errors.
- `debug_log` with timestamped collection counters, recovery and export events.
- `validation.status` (`VALID`, `PARTIAL`, or `INVALID`) and required-field reasons;
- `extraction_failures` with diagnostics and text-free sanitized DOM structure snapshots;
- timestamp original text, ISO `+07:00` value when reliably parseable, and confidence.

## Extraction validation

- Body source must be a top-level Facebook message node. `dir="auto"` context and comments are never body fallbacks.
- Canonical identity accepts direct group post/permalink URLs, `story_fbid`, or a group media `set=pcb|gm` identity.
- `VALID` requires original body, canonical ID, canonical URL, and verified top-level provenance.
- `PARTIAL` and `INVALID` observations are logged for diagnostics but do not increase the target counter.
- `PARTIAL` observations are retained in sanitized checkpoints and retried/merged on later overlapping viewport passes.
- Demand classification and contact extraction run only after a record becomes `VALID`.

The default stabilization settings are two observations per viewport, a 700 ms settle delay and a 0.65-viewport scroll step. They are normalized as `observation_passes_per_viewport`, `viewport_settle_ms` and `viewport_scroll_ratio` in the session configuration.

Run the regression suite with `node --test tests/extractor-core.test.js`. Manual-review evidence and before/after metrics are documented in `reports/extraction-validation-v0.7.0.md`.

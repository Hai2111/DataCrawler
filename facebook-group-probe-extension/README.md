# Facebook URL Demand Collector v0.6

Chrome Manifest V3 extension for a user-started, read-only research session on Facebook content the signed-in user can already access.

## Automated session

1. Enter one Facebook Group URL per line.
2. The extension normalizes and removes duplicate URLs.
3. It visits the supplied groups sequentially until up to 10 accessible groups each reach 100 unique posts, or the URL list is exhausted.
4. It classifies visible post text as demand, purchase, design-service, repair/support or pricing intent.
5. For demand posts only, it can retain phone numbers and email addresses explicitly written in the visible post.
6. It removes exact content duplicates across groups and exports JSON automatically at the end.

Version 0.5 enriches each post across repeated observations instead of replacing the whole record. It separately fills missing permalink, timestamp, author, engagement, media and visible comments, and writes `data_completeness.missing_fields` plus extraction-source metadata for auditing.

Version 0.6 treats saturation as a recovery signal, not a completion condition. It scrolls to the feed end, periodically reloads and resumes from the saved checkpoint until the configured post target is reached. Running checkpoint files may be exported every N collected posts and after each completed group without stopping the session.

The popup shows current-group progress, total posts retained, completed groups and recovery attempts. **Xuất checkpoint ngay — không dừng** writes a snapshot while leaving the collector running.

The defaults are up to 10 groups and 100 posts per group. A temporary feed saturation no longer ends a group: the collector keeps recovering and retrying until the target is reached or the user presses **Dừng & xuất**. A group that remains inaccessible behind a join/request screen is recorded as incomplete and skipped so the URL queue can continue.

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

## Export directory

- Click **Chọn thư mục** in the popup before starting the session.
- Chrome shows a native directory picker; the selected directory handle is stored in extension IndexedDB.
- At completion, JSON is written directly into that directory when write permission is still available.
- Chrome may require the directory to be selected again after a browser restart or permission reset.
- If direct writing is unavailable, the extension automatically falls back to `Downloads/FacebookDemandCollector`.

## Output schema 0.6

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

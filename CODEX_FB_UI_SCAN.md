# CODEX_FB_UI_SCAN.md

## Mission

Run exactly one reconnaissance pass on the currently logged-in Facebook session in Chrome/Edge.

The purpose of this run is NOT to collect market-demand data yet.

The purpose is to learn the live Facebook UI/DOM and produce a stable interaction map for the collector.

## Safety / scope

Allowed:
- inspect the current Facebook page
- inspect DOM
- read visible labels/text needed to identify controls
- click navigation required to reach Groups
- open a group the user already has access to
- inspect group search UI
- perform a harmless test search ONLY if a test keyword is already configured locally
- expand "See more"
- expand visible comments
- scroll
- go back
- record selectors and fallback strategies

Do NOT:
- post
- comment
- react
- send messages
- join groups
- request access to groups
- change account settings
- bypass CAPTCHA
- bypass access controls
- extract cookies/tokens/passwords
- follow external links unnecessarily
- collect personal data beyond what is technically necessary to identify DOM structure

If a destructive or account-changing action would be required, stop that branch.

## Current observed UI from screenshot

The current browser is on Facebook desktop in Vietnamese.

Visible structure includes:
- top-left Facebook logo
- global search input labelled approximately `Tìm kiếm trên Facebook`
- top navigation icons
- left navigation item `Nhóm`
- central feed
- a visible group post card in the feed
- right-side sponsored panel

Use this only as a visual hint. Do NOT hard-code selectors from the screenshot. Verify live DOM.

## Browser connection

Prefer the user's existing Chrome/Edge session.

If a browser automation bridge already exists in this workspace, use it.

If the current browser session is not directly controllable:
1. detect whether Chrome DevTools Protocol is available locally, commonly on port 9222
2. if unavailable, DO NOT launch a fresh logged-out browser and pretend it represents the user's session
3. instead, report `BROWSER_ATTACH_REQUIRED` and specify the exact attach requirement

Do not terminate the user's existing browser.

## Reconnaissance sequence

### Phase 1 — Home page

Inspect the current page and record:

- URL
- document language
- main navigation landmarks
- selector candidates for:
  - global Facebook search
  - Groups navigation
  - feed container
  - top-level post container
  - post body text
  - post permalink
  - timestamp
  - author area
  - `See more`
  - comments container
  - comment item
  - reaction/share/comment buttons

For every selector candidate, record:
- selector type
- example selector
- why it is considered stable/unstable
- fallback selector
- whether it relies on visible Vietnamese text

Prefer in this order:
1. semantic roles / aria labels
2. stable URL patterns
3. element relationships
4. text labels
5. CSS classes only as last resort

Facebook CSS class names are considered unstable.

### Phase 2 — Groups entry

Navigate to Groups using the visible `Nhóm` control.

Record:
- resulting URL
- selector used
- whether navigation is SPA/history based
- loading state behavior
- how to detect that Groups page is ready

Do not join/request any group.

### Phase 3 — Existing accessible group

Open one group that is already visibly available to the logged-in account.

Prefer a group already shown in:
- shortcuts
- recently visited groups
- group list

Do NOT choose a group that requires joining.

Record:
- group URL canonical form
- group ID/name if available from URL/DOM
- how to detect the group feed container
- top-level post container selector
- permalink extraction logic
- post ID extraction logic
- group search control selector
- sorting/filter controls if visible

### Phase 4 — Post anatomy

Inspect at least 3 different visible posts if available.

For each post determine reliable extraction paths for:

- post_id
- post_url
- post_text
- posted_at_text
- author_name location
- author_profile link location
- comments area
- number of visible comments if exposed
- `See more`
- media presence
- shared/reposted content
- sponsored/promoted detection if applicable

Important:
Do not collect/store author identity in the final market dataset by default.
Author fields are inspected here only to understand DOM anatomy.

### Phase 5 — Interactions

Test only harmless interactions:

1. expand one `See more` if available
2. expand one comments section if available
3. scroll enough to trigger lazy loading
4. confirm whether old post DOM nodes are removed/recycled
5. navigate back to the group feed if a post detail view was opened

For each action, record:
- trigger selector
- wait condition
- DOM change
- failure mode
- safe fallback

### Phase 6 — Group search

If a harmless local test keyword is already present in collector configuration, run exactly one search in the current accessible group.

Otherwise:
- inspect the search input/control
- do not invent a keyword

Record:
- selector
- search result URL pattern
- whether results are dynamically loaded
- result post container selector
- whether permalink structure differs from normal feed

### Phase 7 — DOM probe samples

Save sanitized DOM samples for:
- one normal post
- one expanded post
- one comment block
- group search control/result if available

Do not dump the entire Facebook page.

Remove or redact:
- access tokens
- cookies
- hidden account identifiers unrelated to DOM mapping
- phone numbers/emails found in user content unless structurally necessary

Store under:

```text
fb_ui_probe/
├── home_map.json
├── group_map.json
├── post_samples.json
├── interaction_map.json
└── reconnaissance_report.md
```

## Required selector map format

Example:

```json
{
  "post_container": {
    "primary": "[role='article']",
    "fallbacks": [
      "ancestor of a[href*='/groups/'][href*='/posts/']"
    ],
    "confidence": 0.82,
    "notes": "Role-based selector appears on all 3 tested posts."
  }
}
```

Use confidence 0.0-1.0.

## Required interaction map

For each interaction:

```json
{
  "action": "expand_post_text",
  "trigger": "...",
  "precondition": "...",
  "success_condition": "...",
  "timeout_ms": 5000,
  "fallback": "...",
  "risk": "low"
}
```

## Final report

Create:

`fb_ui_probe/reconnaissance_report.md`

It must contain:

1. `BROWSER CONNECTION`
2. `OBSERVED FACEBOOK VERSION / LOCALE`
3. `STABLE SELECTORS`
4. `UNSTABLE SELECTORS TO AVOID`
5. `GROUP NAVIGATION FLOW`
6. `GROUP SEARCH FLOW`
7. `POST EXTRACTION FLOW`
8. `COMMENT EXTRACTION FLOW`
9. `LAZY-LOAD / VIRTUALIZATION BEHAVIOR`
10. `KNOWN FAILURE MODES`
11. `RECOMMENDED CHANGES TO facebook_adapter.js`

End with exactly one status:

- `READY_TO_PATCH_ADAPTER`
- `BROWSER_ATTACH_REQUIRED`
- `UI_SCAN_BLOCKED`

## Important

This run is reconnaissance only.

Do not modify `facebook_adapter.js` yet.

Do not start continuous crawling.

Do not generate demand statistics.

The next step after this report is to patch the collector against the observed live UI.

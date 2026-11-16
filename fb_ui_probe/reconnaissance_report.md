# Facebook UI reconnaissance report

## BROWSER CONNECTION

- Existing browser: Google Chrome window titled `Facebook - Google Chrome`.
- Browser automation bridge: unavailable (`Browsers: Error: The browser access host is unavailable`).
- Local Chrome DevTools Protocol check: no listener on TCP port 9222.
- No fresh/logged-out browser was launched, and the existing browser was not terminated.

Attach requirement: expose the **currently logged-in Chrome or Edge profile** through the browser automation bridge, or relaunch/attach that same profile with remote debugging enabled and a local CDP endpoint (for example `--remote-debugging-port=9222`). Then rerun this reconnaissance pass. Do not supply cookies, tokens, passwords, or exported browser data.

## OBSERVED FACEBOOK VERSION / LOCALE

Not observable without DOM access. The task-provided visual hint indicates Facebook desktop in Vietnamese; this was not independently verified.

## STABLE SELECTORS

None verified. No selector is recorded from screenshots or assumptions.

## UNSTABLE SELECTORS TO AVOID

- Facebook-generated CSS class names.
- Screenshot-derived coordinates.
- Vietnamese text selectors unless a live DOM scan proves no semantic alternative.

## GROUP NAVIGATION FLOW

Not executed. The `Nhóm` control was not clicked because no controllable tab was available.

## GROUP SEARCH FLOW

Not executed. No configured test keyword was checked or submitted.

## POST EXTRACTION FLOW

Not executed. No post DOM or author data was inspected.

## COMMENT EXTRACTION FLOW

Not executed. No comment DOM or user content was inspected.

## LAZY-LOAD / VIRTUALIZATION BEHAVIOR

Not observed. No scrolling occurred.

## KNOWN FAILURE MODES

- Browser access host is unavailable to the automation bridge despite the Chrome window being visible.
- Chrome DevTools Protocol is not listening locally on port 9222.
- Any proposed selector before attachment would be speculative and is intentionally omitted.

## RECOMMENDED CHANGES TO facebook_adapter.js

None. Do not modify the adapter until a live attached DOM scan supplies verified semantic selectors, URL patterns, interaction states, and virtualization behavior.

BROWSER_ATTACH_REQUIRED

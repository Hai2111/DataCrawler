# Extraction validation report — v0.7.0

## Review set

- Source: completed v0.6.3 export `facebook-demand-leads-2026-11-16T05-40-21-367Z.json`.
- Review date: 2026-11-16 (Asia/Bangkok).
- 20 Facebook post records were manually inspected against their post identity, extracted body, visible comments, media metadata, raw visible context, and extraction provenance.
- Coverage: 10 comment-heavy cases, 9 image/media cases, 3 shared-post patterns, 3 expanded “See more” cases, and 2 Vietnamese absolute-date cases.
- The review fixtures contain sanitized descriptions and public numeric post IDs, not contact values or raw personal names.

## Before/after results

| Metric | v0.6.3 | v0.7.0 validation gate |
|---|---:|---:|
| Accepted records | 20/20 | 8/20 |
| True original-body records accepted | 9 | 8 |
| Comment/shared-substitute false positives | 11 | 0 |
| Precision | 45.0% | 100.0% |
| Coverage of manually confirmed original bodies | 100.0% | 88.9% |

The deliberate coverage reduction is one record whose body appeared original but had no canonical post ID or URL. It is now `PARTIAL` and excluded from counting/classification instead of being assigned a `text-*` identity.

## Failure analysis

- 10 records were previously populated from visible comments or reply controls. They are now `INVALID` with `missing_original_post_body` and never classified as demand.
- 1 original-body record lacked canonical identity. It is now `PARTIAL`.
- 1 shared/video observation had neither top-level body nor canonical identity. It remains `PARTIAL`.
- Shared attachment text is rejected as a body source unless a distinct verified top-level message exists.
- Expanded “See more” content remains valid because it stays inside the verified top-level message node.

## Automated checks

`node --test tests/extractor-core.test.js` covers:

1. all 20 manual labels;
2. comment/shared-body isolation;
3. demand-classification gating;
4. direct, story and media-set permalink normalization;
5. Vietnamese absolute dates to ISO `+07:00` with original text/confidence;
6. Vietnamese reaction counts including decimal suffixes and thousands separators;
7. before/after precision and coverage guardrails.

## Remaining risk

Facebook markup is not stable. v0.7.0 therefore records text-free sanitized DOM structure snapshots and extraction diagnostics for rejected observations. These artifacts should be reviewed whenever `PARTIAL`/`INVALID` rates rise or Facebook changes its message/permalink markup.

# Identity hardening proposal (ChatGPT)

## Invariants
- Identity = verified canonical ID plus URL, not fingerprint or author/time.
- Missing identity: keep bounded failure diagnostics; do not join to another observation. Same verified identity can enrich a missing body.
- Different IDs: never merge. Facebook export uses canonical URL, LinkedIn export Activity ID. Identical content stays separate; no content clustering yet.
- Reject ID/URL disagreement, untrusted body fallback, ambiguous identity candidates. Revalidate at export.
- Numeric and link differences survive normalization. Fingerprints remain 32-bit and informational only.
- Existing checkpoints/exports may contain silently merged records which cannot be repaired automatically. Stop active sessions and start a fresh session for evaluation.

## Acceptance gates (not executed in this environment)
1. Both existing Node regression suites plus added collision/mismatch cases pass.
2. Load both unpacked extensions on an authorized test source; manually check distinct IDs with identical content, repeated observation of the same ID, two posts from the same author/time, missing ID, comment-only and repost cases.
3. Compare independently reviewed precision and coverage. No false merges or invalid acceptance in the test sample; report sample size and coverage separately.
4. Verify checkpoint/resume and export; raw data remains local.
5. Do not merge before live review. Conservative DOM selection may reduce coverage, particularly Facebook v0.7.3 and newer LinkedIn feed variants. Group slug/numeric aliases can remain separate; full DOM ownership validation, SHA-256 and similarity clustering are follow-up work.

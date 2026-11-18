const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../facebook-group-probe-extension/extractor-core.js');

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/facebook-post-extraction-cases.json'), 'utf8'));

function fixturePost(item) {
  const postId = item.source_post_id;
  return {
    post_id: postId,
    post_url: postId ? `https://www.facebook.com/groups/manual-review/posts/${postId}/` : null,
    text: item.body.text,
    body: item.body,
    provenance: {
      verified_top_level_container: item.verified_container,
      identity_source: item.identity_source,
      identity_confidence: item.identity_confidence
    }
  };
}

test('20 manually inspected Facebook cases match validation labels', () => {
  assert.equal(fixtures.length, 20);
  const covered = new Set(fixtures.flatMap((item) => item.features));
  for (const required of ['image', 'images', 'comments', 'shared_post', 'see_more']) assert.ok(covered.has(required));
  for (const item of fixtures) assert.equal(Core.validatePost(fixturePost(item)).status, item.expected_status, item.id);
});

test('demand classification gate opens only for VALID extraction', () => {
  for (const item of fixtures) {
    assert.equal(Core.canClassifyDemand(fixturePost(item)), item.expected_status === 'VALID', item.id);
  }
});

test('top-level body selector never substitutes comments or shared-post text', () => {
  const selected = Core.selectOriginalPostBody([
    { text: 'Nested reply', source: 'message', scope: 'nested', inside_comment: true },
    { text: 'Shared attachment body', source: 'message', scope: 'nested', inside_shared_post: true },
    { text: 'Verified original post body', source: 'message', scope: 'top-level' }
  ]);
  assert.equal(selected.text, 'Verified original post body');
  assert.equal(selected.is_original, true);
  const missing = Core.selectOriginalPostBody([{ text: 'Only a comment', source: 'message', scope: 'nested', inside_comment: true }]);
  assert.equal(missing.text, null);
  assert.equal(missing.is_original, false);
});

test('partial observations merge only through strong stable evidence', () => {
  const bodyOnly = { correlation_key: 'corr-1', body: { text: 'Original body', is_original: true }, content_fingerprint: 'body-1' };
  const identityOnly = { correlation_key: 'corr-1', post_id: '123', post_url: 'https://www.facebook.com/groups/g/posts/123/' };
  const unrelated = { correlation_key: 'corr-2', post_id: '999' };
  assert.equal(Core.canMergePostObservations(bodyOnly, identityOnly), true);
  assert.equal(Core.canMergePostObservations(bodyOnly, unrelated), false);
  assert.ok(Core.observationQuality(identityOnly) > 0);
});

test('canonical permalink extraction covers direct, story and media-set links', () => {
  assert.deepEqual(Core.canonicalPostIdentity('https://www.facebook.com/groups/123/posts/456/?comment_id=9'), {
    post_id: '456', group_key: '123', post_url: 'https://www.facebook.com/groups/123/posts/456/', source: 'direct-post-link', confidence: 1
  });
  assert.equal(Core.canonicalPostIdentity('https://www.facebook.com/permalink.php?story_fbid=789&id=123').post_url, 'https://www.facebook.com/groups/123/posts/789/');
  assert.equal(Core.canonicalPostIdentity('https://www.facebook.com/photo/?fbid=1&set=pcb.987', '123').post_url, 'https://www.facebook.com/groups/123/posts/987/');
});

test('Vietnamese absolute dates preserve text and convert to ISO +07:00', () => {
  const parsed = Core.parseVietnameseAbsoluteDate('Thứ Hai, 16 Tháng 11, 2026 lúc 10:21');
  assert.equal(parsed.original_text, 'Thứ Hai, 16 Tháng 11, 2026 lúc 10:21');
  assert.equal(parsed.iso, '2026-11-16T10:21:00+07:00');
  assert.ok(parsed.confidence >= 0.95);
  assert.equal(Core.parseVietnameseAbsoluteDate('2 giờ').iso, null);
});

test('Vietnamese reaction counts parse decimal suffixes and thousands separators', () => {
  const cases = new Map([
    ['23K người', 23000], ['1,2K', 1200], ['1.234', 1234], ['1,5 nghìn', 1500],
    ['2 triệu', 2000000], ['1,25 triệu', 1250000], ['987', 987]
  ]);
  for (const [input, expected] of cases) assert.equal(Core.parseVietnameseNumber(input), expected, input);
});

test('before/after manual-review metrics meet precision guardrail', () => {
  const truthPositive = fixtures.filter((item) => item.manual_body_truth);
  // Every reviewed record was counted by v0.6.3 because it used either a message or visible-context fallback.
  const oldAccepted = fixtures;
  const oldTruePositive = oldAccepted.filter((item) => item.manual_body_truth);
  const newAccepted = fixtures.filter((item) => Core.validatePost(fixturePost(item)).is_valid);
  const newTruePositive = newAccepted.filter((item) => item.manual_body_truth);
  const metrics = {
    old_precision: oldTruePositive.length / oldAccepted.length,
    old_coverage: oldTruePositive.length / truthPositive.length,
    new_precision: newTruePositive.length / newAccepted.length,
    new_coverage: newTruePositive.length / truthPositive.length
  };
  assert.equal(metrics.old_precision, 0.45);
  assert.equal(metrics.old_coverage, 1);
  assert.ok(metrics.new_precision > metrics.old_precision, JSON.stringify(metrics));
  assert.equal(metrics.new_precision, 1);
  assert.equal(metrics.new_coverage, 8 / 9);
});

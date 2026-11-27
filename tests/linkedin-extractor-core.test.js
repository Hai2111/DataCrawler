const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../linkedin-post-collector-extension/extractor-core.js');

test('extracts activity IDs from LinkedIn URNs and post URLs', () => {
  assert.equal(Core.activityId('urn:li:activity:7312345678901234567'), '7312345678901234567');
  assert.equal(Core.activityId('https://www.linkedin.com/posts/example_topic-activity-7312345678901234567-abcd'), '7312345678901234567');
});

test('creates one canonical permalink shape', () => {
  assert.deepEqual(Core.canonicalIdentity(['urn:li:activity:7312345678901234567']), {
    activity_id: '7312345678901234567',
    post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:7312345678901234567/',
    source: 'activity-reference', confidence: 1
  });
});

test('VALID requires original body, canonical ID, URL and provenance', () => {
  const validation = Core.validatePost({
    activity_id: '7312345678901234567',
    post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:7312345678901234567/',
    body: { text: 'We need a PCB designer for a prototype.', is_original: true },
    provenance: { verified_top_level_container: true, identity_source: 'activity-reference', identity_confidence: 1 }
  });
  assert.equal(validation.status, 'VALID');
  assert.equal(validation.is_valid, true);
});

test('missing body is PARTIAL and cannot be treated as valid', () => {
  const validation = Core.validatePost({
    activity_id: '7312345678901234567',
    post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:7312345678901234567/',
    body: { text: null, is_original: false }, provenance: { verified_top_level_container: true, identity_source: 'activity-reference', identity_confidence: 1 }
  });
  assert.equal(validation.status, 'PARTIAL');
  assert.ok(validation.reasons.includes('missing_original_body'));
});

test('same verified Activity ID required; collisions and inconsistent URLs rejected', () => {
  const base = { activity_id: '7312345678901234567', post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:7312345678901234567/', body: { text: 'Original body', is_original: true }, provenance: { verified_top_level_container: true, identity_source: 'activity-reference', identity_confidence: 1 } };
  assert.equal(Core.canMerge(base, { ...base, body: { text: null, is_original: false } }), true);
  assert.equal(Core.canMerge({ ...base, activity_id: null, post_url: null, correlation_key: 'same' }, { ...base, correlation_key: 'same' }), false);
  assert.equal(Core.canMerge(base, { ...base, activity_id: '7399999999999999999', post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:7399999999999999999/' }), false);
  assert.equal(Core.validatePost({ ...base, activity_id: '7399999999999999999' }).status, 'INVALID');
  assert.equal(Core.validatePost({ ...base, post_url: 'https://example.com/feed/update/urn:li:activity:7312345678901234567/' }).is_valid, false);
  assert.equal(Core.validatePost({ ...base, body: { ...base.body, source: '[dir="auto"]' } }).is_valid, false);
});

test('parses compact LinkedIn engagement numbers', () => {
  assert.equal(Core.parseCompactNumber('1,2K reactions'), 1200);
  assert.equal(Core.parseCompactNumber('12.345 lượt bày tỏ cảm xúc'), 12345);
  assert.equal(Core.parseCompactNumber('2 triệu'), 2_000_000);
});

test('uses time datetime as reliable timestamp', () => {
  const parsed = Core.parseTimestamp('2h', '2026-11-19T08:30:00.000Z');
  assert.equal(parsed.iso, '2026-11-19T08:30:00.000Z');
  assert.equal(parsed.confidence, 1);
});

test('observation quality increases with verified identity and body', () => {
  const partial = Core.quality({ body: { text: 'Body', is_original: true } });
  const complete = Core.quality({ body: { text: 'Body', is_original: true }, activity_id: '7312345678901234567', post_url: 'x', provenance: { verified_top_level_container: true, identity_source: 'activity-reference', identity_confidence: 1 } });
  assert.ok(complete > partial);
});

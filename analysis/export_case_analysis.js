const fs = require('fs');

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node export_case_analysis.js <export.json>');
const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const groups = Array.isArray(data.groups) ? data.groups : [];
const uniquePosts = Array.isArray(data.unique_posts) ? data.unique_posts : [];

const count = (predicate) => uniquePosts.filter(predicate).length;
const durationSeconds = Math.round((new Date(data.finished_at) - new Date(data.started_at)) / 1000);
const groupRows = groups.map((group) => ({
  group_key: group.group_key,
  title: group.group_title,
  posts: group.posts?.length || 0,
  rounds: group.rounds || 0,
  stop_reason: group.stop_reason,
  demand_posts: (group.posts || []).filter((post) => post.demand?.is_demand).length,
  contact_posts: (group.posts || []).filter((post) =>
    (post.contacts?.phones?.length || 0) + (post.contacts?.emails?.length || 0) > 0
  ).length,
}));

const summary = {
  schema_version: data.schema_version,
  stopped_by_user: data.stopped_by_user,
  duration_seconds: durationSeconds,
  attempted_groups: data.attempted_group_count,
  complete_groups: data.complete_group_count,
  incomplete_groups: data.incomplete_group_count,
  raw_group_posts: groups.reduce((sum, group) => sum + (group.posts?.length || 0), 0),
  unique_posts: uniquePosts.length,
  duplicate_posts: data.duplicate_post_count,
  demand_posts_flagged: data.demand_post_count,
  contact_leads_flagged: data.contact_lead_count,
  posts_with_url: count((post) => Boolean(post.post_url)),
  posts_with_timestamp: count((post) => Boolean(post.posted_at_text)),
  posts_with_media: count((post) => (post.media?.length || 0) > 0),
  posts_with_visible_comments: count((post) => (post.visible_comments?.length || 0) > 0),
  posts_with_reaction_count: count((post) => post.engagement?.reaction_count != null),
  posts_with_comment_count: count((post) => post.engagement?.comment_count != null),
  posts_with_share_count: count((post) => post.engagement?.share_count != null),
  fallback_post_ids: count((post) => String(post.post_id || '').startsWith('text-')),
  groups: groupRows,
};

console.log(JSON.stringify(summary, null, 2));

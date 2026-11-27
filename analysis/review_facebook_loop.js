const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const rawDirectory = path.join(projectRoot, 'collected_data', 'facebook-loop', 'raw');
const reviewDirectory = path.join(projectRoot, 'collected_data', 'facebook-loop', 'review');

const keywordRules = [
  ['thiết kế mạch điện tử', /thiết\s*kế\s*(?:mạch|bo\s*mạch)|schematic|layout/iu],
  ['thiết kế PCB', /thiết\s*kế\s*pcb|pcb\s*layout|altium|gerber/iu],
  ['gia công PCB PCBA', /gia\s*công\s*(?:pcb|mạch)|\bpcba?\b|smt|stencil/iu],
  ['thiết kế bo mạch theo yêu cầu', /bo\s*mạch.*theo\s*yêu\s*cầu|mạch.*theo\s*yêu\s*cầu/iu],
  ['lập trình vi điều khiển', /lập\s*trình|vi\s*điều\s*khiển|firmware|embedded/iu],
  ['ESP32 Việt Nam', /esp32|esp8266/iu],
  ['Arduino Việt Nam', /arduino/iu],
  ['STM32 Việt Nam', /stm32|\barm\b/iu],
  ['IoT Việt Nam', /\biot\b|mqtt|lora|bluetooth|\bble\b|wifi/iu],
  ['R&D sản phẩm điện tử', /\br&d\b|phát\s*triển\s*sản\s*phẩm/iu],
  ['prototype điện tử', /prototype|mẫu\s*thử|chế\s*tạo\s*mẫu/iu],
  ['tự động hóa PLC Việt Nam', /tự\s*động\s*hóa|\bplc\b|\bhmi\b|jig|fixture/iu]
];

function flattenPosts(payload) {
  if (Array.isArray(payload.unique_posts)) return payload.unique_posts;
  if (Array.isArray(payload.groups)) {
    return payload.groups.flatMap((group) => (group.posts || []).map((post) => ({
      ...post,
      group_key: post.group_key || group.group_key
    })));
  }
  return [];
}

function isValid(post) {
  return post?.validation?.status === 'VALID' && post?.validation?.is_valid === true;
}

function normalizeText(value) {
  return String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

fs.mkdirSync(reviewDirectory, { recursive: true });
const files = fs.existsSync(rawDirectory)
  ? fs.readdirSync(rawDirectory).filter((name) => name.endsWith('.json')).sort()
  : [];

const fileSummaries = [];
const validPosts = [];
const legacyPosts = [];
for (const name of files) {
  const payload = JSON.parse(fs.readFileSync(path.join(rawDirectory, name), 'utf8'));
  const posts = flattenPosts(payload);
  const validated = posts.filter(isValid);
  validPosts.push(...validated);
  if (!validated.length && posts.length) legacyPosts.push(...posts);
  fileSummaries.push({
    file: name,
    schema_version: payload.schema_version || 'legacy',
    posts: posts.length,
    valid_posts: validated.length,
    demand_posts: Array.isArray(payload.demand_posts) ? payload.demand_posts.length : null,
    errors: Array.isArray(payload.errors) ? payload.errors.length : 0
  });
}

const evidencePosts = validPosts.length ? validPosts : legacyPosts;
const evidenceQuality = validPosts.length ? 'VALID_ONLY' : 'LEGACY_PROVISIONAL';
const keywordEvidence = keywordRules.map(([keyword, rule]) => ({
  keyword,
  matching_posts: evidencePosts.reduce((count, post) => count + (rule.test(normalizeText(post.text)) ? 1 : 0), 0)
})).sort((a, b) => b.matching_posts - a.matching_posts || a.keyword.localeCompare(b.keyword, 'vi'));

const review = {
  generated_at: new Date().toISOString(),
  raw_directory: rawDirectory,
  evidence_quality: evidenceQuality,
  warning: evidenceQuality === 'VALID_ONLY'
    ? null
    : 'No schema 0.7+ VALID records were found; keyword counts are provisional and must not be used to classify customer demand.',
  files: fileSummaries,
  totals: {
    files: files.length,
    valid_posts: validPosts.length,
    provisional_legacy_posts: legacyPosts.length
  },
  recommended_keywords: keywordEvidence.map((item) => item.keyword),
  keyword_evidence: keywordEvidence
};

const outputPath = path.join(reviewDirectory, 'facebook-loop-review-latest.json');
fs.writeFileSync(outputPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output: outputPath, ...review.totals, evidence_quality: evidenceQuality }, null, 2)}\n`);

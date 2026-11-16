const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sourcePath = path.resolve(__dirname, '../collected_data/facebook-research-2026-11-15.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const clean = (value) => String(value || '')
  .normalize('NFC')
  .replace(/(?:Facebook\s+){2,}/giu, '')
  .replace(/\[AUTHOR_REDACTED\]|\[PHONE_REDACTED\]/gu, '')
  .replace(/\b[\w-]{5,}\.com\b/giu, '')
  .replace(/\s+/g, ' ')
  .trim();

const records = source.groups.flatMap((group) => group.posts.map((post) => ({
  group_key: group.group_key,
  post_id: post.post_id,
  post_url: post.post_url,
  text: clean(post.text),
})));

const designDomain = /thiết\s*kế|pcb|bo\s*mạch|mạch\s+in|firmware|lập\s*trình|code|iot|arduino|esp32|stm32|prototype|mẫu\s+thử|r&d|odm|gia\s*công\s+mạch|hàn\s+linh\s*kiện|sơ\s*đồ\s+mạch|đồ\s*án|webduino|jig|fixture/iu;

const patterns = {
  explicit_client_request: /(?:tôi|mình|em|bên\s+mình|công\s*ty\s+mình|tui)\s+(?:đang\s+)?(?:cần|muốn|tìm)|tìm\s+(?:người|đơn\s*vị|team)\s+(?:làm|nhận|thiết\s*kế|phát\s*triển)|cần\s+thuê|thuê\s+(?:người|đơn\s*vị|team)|ai\s+(?:nhận|làm)|có\s+ai\s+(?:nhận|làm)/iu,
  pricing_or_moq: /giá\s+bao\s*nhiêu|bao\s*giá|xin\s+giá|tối\s*thiểu\s+bao\s*nhiêu|số\s*lượng\s+tối\s*thiểu|moq|chi\s*phí\s+(?:thiết\s*kế|làm|gia\s*công)/iu,
  supplier_offer: /nhận\s+(?:thiết\s*kế|làm|gia\s*công|hàn|code|lập\s*trình)|chúng\s+tôi\s+(?:cung\s*cấp|giúp|nhận)|dịch\s*vụ\s+(?:thiết\s*kế|gia\s*công|r&d)|đối\s+tác\s+(?:r&d|phát\s*triển)|gia\s*công\s+pcb|phát\s*triển\s+sản\s*phẩm\s+theo\s+yêu\s*cầu|bạn\s+(?:đang\s+)?cần\s+(?:thiết\s*kế|tìm\s+đối\s+tác)/iu,
  hiring: /tuyển|\bhiring\b|\bengineer\b|lương\s+\d|tìm\s+đồng\s+đội/iu,
  study_project: /bài\s+tập|đồ\s*án|sinh\s*viên|deadline|stem|webduino|blockly/iu,
  prototype_to_production: /prototype|mẫu\s+thử|chế\s+tạo\s+mẫu|sản\s*xuất|lắp\s*ráp|smt|pcba|bom\b|gerber|test\s*equipment/iu,
  hardware_firmware_bundle: /(?:phần\s*cứng|hardware).*(?:firmware|phần\s*mềm)|(?:firmware|phần\s*mềm).*(?:phần\s*cứng|hardware)|pcb.*(?:firmware|code)|(?:firmware|code).*pcb/iu,
};

const capabilityPatterns = {
  schematic_and_pcb_layout: /sơ\s*đồ\s*mạch|mạch\s*nguyên\s*lý|schematic|layout|thiết\s*kế\s+(?:mạch|pcb)|altium|gerber/iu,
  firmware_embedded_code: /firmware|lập\s*trình|code|vi\s*điều\s*khiển|arduino|esp32|stm32|8051|avr|pic\b|\barm\b/iu,
  pcb_fabrication: /gia\s*công\s+(?:mạch|pcb)|làm\s+pcb|pcb\s+\d+[-–]\d+\s*lớp|mạch\s*in|sản\s*xuất\s+pcb/iu,
  assembly_soldering: /hàn\s+linh\s*kiện|lắp\s*ráp|smt|pcba|stencil/iu,
  component_bom_sourcing: /\bbom\b|chọn\s+linh\s*kiện|linh\s*kiện|cung\s*ứng|sourcing/iu,
  testing_debug_repair: /kiểm\s*thử|kiểm\s*tra|test|debug|sửa\s*mạch|lỗi|fix|fixture/iu,
  enclosure_mechanical: /thiết\s*kế\s+(?:cơ\s*khí|vỏ)|vỏ\s+(?:sản\s*phẩm|thiết\s*bị)|mechanical|solidworks|autocad|in\s*3d/iu,
  prototype_pilot: /prototype|mẫu\s+thử|chế\s*tạo\s+mẫu|mạch\s*mẫu|bo\s+mẫu|vài\s+bo|số\s*lượng\s+ít/iu,
  production_scaling: /sản\s*xuất\s+số\s*lượng|số\s*lượng\s+lớn|triển\s*khai\s+sản\s*xuất|định\s*hướng\s+sản\s*xuất|mass\s*production/iu,
  wireless_iot: /iot|wifi|wi-fi|bluetooth|\bble\b|lora|4g|mqtt|wearable/iu,
  automation_control: /\bplc\b|tủ\s*điện|tự\s*động\s*hóa|jig|fixture|điều\s*khiển/iu,
  high_speed_advanced_pcb: /high[-\s]?speed|\bhdi\b|impedance|pcie|versal|hbm|flex|rogers|\bdfm\b/iu,
};

const relevant = records.filter((record) => designDomain.test(record.text)).map((record) => ({
  ...record,
  tags: Object.entries(patterns).filter(([, re]) => re.test(record.text)).map(([name]) => name),
}));

const fingerprint = (text) => crypto.createHash('sha1')
  .update(text.toLowerCase().replace(/xem thêm/giu, '').slice(0, 500))
  .digest('hex');

const uniqueByContent = [];
const seen = new Set();
for (const record of relevant) {
  const key = fingerprint(record.text);
  if (seen.has(key)) continue;
  seen.add(key);
  uniqueByContent.push(record);
}

const countTags = (items) => {
  const counts = {};
  for (const item of items) for (const tag of item.tags) counts[tag] = (counts[tag] || 0) + 1;
  return counts;
};

const capabilityCounts = {};
for (const record of uniqueByContent) {
  for (const [name, re] of Object.entries(capabilityPatterns)) {
    if (re.test(record.text)) capabilityCounts[name] = (capabilityCounts[name] || 0) + 1;
  }
}

const clientCandidates = uniqueByContent.filter((record) =>
  record.tags.includes('explicit_client_request') || record.tags.includes('pricing_or_moq')
);

console.log(JSON.stringify({
  total_posts: records.length,
  design_related_records: relevant.length,
  design_related_unique_content: uniqueByContent.length,
  tag_counts_unique_content: countTags(uniqueByContent),
  capability_mentions_unique_content: Object.fromEntries(
    Object.entries(capabilityCounts).sort((a, b) => b[1] - a[1])
  ),
  client_candidate_count: clientCandidates.length,
  client_candidates: clientCandidates.map((record) => ({
    group_key: record.group_key,
    post_id: record.post_id,
    tags: record.tags,
    text: record.text.slice(0, 900),
  })),
}, null, 2));

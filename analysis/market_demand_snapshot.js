const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve(__dirname, '../collected_data/facebook-research-2026-11-15.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const posts = source.groups.flatMap((group) =>
  group.posts.map((post) => ({ ...post, group_key: group.group_key }))
);

const normalize = (value) => String(value || '')
  .normalize('NFC')
  .replace(/\s+/g, ' ')
  .trim();

const intentRules = {
  explicit_buy: /(?:cần|can|muốn|muon)\s+mua|tìm\s+mua|mua\s+số\s*lượng|(?:em|mình|tôi|bên\s+mình)\s+cần\s+tìm|xin\s+(?:giá|báo\s*giá)|(?:motor|driver|arduino|module|modul|mạch|mach|hàng)\s+giá\s+(?:sao|bao\s*nhiêu)|ai\s+có\s+(?:hàng|bán)|bác\s+nào\s+có\s+(?:hàng|bán)|anh\s+em\s+có\s+hàng/iu,
  technical_help: /(?:xin|cho)\s+hỏi|nhờ\s+(?:mọi\s*người|anh\s*em|các\s*bác)|(?:xin|cần)\s+tư\s*vấn|(?:giúp|hỗ\s*trợ)\s+(?:em|mình|tôi)|(?:bị|báo|gặp)\s+lỗi|không\s+(?:chạy|hoạt\s*động|nạp|kết\s*nối|đọc|nhận|lên)|sơ\s*đồ\s+(?:đấu|mạch)|đấu\s+(?:thế|như)\s*nào/iu,
  service_need: /(?:em|mình|tôi|bên\s+mình)\s+cần\s+(?:sửa|thiết\s*kế|gia\s*công|làm|thợ|người)|tìm\s+(?:thợ|người|đơn\s*vị)\s+(?:làm|sửa|thiết\s*kế|gia\s*công)|thuê\s+(?:làm|thiết\s*kế|lập\s*trình|sửa)/iu,
  hiring: /tuyển\s+(?:dụng|\d+\s+vị\s+trí|kỹ\s+sư|nhân\s+viên)|(?:cần|đang)\s+tuyển|\bengineer\b.*(?:lương|salary)|lương\s+\d+[–-]\d+\s*triệu/iu,
  supply: /(?:^|\s)(?:bán|thanh\s*lý|pass\s*lại|e\s+bán|em\s+bán|giá\s+\d|bao\s+test|hàng\s+về|nhận\s+(?:làm|sửa|gia\s*công|thiết\s*kế))(?:\s|$)/iu,
};

const topicRules = {
  plc_hmi_modules: /\bplc\b|\bhmi\b|siemens|mitsubishi|delta|omron|dvp\w*|s7[-\s]?\d+|module|modul/iu,
  servo_motor_encoder: /servo|encoder|động\s*cơ|dong\s*co|motor|stepper/iu,
  inverter_power_control: /biến\s*tần|bien\s*tan|inverter|vfd|kw\b|380v|220v|nguồn|mosfet|driver/iu,
  pcb_design_manufacturing: /\bpcb\b|bo\s*mạch|bom\s*mạch|mạch\s+in|layout|gerber|altium|gia\s*công\s+mạch|thiết\s*kế\s+mạch|hàn\s+mạch|smt/iu,
  embedded_esp_arduino_iot: /esp32|esp8266|arduino|stm32|raspberry|vi\s*điều\s*khiển|iot|firmware|mqtt|wifi|bluetooth/iu,
  sensors_connectors_components: /cảm\s*biến|sensor|giắc|jack|connector|relay|rơ\s*le|ic\b|linh\s*kiện|điện\s*trở|tụ\b|transistor/iu,
  repair_troubleshooting: /sửa|lỗi|hỏng|không\s+(?:chạy|được|kết\s*nối)|kiểm\s*tra|bao\s*test|tư\s*vấn|giúp|hướng\s*dẫn/iu,
};

const classified = posts.map((post) => {
  const text = normalize(post.text);
  const intents = Object.entries(intentRules).filter(([, re]) => re.test(text)).map(([name]) => name);
  const topics = Object.entries(topicRules).filter(([, re]) => re.test(text)).map(([name]) => name);
  return { ...post, text, intents, topics };
});

const demand = classified.filter((post) =>
  post.intents.some((intent) => ['explicit_buy', 'technical_help', 'service_need'].includes(intent))
);

const countBy = (items, getter) => {
  const counts = new Map();
  for (const item of items) {
    for (const key of getter(item)) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
};

const samples = demand.slice(0, 40).map((post) => ({
  group_key: post.group_key,
  post_id: post.post_id,
  intents: post.intents,
  topics: post.topics,
  text: post.text.slice(0, 500),
}));

console.log(JSON.stringify({
  source: path.basename(sourcePath),
  total_posts: posts.length,
  demand_signal_posts: demand.length,
  intent_counts: countBy(classified, (post) => post.intents),
  all_topic_counts: countBy(classified, (post) => post.topics),
  demand_topic_counts: countBy(demand, (post) => post.topics),
  demand_by_group: countBy(demand, (post) => [post.group_key]),
  samples,
}, null, 2));

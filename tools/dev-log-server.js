const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 32145;
const projectRoot = path.resolve(__dirname, '..');
const logDirectory = path.join(projectRoot, 'debug_logs');
const logFile = path.join(logDirectory, 'extension-live.jsonl');
const latestFile = path.join(logDirectory, 'extension-live-latest.json');
const MAX_BODY_BYTES = 1024 * 1024;

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body exceeds 1 MB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  response.end(JSON.stringify(payload));
}

async function persistLog(payload) {
  await fs.mkdir(logDirectory, { recursive: true });
  const record = { received_at: new Date().toISOString(), ...payload };
  await fs.appendFile(logFile, `${JSON.stringify(record)}\n`, 'utf8');
  await fs.writeFile(latestFile, JSON.stringify(record, null, 2), 'utf8');
  return record;
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, {
      ok: true,
      service: 'facebook-demand-collector-dev-log',
      log_file: path.relative(projectRoot, logFile).replaceAll('\\', '/')
    });
  }
  if (request.method !== 'POST' || request.url !== '/log') {
    return sendJson(response, 404, { ok: false, error: 'Not found.' });
  }
  try {
    const payload = await readJsonBody(request);
    const record = await persistLog(payload);
    sendJson(response, 200, { ok: true, sequence: record.sequence || null });
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, async () => {
  await fs.mkdir(logDirectory, { recursive: true });
  process.stdout.write(`Dev log bridge listening at http://${HOST}:${PORT}\n`);
  process.stdout.write(`Writing extension logs to ${logFile}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

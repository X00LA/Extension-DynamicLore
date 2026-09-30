import http from 'node:http';
import { readFileSync, writeFileSync, realpathSync, lstatSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.ST_TEST_ROOT) throw new Error('Set ST_TEST_ROOT to the isolated SillyTavern checkout; fixture artifacts belong in its smoke directory.');
const ST_ROOT = realpathSync(process.env.ST_TEST_ROOT);
if (JSON.parse(readFileSync(path.join(ST_ROOT, 'package.json'), 'utf8')).name !== 'sillytavern') throw new Error('ST_TEST_ROOT must be a SillyTavern checkout');
mkdirSync(path.join(ST_ROOT, 'smoke'), { recursive: true });
const ROOT = realpathSync(path.join(ST_ROOT, 'smoke'));
const HOST = '127.0.0.1';
const MODEL = 'dynamiclore-fixture';
const MAX_BYTES = 1024 * 1024;
const DEFAULT_TEXT = 'Smoke fixture reply: Haven has two moons.';
const USAGE = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
const ROUTES = new Map([
  ['/health', 'GET'], ['/v1/models', 'GET'], ['/v1/chat/completions', 'POST'],
]);

function requireHost(host) {
  if (host !== HOST) throw new Error('Fixture binding must be exactly 127.0.0.1.');
}

function insideRoot(filename) {
  const relative = path.relative(ROOT, filename);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function localFile(filename) {
  const absolute = path.resolve(ROOT, filename);
  if (!insideRoot(absolute)) throw new Error('Fixture files must stay inside smoke.');
  const parent = realpathSync(path.dirname(absolute));
  if (parent !== ROOT && !insideRoot(parent)) throw new Error('Fixture files must stay inside smoke (no escaping links).');
  if (existsSync(absolute)) {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !insideRoot(realpathSync(absolute))) {
      throw new Error('Fixture files must be regular unlinked files inside smoke.');
    }
  }
  return absolute;
}

export function parseArgs(args) {
  const options = { host: HOST, port: 8128 };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') { options.help = true; continue; }
    if (!['--host', '--port', '--response-file', '--journal-limit'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--host') options.host = value;
    if (flag === '--port') options.port = Number(value);
    if (flag === '--response-file') options.responseFile = value;
    if (flag === '--journal-limit') options.journalLimit = Number(value);
  }
  requireHost(options.host);
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  return options;
}

export function createFixture({ host = HOST, responseFile, journalFile = 'fixture-requests.jsonl', journalLimit = 100 } = {}) {
  requireHost(host);
  if (!Number.isInteger(journalLimit) || journalLimit < 1 || journalLimit > 500) throw new Error('Journal limit must be an integer from 1 to 500.');
  const journalPath = localFile(journalFile);
  let text = DEFAULT_TEXT;
  if (responseFile !== undefined) {
    const responsePath = localFile(responseFile);
    if (responsePath.toLowerCase() === journalPath.toLowerCase()) throw new Error('Response and journal files must differ.');
    if (lstatSync(responsePath).size > MAX_BYTES) throw new Error('Response file exceeds 1 MiB.');
    text = readFileSync(responsePath, 'utf8');
  }
  // Reset only when listening succeeds; a port conflict must not erase an existing journal.
  const rows = [];
  let sequence = 0;
  const server = http.createServer(async (req, res) => {
    res.sendDate = false;
    const route = (req.url ?? '').split('?')[0];
    const record = {
      sequence: ++sequence,
      method: ['GET', 'POST', 'OPTIONS', 'HEAD', 'PUT', 'DELETE', 'PATCH'].includes(req.method) ? req.method : 'OTHER',
      route: ROUTES.has(route) ? route : '[unmatched]',
      status: 0, bodyBytes: 0, messageCount: 0, stream: false,
    };
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    const error = (status, message) => json(status, { error: { message, type: 'invalid_request_error', param: null, code: null } });
    res.once('finish', () => {
      record.status = res.statusCode;
      rows.push(record);
      if (rows.length > journalLimit) rows.shift();
      try {
        writeFileSync(localFile(journalPath), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
      } catch {
        console.error('Fixture journal write failed; stopping the fixture.');
        server.close();
        server.closeAllConnections();
      }
    });
    if (!ROUTES.has(route)) { req.resume(); error(404, 'Unknown fixture route.'); return; }
    if (req.method !== ROUTES.get(route)) {
      req.resume(); res.setHeader('Allow', ROUTES.get(route)); error(405, 'Method not allowed.'); return;
    }
    if (route === '/health') { req.resume(); json(200, { status: 'ok', fixture: 'dynamiclore-smoke' }); return; }
    if (route === '/v1/models') {
      req.resume(); json(200, { object: 'list', data: [{ id: MODEL, object: 'model', created: 0, owned_by: 'local-fixture' }] }); return;
    }
    // Collect at most 1 MiB without retaining an oversized request body.
    const body = await new Promise(resolve => {
      const chunks = [];
      let settled = false;
      req.on('data', chunk => {
        if (settled) return;
        record.bodyBytes += chunk.length;
        if (record.bodyBytes > MAX_BYTES) {
          settled = true; chunks.length = 0;
          res.setHeader('Connection', 'close');
          error(413, 'Request body exceeds 1 MiB.'); resolve(null);
        } else chunks.push(chunk);
      });
      req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
      req.on('error', () => { if (!settled) { settled = true; resolve(null); } });
      req.on('aborted', () => { if (!settled) { settled = true; resolve(null); } });
    });
    if (body === null) return;
    let request;
    try { request = JSON.parse(body); } catch { error(400, 'Request body must be valid JSON.'); return; }
    if (!request || Array.isArray(request) || !Array.isArray(request.messages) ||
        (request.stream !== undefined && typeof request.stream !== 'boolean') ||
        (request.model !== undefined && (typeof request.model !== 'string' || request.model.length > 128))) {
      error(400, 'Expected messages array, optional boolean stream, and optional model string (max 128 characters).'); return;
    }
    record.messageCount = request.messages.length;
    record.stream = request.stream === true;
    const shared = { id: 'chatcmpl-dynamiclore-fixture', created: 0, model: request.model || MODEL };
    if (!record.stream) {
      json(200, { ...shared, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: USAGE });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const chunk = (delta, finish = null) => `data: ${JSON.stringify({ ...shared, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    // Await drain for large response files; disconnects terminate the writer.
    const write = data => new Promise(resolve => {
      if (res.destroyed) { resolve(false); return; }
      if (res.write(data)) { resolve(true); return; }
      const done = () => { res.off('drain', drained); res.off('close', closed); };
      const drained = () => { done(); resolve(true); };
      const closed = () => { done(); resolve(false); };
      res.once('drain', drained); res.once('close', closed);
    });
    if (!await write(chunk({ role: 'assistant', content: '' }))) return;
    const characters = Array.from(text);
    for (let i = 0; i < characters.length; i += 16) {
      if (!await write(chunk({ content: characters.slice(i, i + 16).join('') }))) return;
    }
    if (!await write(chunk({}, 'stop'))) return;
    if (request.stream_options?.include_usage === true) {
      if (!await write(`data: ${JSON.stringify({ ...shared, object: 'chat.completion.chunk', choices: [], usage: USAGE })}\n\n`)) return;
    }
    res.end('data: [DONE]\n\n');
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.timeout = 15000;
  server.maxHeadersCount = 100;
  server.once('listening', () => writeFileSync(localFile(journalPath), ''));
  // Enforce loopback even for callers importing this module instead of using the CLI.
  const listen = server.listen.bind(server);
  server.listen = (port, bindHost, ...rest) => {
    requireHost(bindHost);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
    return listen(port, HOST, ...rest);
  };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('node fixture.mjs [--host 127.0.0.1] [--port 8128] [--response-file FILE] [--journal-limit 100]');
    } else {
      const server = createFixture(options);
      server.on('error', error => { console.error(`Fixture failed: ${error.message}`); process.exitCode = 1; });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
      server.listen(options.port, options.host, () => console.log(`Fixture listening at http://${HOST}:${options.port}/v1`));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

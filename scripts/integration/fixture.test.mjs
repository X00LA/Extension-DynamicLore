import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (!process.env.ST_TEST_ROOT) throw new Error('Set ST_TEST_ROOT to the isolated SillyTavern checkout');
const root = path.join(path.resolve(process.env.ST_TEST_ROOT), 'smoke');
mkdirSync(root, { recursive: true });
const implementation = new URL('./fixture.mjs', import.meta.url);

test('fixture implementation exists', () => {
  assert.ok(existsSync(implementation), 'the HTTP fixture must be implemented');
});

async function setup(t, options = {}) {
  const { createFixture } = await import(implementation);
  const dir = mkdtempSync(path.join(root, '.fixture-test-'));
  const journalFile = path.join(dir, 'requests.jsonl');
  let server;
  t.after(async () => {
    if (server?.listening) {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
    assert.ok(path.resolve(dir).startsWith(path.resolve(root) + path.sep));
    rmSync(dir, { recursive: true, force: true });
  });
  if (options.responseText !== undefined) {
    options = { ...options, responseFile: path.join(dir, 'response.txt') };
    writeFileSync(options.responseFile, options.responseText);
    delete options.responseText;
  }
  server = createFixture({ journalFile, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server, journalFile,
    get: route => fetch(base + route),
    post: (body, headers = {}) => fetch(base + '/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  };
}

test('health and model discovery have stable local fixture identity', async t => {
  const f = await setup(t);
  assert.deepEqual(await (await f.get('/health')).json(), { status: 'ok', fixture: 'dynamiclore-smoke' });
  const models = await (await f.get('/v1/models')).json();
  assert.equal(models.object, 'list');
  assert.equal(models.data[0].id, 'dynamiclore-fixture');
});

test('nonstream completions are deterministic across prompts and parameters', async t => {
  const f = await setup(t);
  const first = await f.post({ model: 'smoke-model', messages: [{ role: 'user', content: 'one' }] });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('date'), null);
  const a = await first.json();
  const b = await (await f.post({ model: 'smoke-model', messages: [], temperature: 1, max_tokens: 1 })).json();
  assert.deepEqual(a, b);
  assert.equal(a.object, 'chat.completion');
  assert.equal(a.model, 'smoke-model');
  assert.equal(a.choices[0].message.role, 'assistant');
  assert.equal(a.choices[0].message.content, 'Smoke fixture reply: Haven has two moons.');
  assert.equal(a.choices[0].finish_reason, 'stop');
});

test('SSE rebuilds exact Unicode response and terminates with stop, usage, and DONE', async t => {
  const expected = 'Haven 🌙 has two moons.\n' + '星'.repeat(45);
  const f = await setup(t, { responseText: expected });
  const response = await f.post({ messages: [], stream: true, stream_options: { include_usage: true } });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const frames = (await response.text()).trim().split('\n\n').map(x => x.slice(6));
  assert.equal(frames.pop(), '[DONE]');
  const chunks = frames.map(JSON.parse);
  assert.ok(chunks.every(c => c.object === 'chat.completion.chunk'));
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  assert.equal(chunks.flatMap(c => c.choices).map(c => c.delta.content ?? '').join(''), expected);
  assert.equal(chunks.at(-2).choices[0].finish_reason, 'stop');
  assert.deepEqual(chunks.at(-1).choices, []);
  assert.equal(chunks.at(-1).usage.total_tokens, 0);
  assert.equal((await (await f.post({ messages: [] })).json()).choices[0].message.content, expected);
});

test('sample JSON is delivered verbatim and has DynamicLore entry fields', async t => {
  const responseFile = path.join(root, 'dynamiclore-response.json');
  const f = await setup(t, { responseFile });
  const content = (await (await f.post({ messages: [] })).json()).choices[0].message.content;
  assert.equal(content, readFileSync(responseFile, 'utf8'));
  const entry = JSON.parse(content).entries[0];
  assert.equal(entry.name, 'Haven');
  assert.deepEqual(entry.keywords, ['Haven']);
  assert.equal(entry.type, 'location');
  assert.equal(entry.confidence, 0.95);
});

test('bad input, oversized bodies, unknown routes and methods return JSON errors', async t => {
  const f = await setup(t);
  for (const body of ['{', 'null', '[]', '{}', '{"messages":[],"stream":"true"}']) {
    const r = await f.post(body);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.type, 'invalid_request_error');
  }
  assert.equal((await f.post('x'.repeat(1024 * 1024 + 1))).status, 413);
  assert.equal((await f.get('/not-real')).status, 404);
  assert.equal((await f.get('/v1/chat/completions')).status, 405);
  assert.equal((await f.get('/health')).status, 200);
});

test('journal evicts oldest requests and excludes headers, query values and bodies', async t => {
  const f = await setup(t, { journalLimit: 3 });
  for (let i = 0; i < 6; i++) {
    await (await f.post({ messages: [{ role: 'user', content: 'BODY_SECRET' }] }, {
      Authorization: 'Bearer AUTH_SECRET', 'X-Secret': 'HEADER_SECRET',
    })).text();
  }
  await (await f.get('/unknown?token=QUERY_SECRET')).text();
  const raw = readFileSync(f.journalFile, 'utf8');
  const rows = raw.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.sequence), [5, 6, 7]);
  assert.equal(rows[0].messageCount, 1);
  assert.equal(rows.at(-1).status, 404);
  assert.doesNotMatch(raw, /SECRET|authorization|headers|content/i);
  assert.ok(Buffer.byteLength(raw) < 3 * 512);
});

test('configuration rejects nonlocal hosts and paths outside smoke', async () => {
  const { createFixture, parseArgs } = await import(implementation);
  for (const host of ['0.0.0.0', '::', '192.168.1.2', 'localhost', '']) {
    assert.throws(() => createFixture({ host }), /127\.0\.0\.1/);
  }
  assert.throws(() => createFixture({ journalFile: path.resolve(root, '..', 'outside.jsonl') }), /inside smoke/);
  assert.throws(() => createFixture({ responseFile: path.resolve(root, '..', 'outside.txt') }), /inside smoke/);
  assert.throws(() => parseArgs(['--host', '0.0.0.0']), /127\.0\.0\.1/);
  assert.throws(() => parseArgs(['--port', '0']), /port/i);
  assert.throws(() => parseArgs(['--wat']), /Unknown/);
  const result = spawnSync(process.execPath, [fileURLToPath(implementation), '--host', '0.0.0.0'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /127\.0\.0\.1/);
});

test('default CLI address and imported server binding stay on loopback', async () => {
  const { createFixture, parseArgs } = await import(implementation);
  assert.deepEqual(parseArgs([]), { host: '127.0.0.1', port: 8128 });
  const server = createFixture();
  assert.throws(() => server.listen(0, '0.0.0.0'), /127\.0\.0\.1/);
  assert.throws(() => server.listen(0), /127\.0\.0\.1/);
  assert.equal(server.listening, false);
  for (const journalLimit of [0, 501, 1.5]) {
    assert.throws(() => createFixture({ journalLimit }), /Journal limit/);
  }
});

test('empty response streams terminate without unsolicited usage frames', async t => {
  const f = await setup(t, { responseText: '' });
  const response = await f.post({ messages: [], stream: true });
  const frames = (await response.text()).trim().split('\n\n').map(frame => frame.slice(6));
  assert.equal(frames.length, 3);
  assert.equal(JSON.parse(frames[0]).choices[0].delta.role, 'assistant');
  assert.equal(JSON.parse(frames[1]).choices[0].finish_reason, 'stop');
  assert.equal(frames[2], '[DONE]');
  assert.ok(frames.slice(0, -1).every(frame => !Object.hasOwn(JSON.parse(frame), 'usage')));
});

test('a port conflict leaves the running fixture journal intact', async t => {
  const f = await setup(t);
  await (await f.get('/health')).text();
  const before = readFileSync(f.journalFile, 'utf8');
  const { createFixture } = await import(implementation);
  const conflicting = createFixture({ journalFile: f.journalFile });
  const failure = once(conflicting, 'error');
  conflicting.listen(f.server.address().port, '127.0.0.1');
  assert.equal((await failure)[0].code, 'EADDRINUSE');
  assert.equal(readFileSync(f.journalFile, 'utf8'), before);
  assert.equal(conflicting.listening, false);
});

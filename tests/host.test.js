import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../src/host.js';

const book = (content = 'Original') => ({
    entries: { 0: { uid: 0, key: ['dragon'], content, extensions: { custom: ['keep'] } } },
    extensions: { vendor: { enabled: true } },
});

async function fixture() {
    const calls = [];
    const events = [];
    const cache = new Map();
    let disk = book();
    let responder;
    let listResponder = () => Response.json(['Book', 'Private Book', 'Broken Book', 'Empty Book',
        '龙之书 — Café (第 2 卷).. notes'].map(file_id => ({ file_id, name: file_id })));
    let context = {
        chatMetadata: {},
        characters: [{ data: { extensions: { world: 'Character Book' } } }],
        characterId: 0,
        groupId: null,
        getWorldInfoNames: () => ['Character Book', 'Global Book', 'Other Book'],
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' }),
        eventTypes: { WORLDINFO_UPDATED: 'worldinfo_updated' },
        eventSource: { emit: async (...args) => events.push(args) },
        loadWorldInfo: () => { throw new Error('Cached loader must not be used'); },
        saveWorldInfo: () => { throw new Error('Unchecked saver must not be used'); },
        generateRaw: async (options) => { calls.push(['generate', options]); return 'Alice: response'; },
        updateWorldInfoList: async () => { context.getWorldInfoNames = () => ['Refreshed Book']; },
        reloadWorldInfoEditor: (...args) => calls.push(['editor', ...args]),
    };
    // st-context.js does not export a worldInfo property.
    Object.defineProperty(context, 'worldInfo', { get() { throw new Error('Not an ST API'); } });
    const worldInfoModule = {
        selected_world_info: ['Global Book'],
        worldInfoCache: cache,
        createWorldInfoEntry: (name, data) => {
            calls.push(['create', name, data]);
            let uid = 0;
            while (Object.hasOwn(data.entries, uid)) uid++;
            const entry = { uid, key: [], content: '', order: 100, customDefault: true };
            data.entries[uid] = entry;
            return entry;
        },
    };
    const fetch = async (url, options) => {
        calls.push([url, options]);
        if (url === '/api/worldinfo/list') return listResponder(url, options);
        if (responder) return responder(url, options);
        if (url.endsWith('/get')) return Response.json(disk);
        disk = JSON.parse(options.body).data;
        return new Response('', { status: 200 });
    };
    const host = await createHost(() => context, { worldInfoModule, fetch });
    return {
        host, calls, events, cache, worldInfoModule,
        get context() { return context; },
        set context(value) { context = value; },
        get disk() { return disk; },
        set disk(value) { disk = value; },
        respondWith: (value) => { responder = value; },
        listWith: (value) => { listResponder = value; },
    };
}

test('context and available book names stay live and names are detached', async () => {
    const f = await fixture();
    const names = f.host.listBooks();
    names.pop();
    assert.equal(f.host.listBooks().length, 3);
    f.context = { ...f.context, chatMetadata: { world_info: 'New Chat Book' } };
    assert.strictEqual(f.host.getContext(), f.context);
    assert.equal(f.host.resolveBook(), 'New Chat Book');
});

test('resolves explicit, chat, character, then the single globally selected book', async () => {
    const f = await fixture();
    f.context.chatMetadata.world_info = 'Chat Book';
    assert.equal(f.host.resolveBook('Explicit Book'), 'Explicit Book');
    assert.equal(f.host.resolveBook(), 'Chat Book');
    delete f.context.chatMetadata.world_info;
    assert.equal(f.host.resolveBook(), 'Character Book');
    f.context.characterId = undefined;
    assert.equal(f.host.resolveBook(), 'Global Book');
    f.worldInfoModule.selected_world_info = ['New Global Book'];
    assert.equal(f.host.resolveBook(), 'New Global Book');
});

test('groups skip the changing active speaker but honor chat and explicit choices', async () => {
    const f = await fixture();
    f.context.groupId = 'group-1';
    assert.equal(f.host.resolveBook(), 'Global Book');
    f.context.chatMetadata.world_info = 'Group Chat Book';
    assert.equal(f.host.resolveBook(), 'Group Chat Book');
    assert.equal(f.host.resolveBook('Chosen'), 'Chosen');
});

test('empty and whitespace explicit selections use automatic resolution', async () => {
    const f = await fixture();
    for (const sentinel of ['', '  ', '\t\n', undefined, null]) {
        assert.equal(f.host.resolveBook(sentinel), 'Character Book');
    }
    f.context.chatMetadata.world_info = 'Chat Book';
    assert.equal(f.host.resolveBook(''), 'Chat Book');
    f.context.characterId = undefined;
    delete f.context.chatMetadata.world_info;
    assert.equal(f.host.resolveBook('  '), 'Global Book');
});

test('no target or multiple global books fail instead of choosing an available book', async () => {
    const f = await fixture();
    f.context.characterId = undefined;
    f.worldInfoModule.selected_world_info = [];
    assert.throws(() => f.host.resolveBook(), /book.*(select|explicit)|select.*book/i);
    f.worldInfoModule.selected_world_info = ['Global Book', 'Other Book'];
    assert.throws(() => f.host.resolveBook(), /multiple|ambiguous|exactly one/i);
});

test('duplicate global selections represent one distinct target', async () => {
    const f = await fixture();
    f.context.characterId = undefined;
    f.worldInfoModule.selected_world_info = ['Global Book', 'Global Book'];
    assert.equal(f.host.resolveBook(), 'Global Book');
});

test('rejects empty, traversal and path names before network or entry mutation', async () => {
    const f = await fixture();
    for (const name of ['', '  ', '.', '..', '../book', 'a/b', 'a\\b', 'C:\\book', 'bad\0name']) {
        if (name.trim()) assert.throws(() => f.host.resolveBook(name), /name/i, name);
        await assert.rejects(f.host.readBook(name), /name/i, name);
        await assert.rejects(f.host.writeBook(name, book()), /name/i, name);
        assert.throws(() => f.host.createEntry(name, book()), /name/i, name);
    }
    assert.deepEqual(f.calls, []);
});

test('rejects Windows forbidden names instead of letting ST sanitize to another book', async () => {
    const f = await fixture();
    const names = ['A<B', 'A>B', 'A:B', 'A"B', 'A|B', 'A?B', 'A*B', 'Book.', 'Book ',
        'CON', 'con.txt', 'PRN', 'aux.json', 'NUL', 'COM0', 'COM1', 'com9.backup', 'LPT0', 'LPT9.json',
        'COM¹', 'LPT².txt', 'A'.repeat(251), '龙'.repeat(84)];
    for (const name of names) {
        assert.throws(() => f.host.resolveBook(name), /name/i, name);
        await assert.rejects(f.host.readBook(name), /name/i, name);
        await assert.rejects(f.host.writeBook(name, book()), /name/i, name);
        assert.throws(() => f.host.createEntry(name, book()), /name/i, name);
        await assert.rejects(f.host.refreshEditor(name), /name/i, name);
    }
    assert.deepEqual(f.calls, []);
    for (const name of ['CONquest', 'COM10', 'nul lore', '龙之书 Café', 'A.B', 'A'.repeat(250), '龙'.repeat(83)]) {
        assert.equal(f.host.resolveBook(name), name);
    }
});

test('accepts legitimate Unicode, spaces and punctuation without changing the name', async () => {
    const f = await fixture();
    const name = '龙之书 — Café (第 2 卷).. notes';
    assert.equal(f.host.resolveBook(name), name);
    await f.host.readBook(name);
    assert.deepEqual(JSON.parse(f.calls[1][1].body), { name });
});

test('reads the backend every time and returns a detached full document', async () => {
    const f = await fixture();
    f.cache.set('Book', book('Stale cache'));
    const first = await f.host.readBook('Book');
    assert.equal(first.entries[0].content, 'Original');
    first.entries[0].extensions.custom.push('local change');
    f.disk = book('Changed on server');
    const second = await f.host.readBook('Book');
    assert.deepEqual(second, f.disk);
    assert.deepEqual(second.entries[0].extensions.custom, ['keep']);
    assert.deepEqual(f.calls.map(([url]) => url), [
        '/api/worldinfo/list', '/api/worldinfo/get', '/api/worldinfo/list', '/api/worldinfo/get',
    ]);
    for (const [url, options] of f.calls) {
        assert.ok(['/api/worldinfo/list', '/api/worldinfo/get'].includes(url));
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['X-CSRF-Token'], 'test-token');
        assert.match(options.cache, /no-cache|no-store/);
    }
    assert.deepEqual(f.events, []);
});

test('read detaches even an injected JSON response object', async () => {
    const f = await fixture();
    const source = book();
    f.respondWith(() => ({ ok: true, json: async () => source }));
    const data = await f.host.readBook('Book');
    data.extensions.vendor.enabled = false;
    assert.equal(source.extensions.vendor.enabled, true);
});

test('HTTP read failures include operation, book name and status', async () => {
    const f = await fixture();
    f.respondWith(() => new Response('Forbidden', { status: 403 }));
    await assert.rejects(f.host.readBook('Private Book'), /read.*Private Book.*403/i);
    assert.deepEqual(f.calls.map(([url]) => url), ['/api/worldinfo/list', '/api/worldinfo/get']);
});

test('missing book rejects before ST can return its HTTP 200 empty-book dummy', async () => {
    const f = await fixture();
    f.context.getWorldInfoNames = () => ['Book'];
    f.disk = { entries: {} };
    f.listWith(() => Response.json([]));
    await assert.rejects(f.host.readBook('Book'), /read.*Book.*(not found|does not exist|missing)/i);
    assert.deepEqual(f.calls.map(([url]) => url), ['/api/worldinfo/list']);
});

test('existence uses fresh file_id values, not display names or stale context names', async () => {
    const f = await fixture();
    f.context.getWorldInfoNames = () => [];
    f.listWith(() => Response.json([{ file_id: 'Book', name: 'Display Title' }]));
    await f.host.assertBookExists('Book');
    await assert.rejects(f.host.assertBookExists('Display Title'), /not found|does not exist|missing/i);
    f.listWith(() => Response.json([]));
    await assert.rejects(f.host.assertBookExists('Book'), /not found|does not exist|missing/i);
    for (const [url, options] of f.calls) {
        assert.equal(url, '/api/worldinfo/list');
        assert.equal(options.method, 'POST');
        assert.equal(options.cache, 'no-store');
        assert.deepEqual(JSON.parse(options.body), {});
        assert.equal(options.headers['X-CSRF-Token'], 'test-token');
    }
});

test('failed and malformed existence listings fail closed without fetching book contents', async () => {
    const f = await fixture();
    f.listWith(() => new Response('Failure', { status: 500 }));
    await assert.rejects(f.host.readBook('Book'), /read.*Book.*500/i);
    f.listWith(() => { throw new Error('offline'); });
    await assert.rejects(f.host.readBook('Book'), /read.*Book.*offline/i);
    f.listWith(() => new Response('not JSON'));
    await assert.rejects(f.host.readBook('Book'), /read.*Book/i);
    for (const data of [{}, null, [{ name: 'Book' }], [null], [{ file_id: 42 }]]) {
        f.listWith(() => Response.json(data));
        await assert.rejects(f.host.readBook('Book'), /read.*Book.*(malformed|list)/i);
    }
    assert.ok(f.calls.every(([url]) => url === '/api/worldinfo/list'));
});

test('assertBookExists rejects invalid names before fetching', async () => {
    const f = await fixture();
    await assert.rejects(f.host.assertBookExists('../Book'), /name/i);
    assert.deepEqual(f.calls, []);
});

test('generation status delegates to the live injected ST script module', async () => {
    let generating = false;
    const scriptModule = { isGenerating: () => generating };
    const host = await createHost(() => ({}), { worldInfoModule: {}, scriptModule });
    assert.equal(host.isGenerating(), false);
    generating = true;
    assert.equal(host.isGenerating(), true);
    generating = false;
    assert.equal(host.isGenerating(), false);
});

test('injected world info uses safe node generation fallback unless script module supplied', async () => {
    const f = await fixture();
    assert.equal(f.host.isGenerating(), false);
    const host = await createHost(() => ({}), { worldInfoModule: {}, scriptModule: {} });
    assert.throws(() => host.isGenerating(), /isGenerating.*unavailable/i);
});

test('network and invalid JSON errors retain operation and book context', async () => {
    const f = await fixture();
    f.respondWith(() => { throw new Error('offline'); });
    await assert.rejects(f.host.readBook('Book'), /read.*Book.*offline/i);
    f.respondWith(() => new Response('not json'));
    await assert.rejects(f.host.readBook('Book'), /read.*Book/i);
});

test('malformed documents and entries are rejected on reads and writes', async () => {
    const f = await fixture();
    const invalid = [null, [], {}, { entries: null }, { entries: [] },
        { entries: { 0: null } }, { entries: { 0: [] } },
        { entries: { 0: { content: 123 } } }, { entries: { 0: {} } },
        { entries: { 0: { content: 'text', key: 'not an array' } } },
        { entries: { 0: { content: 'text', keysecondary: [42] } } }];
    for (const data of invalid) {
        f.disk = data;
        await assert.rejects(f.host.readBook('Broken Book'), /read.*Broken Book.*(entries|entry|document|book|content|key)/i);
        const count = f.calls.length;
        await assert.rejects(f.host.writeBook('Broken Book', data), /write.*Broken Book/i);
        assert.equal(f.calls.length, count, 'invalid writes never reach persistence');
    }
    f.disk = { entries: {} };
    assert.deepEqual(await f.host.readBook('Empty Book'), { entries: {} });
});

test('failed persistence leaves cache untouched and emits no success event', async () => {
    const f = await fixture();
    const previous = book('Previous');
    f.cache.set('Book', previous);
    f.respondWith(() => new Response('Disk full', { status: 507 }));
    await assert.rejects(f.host.writeBook('Book', book('Unsaved')), /write.*Book.*507/i);
    assert.strictEqual(f.cache.get('Book'), previous);
    assert.deepEqual(f.events, []);
    assert.equal(f.calls[0][0], '/api/worldinfo/edit');
});

test('network write failure does not publish unpersisted data', async () => {
    const f = await fixture();
    f.respondWith(() => { throw new Error('connection lost'); });
    await assert.rejects(f.host.writeBook('Book', book()), /write.*Book.*connection lost/i);
    assert.equal(f.cache.has('Book'), false);
    assert.deepEqual(f.events, []);
});

test('successful write persists all fields, then synchronizes cache and awaits ST event', async () => {
    const f = await fixture();
    const data = book('New');
    let emitted = false;
    f.context.eventSource.emit = async (type, name, payload) => {
        assert.equal(type, 'worldinfo_updated');
        assert.equal(name, 'Book');
        assert.deepEqual(f.disk, data);
        assert.deepEqual(f.cache.get(name), data);
        assert.deepEqual(payload, data);
        payload.entries[0].content = 'listener mutation';
        await Promise.resolve();
        emitted = true;
    };
    assert.deepEqual(await f.host.writeBook('Book', data), { persisted: true });
    assert.equal(emitted, true);
    data.extensions.vendor.enabled = false;
    assert.equal(f.cache.get('Book').extensions.vendor.enabled, true);
    assert.equal(f.cache.get('Book').entries[0].content, 'New');
    assert.equal(f.disk.entries[0].content, 'New');
    assert.equal(f.calls[0][1].headers['X-CSRF-Token'], 'test-token');
});

test('write snapshots its input before asynchronous persistence', async () => {
    const f = await fixture();
    let complete;
    f.respondWith(() => new Promise(resolve => { complete = resolve; }));
    const data = book('Snapshot');
    const writing = f.host.writeBook('Book', data);
    data.entries[0].content = 'Changed while saving';
    complete(new Response('', { status: 200 }));
    await writing;
    assert.equal(f.cache.get('Book').entries[0].content, 'Snapshot');
    assert.equal(f.events[0][2].entries[0].content, 'Snapshot');
});

test('missing synchronization APIs fail before persistence', async () => {
    const f = await fixture();
    delete f.context.eventSource;
    await assert.rejects(f.host.writeBook('Book', book()), /event|synchron/i);
    assert.deepEqual(f.calls, []);
});

test('event failure returns an authoritative save result with a warning, not a retryable rejection', async () => {
    const f = await fixture();
    f.context.eventSource.emit = async () => { throw new Error('listener failed'); };
    const result = await f.host.writeBook('Book', book('Saved'));
    assert.equal(result.persisted, true);
    assert.match(result.warning, /Book.*persisted.*listener failed/i);
    assert.equal(f.disk.entries[0].content, 'Saved');
    assert.equal(f.cache.get('Book').entries[0].content, 'Saved');
    assert.equal(f.calls.length, 1);
});

test('cache failure after successful persistence also returns a warning', async () => {
    const f = await fixture();
    f.cache.set = () => { throw new Error('cache unavailable'); };
    const result = await f.host.writeBook('Book', book('Saved'));
    assert.equal(result.persisted, true);
    assert.match(result.warning, /persisted.*cache unavailable/i);
    assert.equal(f.disk.entries[0].content, 'Saved');
});

test('createEntry uses the ST factory on the caller document without persisting', async () => {
    const f = await fixture();
    const data = book();
    const entry = f.host.createEntry('Book', data);
    assert.strictEqual(data.entries[1], entry);
    assert.equal(entry.customDefault, true);
    assert.deepEqual(data.entries[0], book().entries[0]);
    assert.deepEqual(f.calls.map(call => call[0]), ['create']);
    assert.strictEqual(f.calls[0][2], data);
    f.worldInfoModule.createWorldInfoEntry = () => undefined;
    assert.throws(() => f.host.createEntry('Book', data), /create.*Book/i);
});

test('generation uses the object API and disables name trimming', async () => {
    const f = await fixture();
    const options = { prompt: 'User prompt', systemPrompt: 'System prompt', responseLength: 321 };
    assert.equal(await f.host.generate(options), 'Alice: response');
    assert.deepEqual(f.calls, [['generate', { ...options, trimNames: false }]]);
    f.context.generateRaw = async () => { throw new Error('provider offline'); };
    await assert.rejects(f.host.generate(options), /generat.*provider offline/i);
});

test('refresh hooks use current ST context APIs and preserve editor selection', async () => {
    const f = await fixture();
    assert.deepEqual(await f.host.refreshBooks(), ['Refreshed Book']);
    await f.host.refreshEditor('Refreshed Book');
    assert.deepEqual(f.calls, [['editor', 'Refreshed Book', false]]);
    f.context.updateWorldInfoList = async () => { throw new Error('refresh failed'); };
    await assert.rejects(f.host.refreshBooks(), /refresh.*failed/i);
});

test('explicit editor opening selects the requested book; default refresh does not', async () => {
    const f = await fixture();
    await f.host.refreshEditor('Other Book', { open: true });
    await f.host.refreshEditor('Other Book', { open: false });
    await f.host.refreshEditor('Other Book', {});
    assert.deepEqual(f.calls, [
        ['editor', 'Other Book', true],
        ['editor', 'Other Book', false],
        ['editor', 'Other Book', false],
    ]);
});

test('default context provider is lazy and reads SillyTavern.getContext', async () => {
    const previous = globalThis.SillyTavern;
    try {
        const context = { getWorldInfoNames: () => ['Default'] };
        globalThis.SillyTavern = { getContext: () => context };
        const host = await createHost(undefined, { worldInfoModule: {} });
        assert.strictEqual(host.getContext(), context);
        assert.deepEqual(host.listBooks(), ['Default']);
    } finally {
        if (previous === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previous;
    }
});

async function metadataFixture() {
    const f = await fixture();
    let saved = { version: 3, proposals: [], history: [], count: 0 };
    let saves = 0;
    Object.assign(f.context, {
        chatId: 'chat-a',
        getCurrentChatId: () => f.context.chatId,
        chatMetadata: { dynamicLore: { ...structuredClone(saved), count: 1 }, unrelated: 'keep' },
        saveMetadata: async function () {
            saves++;
            saved = structuredClone(this.chatMetadata.dynamicLore);
        },
    });
    f.context.characters[0].avatar = 'Mira.png';
    f.respondWith(() => Response.json([{ chat_metadata: { dynamicLore: saved, unrelated: 'server' } }]));
    return { f, get saved() { return saved; }, set saved(value) { saved = value; }, get saves() { return saves; } };
}

test('metadata save verifies fresh character-chat readback without direct chat writes', async () => {
    const { f } = await metadataFixture();
    assert.deepEqual(await f.host.persistMetadata(), { persisted: true });
    assert.equal(f.calls.length, 1);
    const [url, options] = f.calls[0];
    assert.equal(url, '/api/chats/get');
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['X-CSRF-Token'], 'test-token');
    assert.deepEqual(JSON.parse(options.body), { file_name: 'chat-a', avatar_url: 'Mira.png' });
    assert.equal(f.context.chatMetadata.unrelated, 'keep');
});

test('swallowed ST save HTTP failure is detected by unchanged metadata readback', async () => {
    const { f } = await metadataFixture();
    f.context.saveMetadata = async () => { await Promise.resolve(new Response('Disk full', { status: 507 })); };
    await assert.rejects(f.host.persistMetadata(), /metadata.*not saved.*chat-a/i);
    assert.equal(f.calls.length, 1);
});

test('metadata equality ignores object key order but retains array order', async () => {
    const { f } = await metadataFixture();
    f.context.chatMetadata.dynamicLore = { version: 3, history: [{ a: 1, b: 2 }], proposals: ['a', 'b'] };
    f.context.saveMetadata = async () => {};
    f.respondWith(() => Response.json([{ chat_metadata: { dynamicLore: {
        proposals: ['a', 'b'], history: [{ b: 2, a: 1 }], version: 3,
    } } }]));
    assert.deepEqual(await f.host.persistMetadata(), { persisted: true });
    f.respondWith(() => Response.json([{ chat_metadata: { dynamicLore: {
        proposals: ['b', 'a'], history: [{ b: 2, a: 1 }], version: 3,
    } } }]));
    await assert.rejects(f.host.persistMetadata(), /metadata.*not saved/i);
});

test('metadata save can verify a newer same-chat snapshot changed while saving', async () => {
    const { f } = await metadataFixture();
    const original = f.context;
    f.context.saveMetadata = async () => {
        f.context = { ...original, chatMetadata: { dynamicLore: { ...original.chatMetadata.dynamicLore, count: 2 } } };
    };
    f.respondWith(() => Response.json([{ chat_metadata: structuredClone(f.context.chatMetadata) }]));
    assert.deepEqual(await f.host.persistMetadata(original), { persisted: true });
});

test('metadata save also accepts the original detached snapshot when memory changed during save', async () => {
    const { f } = await metadataFixture();
    const expected = structuredClone(f.context.chatMetadata.dynamicLore);
    f.context.saveMetadata = async () => { f.context.chatMetadata.dynamicLore.count = 2; };
    f.respondWith(() => Response.json([{ chat_metadata: { dynamicLore: expected } }]));
    assert.deepEqual(await f.host.persistMetadata(), { persisted: true });
});

test('group metadata uses the actual chat id and ignores active speaker changes', async () => {
    const { f } = await metadataFixture();
    Object.assign(f.context, { groupId: 'group-id', chatId: 'group-chat-file', characterId: undefined });
    const captured = f.context;
    f.context = { ...captured, characterId: 0 };
    assert.deepEqual(await f.host.persistMetadata(captured), { persisted: true });
    assert.equal(f.calls[0][0], '/api/chats/group/get');
    assert.deepEqual(JSON.parse(f.calls[0][1].body), { id: 'group-chat-file' });
});

test('metadata identity supports contexts with only getCurrentChatId', async () => {
    const { f } = await metadataFixture();
    delete f.context.chatId;
    f.context.getCurrentChatId = () => 'legacy-chat';
    assert.deepEqual(await f.host.persistMetadata(), { persisted: true });
    assert.equal(JSON.parse(f.calls[0][1].body).file_name, 'legacy-chat');
});

test('switching chats before metadata save refuses the old context despite its live getter', async () => {
    const m = await metadataFixture();
    const original = m.f.context;
    m.f.context = { ...original, chatId: 'chat-b', chatMetadata: {} };
    assert.equal(original.getCurrentChatId(), 'chat-b');
    await assert.rejects(m.f.host.persistMetadata(original), /metadata.*not saved.*chat.*changed/i);
    assert.equal(m.saves, 0);
    assert.deepEqual(m.f.calls, []);
});

test('same chat filename on another character is a different metadata target', async () => {
    const m = await metadataFixture();
    const original = m.f.context;
    m.f.context = { ...original, characters: [{ avatar: 'Other.png' }] };
    await assert.rejects(m.f.host.persistMetadata(original), /chat.*changed/i);
    assert.equal(m.saves, 0);
    assert.deepEqual(m.f.calls, []);
});

test('a getter-only old context cannot borrow the new chat identity', async () => {
    const m = await metadataFixture();
    const original = m.f.context;
    delete original.chatId;
    m.f.context = { ...original, chatId: 'chat-b', chatMetadata: { dynamicLore: { count: 8 } } };
    await assert.rejects(m.f.host.persistMetadata(original), /chat.*changed/i);
    assert.equal(m.saves, 0);
    assert.deepEqual(m.f.calls, []);
});

test('metadata readback stays scoped to original chat after switching during save', async () => {
    const { f } = await metadataFixture();
    const original = f.context;
    const expected = structuredClone(original.chatMetadata.dynamicLore);
    f.context.saveMetadata = async () => {
        await Promise.resolve();
        f.context = { ...original, chatId: 'chat-b', chatMetadata: { dynamicLore: { count: 900 } } };
    };
    f.respondWith(() => Response.json([{ chat_metadata: { dynamicLore: expected } }]));
    assert.deepEqual(await f.host.persistMetadata(original), { persisted: true });
    assert.deepEqual(JSON.parse(f.calls[0][1].body), { file_name: 'chat-a', avatar_url: 'Mira.png' });
});

test('a switched chat snapshot must never satisfy original metadata verification', async () => {
    const { f } = await metadataFixture();
    const original = f.context;
    const other = { version: 3, count: 900 };
    f.context.saveMetadata = async () => {
        f.context = { ...original, chatId: 'chat-b', chatMetadata: { dynamicLore: other } };
    };
    f.respondWith(() => Response.json([{ chat_metadata: { dynamicLore: other } }]));
    await assert.rejects(f.host.persistMetadata(original), /metadata.*not saved.*chat-a/i);
});

test('metadata falls back to saveChat and detects unavailable save capability', async () => {
    const m = await metadataFixture();
    m.f.context.saveChat = m.f.context.saveMetadata;
    delete m.f.context.saveMetadata;
    assert.deepEqual(await m.f.host.persistMetadata(), { persisted: true });
    assert.equal(m.saves, 1);
    delete m.f.context.saveChat;
    const reads = m.f.calls.length;
    await assert.rejects(m.f.host.persistMetadata(), /saveChat.*unavailable/i);
    assert.equal(m.f.calls.length, reads);
});

test('missing identity or dynamicLore metadata refuses save before side effects', async () => {
    const m = await metadataFixture();
    const original = m.f.context;
    for (const patch of [
        { chatId: '', getCurrentChatId: () => '' },
        { characters: [] },
        { chatMetadata: {} },
    ]) {
        m.f.context = { ...original, ...patch };
        await assert.rejects(m.f.host.persistMetadata(), /metadata.*not saved/i);
    }
    assert.equal(m.saves, 0);
    assert.deepEqual(m.f.calls, []);
});

test('malformed or missing chat headers cannot confirm metadata persistence', async () => {
    const { f } = await metadataFixture();
    for (const data of [{}, [], null, [{}], [{ chat_metadata: {} }],
        [{ mes: 'message' }, { chat_metadata: structuredClone(f.context.chatMetadata) }]]) {
        f.respondWith(() => Response.json(data));
        await assert.rejects(f.host.persistMetadata(), /metadata.*not saved/i);
    }
});

test('metadata readback reports HTTP and JSON failures with the originating chat', async () => {
    const { f } = await metadataFixture();
    f.respondWith(() => new Response('Forbidden', { status: 403 }));
    await assert.rejects(f.host.persistMetadata(), /metadata.*chat-a.*403/i);
    f.respondWith(() => new Response('not JSON'));
    await assert.rejects(f.host.persistMetadata(), /metadata.*chat-a/i);
});

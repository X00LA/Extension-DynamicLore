import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, chatKey } from '../src/runtime.js';

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

function fixture() {
    const contexts = new Map();
    const sharedSettings = {};
    const make = id => ({
        chatId: id, characterId: 0, characters: [{ avatar: 'Mira.png' }],
        chatMetadata: {}, extensionSettings: sharedSettings,
        chat: [{ name: 'You', is_user: true, mes: 'We arrived in Haven.' }, { name: 'Mira', mes: 'Haven has two moons.' }],
        saveSettingsDebounced() {}, async saveMetadata() {},
    });
    contexts.set('a', make('a'));
    let context = contexts.get('a');
    const books = { Lore: { entries: {} } };
    let generated = 0;
    const host = {
        getContext: () => context,
        listBooks: () => Object.keys(books), resolveBook: () => 'Lore',
        readBook: async name => structuredClone(books[name]),
        writeBook: async (name, data) => { books[name] = structuredClone(data); },
        createEntry: (_name, data) => {
            let uid = 0;
            while (data.entries[uid]) uid++;
            return (data.entries[uid] = { uid, key: [], content: '', comment: '', order: 100, probability: 100 });
        },
        generate: async () => { generated++; return JSON.stringify({ entries: [{ name: 'Haven', content: 'Haven has two moons.', keywords: ['Haven'], type: 'location', confidence: .95 }] }); },
        refreshBooks: async () => {}, refreshEditor: async () => {},
    };
    const runtime = createRuntime(host);
    return { runtime, host, books, get generated() { return generated; }, context: () => context,
        switchChat(id) { if (!contexts.has(id)) contexts.set(id, make(id)); context = contexts.get(id); runtime.onChatChanged(); },
    };
}

test('analysis persists proposals in the originating chat and acceptance really writes', async () => {
    const f = fixture();
    await f.runtime.analyze();
    const [p] = f.runtime.getState().proposals;
    assert.equal(p.name, 'Haven');
    assert.equal(p.bookName, 'Lore');
    await f.runtime.accept(p.id);
    assert.equal(f.books.Lore.entries[0].content, 'Haven has two moons.');
    assert.equal(f.runtime.getState().proposals[0].status, 'accepted');
    const reloaded = createRuntime(f.host);
    assert.equal(reloaded.getState().history.length, 1);
});

test('save failures leave the card pending and retryable', async () => {
    const f = fixture();
    await f.runtime.analyze();
    const p = f.runtime.getState().proposals[0];
    const write = f.host.writeBook;
    f.host.writeBook = async () => { throw new Error('disk full'); };
    await assert.rejects(f.runtime.accept(p.id), /disk full/);
    assert.equal(f.runtime.getState().proposals[0].status, 'pending');
    assert.equal(f.runtime.getState().history.length, 0);
    f.host.writeBook = write;
    await f.runtime.accept(p.id);
    assert.equal(Object.keys(f.books.Lore.entries).length, 1);
});

test('a switched chat discards in-flight analysis', async () => {
    const f = fixture();
    const d = deferred();
    f.host.generate = () => d.promise;
    const pending = f.runtime.analyze();
    await new Promise(r => setImmediate(r));
    f.switchChat('b');
    d.resolve('{"entries":[{"name":"Secret","content":"Old chat only","keywords":["Secret"]}]}');
    await pending;
    assert.equal(f.runtime.getState().proposals.length, 0);
    f.switchChat('a');
    assert.equal(f.runtime.getState().proposals.length, 0);
});

test('concurrent accept clicks cannot create duplicate entries', async () => {
    const f = fixture();
    await f.runtime.analyze();
    const id = f.runtime.getState().proposals[0].id;
    await Promise.allSettled([f.runtime.accept(id), f.runtime.accept(id)]);
    assert.equal(Object.keys(f.books.Lore.entries).length, 1);
    assert.equal(f.runtime.getState().history.length, 1);
});

test('undo preserves other entries and refuses to overwrite a later manual edit', async () => {
    const f = fixture();
    await f.runtime.analyze();
    await f.runtime.accept(f.runtime.getState().proposals[0].id);
    const h = f.runtime.getState().history[0];
    f.books.Lore.entries[0].content = 'Manual edit';
    await assert.rejects(f.runtime.undo(h.id), /changed|conflict|edited/i);
    f.books.Lore.entries[0].content = 'Haven has two moons.';
    f.books.Lore.entries[8] = { uid: 8, content: 'Keep me' };
    await f.runtime.undo(h.id);
    assert.equal(f.books.Lore.entries[0], undefined);
    assert.equal(f.books.Lore.entries[8].content, 'Keep me');
});

test('auto mode honors enable/disable, deduplicates renders and triggers after generation', async () => {
    const f = fixture();
    f.runtime.updateSettings({ auto_analyze: true, analysis_interval: 1 });
    f.context().chat.push({ name: 'Mira', mes: 'New turn' });
    f.runtime.onMessage(2, 'normal');
    f.runtime.onMessage(2, 'normal');
    assert.equal(f.generated, 0);
    await f.runtime.onGenerationEnded();
    assert.equal(f.generated, 1);
    f.runtime.updateSettings({ enabled: false });
    f.context().chat.push({ name: 'Mira', mes: 'Disabled turn' });
    f.runtime.onMessage(3, 'normal');
    await f.runtime.onGenerationEnded();
    assert.equal(f.generated, 1);
});

test('auto approval accepts only qualifying suggestions', async () => {
    const f = fixture();
    f.runtime.updateSettings({ auto_approve: true, confidence_threshold: .99 });
    await f.runtime.analyze();
    assert.equal(Object.keys(f.books.Lore.entries).length, 0);
    f.runtime.updateSettings({ confidence_threshold: .9 });
    f.runtime.rejectAll();
    await f.runtime.analyze();
    assert.equal(Object.keys(f.books.Lore.entries).length, 1);
});

test('changing the selected book does not redirect pending suggestions', async () => {
    const f = fixture();
    await f.runtime.analyze();
    f.runtime.updateSettings({ target_wi_book: 'Elsewhere' });
    await f.runtime.accept(f.runtime.getState().proposals[0].id);
    assert.equal(Object.keys(f.books.Lore.entries).length, 1);
    assert.equal(f.books.Elsewhere, undefined);
});

test('cancelled output is discarded and cannot start overlapping generation', async () => {
    const f = fixture();
    const d = deferred();
    let calls = 0;
    f.host.generate = () => { calls++; return d.promise; };
    const pending = f.runtime.analyze();
    await new Promise(r => setImmediate(r));
    f.runtime.cancel();
    await f.runtime.analyze();
    assert.equal(calls, 1);
    d.resolve('{"entries":[]}');
    await pending;
    assert.equal(f.runtime.getState().busy, false);
    assert.equal(f.runtime.getState().proposals.length, 0);
});

test('group chat identity does not change with the active speaker', () => {
    const context = { chatId: 'group-chat', groupId: 'group1', characterId: 0, characters: [{ avatar: 'a.png' }, { avatar: 'b.png' }] };
    const key = chatKey(context);
    context.characterId = 1;
    assert.equal(chatKey(context), key);
});

test('manual analysis waits until foreground generation finishes', async () => {
    const f = fixture();
    f.runtime.onGenerationStarted('normal', {}, false);
    await f.runtime.analyze();
    assert.equal(f.generated, 0);
    await f.runtime.onGenerationEnded();
    await f.runtime.analyze();
    assert.equal(f.generated, 1);
});

test('editing the transcript invalidates pending suggestions', async () => {
    const f = fixture();
    await f.runtime.analyze();
    const id = f.runtime.getState().proposals[0].id;
    f.context().chat[1].mes = 'Haven never existed.';
    f.runtime.onMessagesChanged();
    await assert.rejects(f.runtime.accept(id), /pending|stale|transcript/i);
    assert.equal(Object.keys(f.books.Lore.entries).length, 0);
});

test('a successful write during a chat switch retains its receipt after reload', async () => {
    const f = fixture();
    await f.runtime.analyze();
    const beforeMetadata = structuredClone(f.context().chatMetadata);
    const id = f.runtime.getState().proposals[0].id;
    const d = deferred();
    const originalWrite = f.host.writeBook;
    f.host.writeBook = async (...args) => { await d.promise; return originalWrite(...args); };
    const accepting = f.runtime.accept(id);
    await new Promise(r => setImmediate(r));
    f.switchChat('b');
    d.resolve();
    await accepting;
    f.switchChat('a');
    f.context().chatMetadata = beforeMetadata;
    const restored = createRuntime(f.host);
    assert.equal(restored.getState().history.length, 1);
    assert.equal(restored.getState().proposals[0].status, 'accepted');
});

test('reject cannot race with a save already queued for that suggestion', async () => {
    const f = fixture();
    await f.runtime.analyze();
    const id = f.runtime.getState().proposals[0].id;
    const accepting = f.runtime.accept(id);
    assert.throws(() => f.runtime.reject(id), /save|writing|wait/i);
    await accepting;
});

test('creating a book refuses case-variant existing names', async () => {
    const f = fixture();
    await assert.rejects(f.runtime.createBook('lore'), /already exists/i);
    assert.equal(f.books.lore, undefined);
});

test('over-budget prompts fail visibly before a model request', async () => {
    const f = fixture();
    f.context().maxContext = 8192;
    f.context().getTokenCountAsync = async () => 9000;
    await assert.rejects(f.runtime.analyze(), /context|budget/i);
    assert.equal(f.generated, 0);
    assert.equal(f.runtime.getState().busy, false);
});

test('raising the approval threshold during generation takes effect before saving', async () => {
    const f = fixture();
    f.runtime.updateSettings({ auto_approve: true, confidence_threshold: .5 });
    const d = deferred();
    f.host.generate = () => d.promise;
    const pending = f.runtime.analyze();
    await new Promise(r => setImmediate(r));
    f.runtime.updateSettings({ confidence_threshold: .99 });
    d.resolve('{"entries":[{"name":"Haven","content":"Haven has two moons.","keywords":["Haven"],"confidence":0.8}]}');
    await pending;
    assert.equal(Object.keys(f.books.Lore.entries).length, 0);
});

test('captured context identity uses its snapshot, not the live ST chat getter', () => {
    let activeId = 'a';
    const context = { chatId: 'a', characterId: 0, getCurrentChatId: () => activeId };
    const originalKey = chatKey(context);
    activeId = 'b';
    assert.equal(chatKey(context), originalKey);
});

test('review-state retry clears verified recovery without repeating a lorebook write', async () => {
    const f = fixture();
    await f.runtime.analyze();
    let fail = true;
    let writes = 0;
    const original = f.host.writeBook;
    f.host.writeBook = async (...args) => { writes++; return original(...args); };
    f.host.persistMetadata = async () => { if (fail) throw new Error('metadata disk error'); };
    await f.runtime.accept(f.runtime.getState().proposals[0].id);
    assert.equal(f.runtime.getSettings().recovery.length, 1);
    fail = false;
    await f.runtime.retryPersistence();
    assert.equal(f.runtime.getSettings().recovery.length, 0);
    assert.equal(writes, 1);
    assert.equal(f.runtime.getState().error, '');
});

test('transcript invalidation during the acceptance read prevents saving', async () => {
    const f = fixture();
    await f.runtime.analyze();
    const d = deferred();
    const read = f.host.readBook;
    f.host.readBook = async name => { await d.promise; return read(name); };
    const accepting = f.runtime.accept(f.runtime.getState().proposals[0].id);
    await new Promise(r => setImmediate(r));
    f.runtime.onMessagesChanged();
    d.resolve();
    await assert.rejects(accepting, /pending|transcript|stale/i);
    assert.deepEqual(f.books.Lore.entries, {});
});

test('host live generation state takes precedence over command-start events', async () => {
    const f = fixture();
    f.host.isGenerating = () => false;
    f.runtime.onGenerationStarted('normal', {}, false);
    await f.runtime.analyze();
    assert.equal(f.generated, 1);
});

test('invalid recovery records cannot crash a chat or settings load', () => {
    const f = fixture();
    f.runtime.updateSettings({ recovery: [null, 1, {}, { chatKey: f.runtime.getState().chatKey, history: {} }] });
    assert.doesNotThrow(() => f.runtime.getState());
});

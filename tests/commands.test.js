import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/commands.js';

function fixture() {
    const settings = {};
    return { settings, updateSettings: patch => Object.assign(settings, patch), getState: () => ({ status: 'Ready', proposals: [], history: [] }), getSettings: () => settings, getBooks: () => ['My World Book'], refreshBooks: async () => {}, open() {}, analyze: async () => {} };
}
test('book commands preserve spaces and support the auto sentinel', async () => {
    const r = fixture();
    await runCommand(r, 'book My World Book');
    assert.equal(r.settings.target_wi_book, 'My World Book');
    await runCommand(r, 'book auto');
    assert.equal(r.settings.target_wi_book, '');
});
test('quoted book names and strict interval validation', async () => {
    const r = fixture();
    await runCommand(r, 'book "My World Book"');
    assert.equal(r.settings.target_wi_book, 'My World Book');
    await assert.rejects(runCommand(r, 'interval nope'), /1.*100/);
    await assert.rejects(runCommand(r, 'interval 2junk'), /1.*100/);
    await runCommand(r, 'interval 7');
    assert.equal(r.settings.analysis_interval, 7);
});
test('unknown commands show help instead of mutating configuration', async () => {
    const r = fixture();
    assert.match(await runCommand(r, 'nonsense'), /dynamiclore/);
    assert.deepEqual(r.settings, {});
});

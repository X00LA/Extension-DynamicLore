import test from 'node:test';
import assert from 'node:assert/strict';
import { numericSetting, keywordLines } from '../src/ui-values.js';

test('cleared or invalid numeric settings do not become zero', () => {
    for (const value of ['', ' ', 'nope', 'Infinity', '-1', '2']) assert.throws(() => numericSetting(value, { min: 0, max: 1 }));
    assert.equal(numericSetting('0', { min: 0, max: 1 }), 0);
    assert.equal(numericSetting('.95', { min: 0, max: 1 }), .95);
    assert.throws(() => numericSetting('2.5', { min: 1, max: 10, step: 1 }));
});
test('newline keyword edits preserve commas inside identity keywords', () => {
    assert.deepEqual(keywordLines('Smith, Jr.\nCaptain Smith\r\n  中文，称呼 '), ['Smith, Jr.', 'Captain Smith', '中文，称呼']);
});

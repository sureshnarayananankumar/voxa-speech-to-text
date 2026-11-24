const test = require('node:test');
const assert = require('node:assert');
const { dominantLanguage, defaultTitle } = require('../src/ws-gateway');

test('dominantLanguage: single language', () => {
  assert.strictEqual(dominantLanguage([{ text: 'hello there', language: 'en' }]), 'en');
});

test('dominantLanguage: code-mixed Hindi/English => mixed', () => {
  const segs = [
    { text: 'aaj ka plan kya hai', language: 'hi' },
    { text: 'let us meet at five', language: 'en' },
  ];
  assert.strictEqual(dominantLanguage(segs), 'mixed');
});

test('dominantLanguage: minor second language is ignored', () => {
  const segs = [
    { text: 'one two three four five six seven eight nine ten', language: 'en' },
    { text: 'haan', language: 'hi' },
  ];
  assert.strictEqual(dominantLanguage(segs), 'en');
});

test('defaultTitle truncates to 8 words', () => {
  assert.strictEqual(defaultTitle('a b c d e f g h i j'), 'a b c d e f g h…');
  assert.strictEqual(defaultTitle('short text'), 'short text');
});

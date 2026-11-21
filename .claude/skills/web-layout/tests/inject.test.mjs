import test from 'node:test';
import assert from 'node:assert/strict';
import { injectPreviewHtml } from '../scripts/lib/inject.mjs';

const OPTS = { editorOrigin: 'http://127.0.0.1:5000', runtimeToken: 'abc123' };

test('injects bootstrap first in head and runtime before body close', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body><p>Hi</p></body></html>';
  const out = injectPreviewHtml(html, OPTS);
  assert.ok(out.indexOf('window.__WEB_LAYOUT__') < out.indexOf('<title>x</title>'));
  assert.ok(out.indexOf('/__layout/runtime.js') > out.indexOf('<p>Hi</p>'));
  assert.ok(out.indexOf('/__layout/runtime.js') < out.indexOf('</body>'));
  assert.equal(out.match(/\/__layout\/runtime\.js/g).length, 1);
});

test('removes CSP and refresh meta tags', () => {
  const html = [
    '<!doctype html><html><head>',
    '<meta content="default-src \'none\'" http-equiv="Content-Security-Policy">',
    '<meta http-equiv="refresh" content="0;url=/x">',
    '</head><body></body></html>',
  ].join('');
  const out = injectPreviewHtml(html, OPTS);
  assert.equal(/content-security-policy/i.test(out), false);
  assert.equal(/http-equiv="refresh"/i.test(out), false);
});

test('works without head or body tags', () => {
  const out = injectPreviewHtml('<p>bare</p>', OPTS);
  assert.ok(out.startsWith('<script>window.__WEB_LAYOUT__'));
  assert.ok(out.endsWith('<script type="module" src="/__layout/runtime.js"></script>'));
});

test('does not inject the runtime twice', () => {
  const html = '<html><head></head><body><script type="module" src="/__layout/runtime.js"></script></body></html>';
  const out = injectPreviewHtml(html, OPTS);
  assert.equal(out.match(/\/__layout\/runtime\.js/g).length, 1);
});

test('removes CSP and refresh meta tags when a preceding attribute contains >', () => {
  const html = [
    '<!doctype html><html><head>',
    '<meta content="a>b" http-equiv="Content-Security-Policy">',
    '<meta content="a>b" http-equiv="refresh">',
    '</head><body></body></html>',
  ].join('');
  const out = injectPreviewHtml(html, OPTS);
  assert.equal(/content-security-policy/i.test(out), false);
  assert.equal(/http-equiv="refresh"/i.test(out), false);
});

test('preserves Report-Only CSP meta and content after it', () => {
  const html = '<meta http-equiv="Content-Security-Policy-Report-Only" content="x"><title>T</title></head><body><p>a"b"c"d</p><p>keep</p></body>';
  const out = injectPreviewHtml(html, OPTS);
  assert.match(out, /<meta http-equiv="Content-Security-Policy-Report-Only"/i);
  for (const fragment of ['<title>T</title>', '</head>', '<body>', '<p>a"b"c"d</p>', '<p>keep</p>']) {
    assert.ok(out.includes(fragment), fragment);
  }
});

test('preserves a refresh-extra meta and following content', () => {
  const html = '<meta http-equiv="refresh-extra" content="0;url=/x"><p>keep</p>';
  const out = injectPreviewHtml(html, OPTS);
  assert.match(out, /<meta http-equiv="refresh-extra"/i);
  assert.ok(out.includes('<p>keep</p>'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { download, atomicJSON, exists } from '../server/downloader.mjs';
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dragon-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return path.join(root, 'cards.dat');
}
test('invalid downloads preserve the last good file and fall back to another source', async (t) => {
  const target = await fixture(t);
  await writeFile(target, 'old');
  let calls = 0;
  const result = await download({
    urls: ['https://a.test/file', 'https://b.test/file'],
    target,
    attempts: 1,
    fetcher: async () => new Response(++calls === 1 ? '<html>error</html>' : 'valid'),
    validate: async (file) => {
      if ((await readFile(file, 'utf8')) !== 'valid') throw new Error('invalid content');
    },
  });
  assert.equal(await readFile(target, 'utf8'), 'valid');
  assert.equal(calls, 2);
  assert.equal(result.url, 'https://b.test/file');
  assert.equal(result.hash.length, 64);
});
test('all failed mirrors leave the installed file intact', async (t) => {
  const target = await fixture(t);
  await writeFile(target, 'working');
  await assert.rejects(
    download({
      urls: ['https://a.test/file'],
      target,
      attempts: 1,
      fetcher: async () => new Response('broken'),
      validate: () => {
        throw new Error('bad');
      },
    }),
  );
  assert.equal(await readFile(target, 'utf8'), 'working');
  assert.equal(await exists(target + '.part'), false);
});
test('resume uses If-Range only for a matching source and appends the correct range', async (t) => {
  const target = await fixture(t);
  await writeFile(target + '.part', 'abc');
  await atomicJSON(target + '.part.json', { url: 'https://a.test/file', validator: '"v1"' });
  await download({
    urls: ['https://a.test/file'],
    target,
    attempts: 1,
    fetcher: async (_, { headers }) => {
      assert.equal(headers.Range, 'bytes=3-');
      assert.equal(headers['If-Range'], '"v1"');
      return new Response('def', {
        status: 206,
        headers: { 'Content-Range': 'bytes 3-5/6', 'Content-Length': '3', ETag: '"v1"' },
      });
    },
  });
  assert.equal(await readFile(target, 'utf8'), 'abcdef');
});
test('server ignoring Range replaces rather than concatenating partial content', async (t) => {
  const target = await fixture(t);
  await writeFile(target + '.part', 'old');
  await atomicJSON(target + '.part.json', { url: 'https://a.test/file', validator: '"v1"' });
  await download({
    urls: ['https://a.test/file'],
    target,
    attempts: 1,
    fetcher: async () => new Response('new', { headers: { ETag: '"v2"' } }),
  });
  assert.equal(await readFile(target, 'utf8'), 'new');
});
test('chunked resumed transfers use Content-Range to verify the final size', async (t) => {
  const target = await fixture(t);
  await writeFile(target + '.part', 'abc');
  await atomicJSON(target + '.part.json', { url: 'https://a.test/file', validator: '"v1"' });
  await download({
    urls: ['https://a.test/file'], target, attempts: 1,
    fetcher: async () => new Response('def', { status: 206, headers: { 'Content-Range': 'bytes 3-5/6', ETag: '"v1"' } }),
  });
  assert.equal(await readFile(target, 'utf8'), 'abcdef');
});
test('conditional 304 keeps local file without downloading the payload', async (t) => {
  const target = await fixture(t);
  await writeFile(target, 'valid');
  const r = await download({
    urls: ['https://a.test/file'],
    target,
    previous: { url: 'https://a.test/file', etag: '"v1"' },
    fetcher: async (_, { headers }) => {
      assert.equal(headers['If-None-Match'], '"v1"');
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(r.unchanged, true);
  assert.equal(await readFile(target, 'utf8'), 'valid');
});
test('a network/5xx failure mixed with a 404 is retryable, not permanently missing', async (t) => {
  const target = await fixture(t);
  await assert.rejects(
    download({
      urls: ['https://a.test/file', 'https://b.test/file'],
      target,
      attempts: 1,
      fetcher: async (url) => new Response(null, { status: url.includes('a.test') ? 404 : 503 }),
    }),
    (e) => !e.missing,
  );
});

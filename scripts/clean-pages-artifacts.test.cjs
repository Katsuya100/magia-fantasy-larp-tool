'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectOldPagesArtifacts } = require('./clean-pages-artifacts.cjs');

const page = (id, created_at, extra = {}) =>
  ({ id, name: 'github-pages', created_at, expired: false, ...extra });

test('keeps the newest two pages artifacts regardless of API order', () => {
  const list = [
    page(1, '2026-10-17T00:00:00Z'),
    page(3, '2026-10-19T00:00:00Z'),
    page(2, '2026-10-18T00:00:00Z'),
    page(4, '2026-10-20T00:00:00Z'),
  ];
  assert.deepEqual(selectOldPagesArtifacts(list).map((a) => a.id), [2, 1]);
  assert.deepEqual(list.map((a) => a.id), [1, 3, 2, 4], 'original list is unchanged');
});

test('ignores unrelated and expired artifacts', () => {
  const list = [
    page(1, '2026-10-17T00:00:00Z'),
    page(2, '2026-10-18T00:00:00Z'),
    page(3, '2026-10-19T00:00:00Z', { expired: true }),
    { id: 4, name: 'unity-ci-logs', created_at: '2026-10-20T00:00:00Z' },
  ];
  assert.deepEqual(selectOldPagesArtifacts(list), []);
});

test('breaks timestamp ties by artifact ID', () => {
  const list = [page(20, '2026-10-20T00:00:00Z'),
    page(10, '2026-10-20T00:00:00Z'),
    page(30, '2026-10-20T00:00:00Z')];
  assert.deepEqual(selectOldPagesArtifacts(list).map((a) => a.id), [10]);
});

test('does not delete anything with two or fewer pages artifacts', () => {
  assert.deepEqual(selectOldPagesArtifacts([]), []);
  assert.deepEqual(selectOldPagesArtifacts([page(1, '2026-10-19T00:00:00Z')]), []);
  assert.deepEqual(selectOldPagesArtifacts([
    page(1, '2026-10-19T00:00:00Z'),
    page(2, '2026-10-20T00:00:00Z'),
  ]), []);
});

test('fails closed on invalid Pages metadata', () => {
  assert.throws(() => selectOldPagesArtifacts([
    page(1, 'bad-date'),
    page(2, '2026-10-19T00:00:00Z'),
    page(3, '2026-10-20T00:00:00Z'),
  ]), /refusing to delete/);
  assert.throws(() => selectOldPagesArtifacts(undefined), /Expected an artifact array/);
});

test('selects all old artifacts even when results exceed one API page', () => {
  const list = Array.from({ length: 205 }, (_, i) =>
    page(i + 1, new Date(Date.UTC(2026, 9, 20, 0, i)).toISOString())
  );
  const ids = selectOldPagesArtifacts(list).map((a) => a.id);
  assert.equal(ids.length, 203);
  assert.ok(!ids.includes(205));
  assert.ok(!ids.includes(204));
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseListQuery } from '../src/core/query.js';
import { SqliteStore } from '../src/storage/sqliteStore.js';

describe('sqlite list query execution', () => {
  let tempDir = '';
  let store: SqliteStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mocy-'));
    const fixture = path.resolve('fixtures/db.json');
    const dbPath = path.join(tempDir, 'db.json');
    await writeFile(dbPath, await readFile(fixture, 'utf8'), 'utf8');

    store = new SqliteStore({
      sourcePath: dbPath,
      sqlitePath: path.join(tempDir, '.mocy', 'mocy.sqlite')
    });
    await store.importFromJsonFile();
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50
    });
  });

  it('applies combined filters, sorting and page pagination in SQL', () => {
    const result = store.queryCollection(
      'posts',
      parseListQuery({
        views_gte: '10',
        _sort: 'views',
        _order: 'desc',
        _page: '1',
        _per_page: '1'
      })
    );

    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(1);
    expect(result.data.map((entry) => entry.id)).toEqual(['3']);
  });

  it('supports range and limit semantics in SQL', () => {
    const result = store.queryCollection(
      'posts',
      parseListQuery({
        _start: '1',
        _end: '3',
        _limit: '1'
      })
    );

    expect(result.total).toBe(3);
    expect(result.data.map((entry) => entry.id)).toEqual(['2']);
  });

  it('supports q search and array filters in SQL', () => {
    const filtered = store.queryCollection('posts', parseListQuery({ tags: 'tech' }));
    expect(filtered.total).toBe(2);
    expect(filtered.data.map((entry) => entry.id)).toEqual(['1', '3']);

    const searched = store.queryCollection('posts', parseListQuery({ q: 'again' }));
    expect(searched.total).toBe(1);
    expect(searched.data.map((entry) => entry.id)).toEqual(['3']);
  });
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../src/storage/sqliteStore.js';

describe('sqlite id generation', () => {
  let tempDir = '';
  let dbPath = '';
  let sqlitePath = '';
  let openedStores: SqliteStore[] = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mocy-'));
    const fixture = path.resolve('fixtures/db.json');
    dbPath = path.join(tempDir, 'db.json');
    sqlitePath = path.join(tempDir, '.mocy', 'mocy.sqlite');
    openedStores = [];
    await writeFile(dbPath, await readFile(fixture, 'utf8'), 'utf8');
  });

  afterEach(async () => {
    openedStores.forEach((store) => {
      store.close();
    });
    await rm(tempDir, { recursive: true, force: true });
  });

  it('generates safe IDs by default', async () => {
    const store = new SqliteStore({ sourcePath: dbPath, sqlitePath });
    openedStores.push(store);
    await store.importFromJsonFile();

    const created = store.create('posts', { title: 'safe-id' });
    expect(created.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('supports compatibility mode IDs', async () => {
    const store = new SqliteStore({ sourcePath: dbPath, sqlitePath, idMode: 'compat' });
    openedStores.push(store);
    await store.importFromJsonFile();

    const created = store.create('posts', { title: 'compat-id' });
    expect(created.id).toMatch(/^[0-9a-f]{4}$/);
  });

  it('retries generated IDs on collision', async () => {
    const store = new SqliteStore({ sourcePath: dbPath, sqlitePath });
    openedStores.push(store);
    await store.importFromJsonFile();

    const internal = store as unknown as { generateCandidateId: () => string };
    let calls = 0;
    internal.generateCandidateId = () => {
      calls += 1;
      return calls === 1 ? '1' : '1111111111111111';
    };

    const created = store.create('posts', { title: 'retry-id' });
    expect(created.id).toBe('1111111111111111');
  });

  it('throws on client-provided ID collisions', async () => {
    const store = new SqliteStore({ sourcePath: dbPath, sqlitePath });
    openedStores.push(store);
    await store.importFromJsonFile();

    expect(() => store.create('posts', { id: '1', title: 'duplicate' })).toThrow(
      'Duplicate id "1" for resource "posts"'
    );
  });
});

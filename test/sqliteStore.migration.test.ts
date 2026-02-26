import Database from 'better-sqlite3';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../src/storage/sqliteStore.js';

describe('sqlite schema migration', () => {
  let tempDir = '';
  let dbPath = '';
  let sqlitePath = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mocy-'));
    dbPath = path.join(tempDir, 'db.json');
    sqlitePath = path.join(tempDir, '.mocy', 'mocy.sqlite');
    await writeFile(dbPath, '{}\n', 'utf8');
    await mkdir(path.dirname(sqlitePath), { recursive: true });

    const legacy = new Database(sqlitePath);
    legacy.exec(`
      CREATE TABLE records (
        resource TEXT NOT NULL,
        id TEXT NOT NULL,
        id_type TEXT NOT NULL CHECK(id_type IN ('number', 'string')),
        data TEXT NOT NULL,
        PRIMARY KEY(resource, id)
      );
      CREATE TABLE singular (
        resource TEXT NOT NULL PRIMARY KEY,
        data TEXT NOT NULL
      );
      INSERT INTO records(resource, id, id_type, data)
      VALUES ('posts', '1', 'string', '{"id":"1","title":"legacy"}');
    `);
    legacy.close();
  });

  afterEach(async () => {
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50
    });
  });

  it('migrates legacy id_type schema and preserves data', () => {
    const store = new SqliteStore({
      sourcePath: dbPath,
      sqlitePath
    });

    expect(store.get('posts', '1')).toEqual({ id: '1', title: 'legacy' });
    const created = store.create('posts', { title: 'new' });
    expect(created.id).toMatch(/^[0-9a-f]{16}$/);
    store.close();

    const db = new Database(sqlitePath, { readonly: true });
    const columns = db.prepare('PRAGMA table_info(records);').all() as Array<{ name: string }>;
    db.close();

    expect(columns.map((entry) => entry.name)).toEqual(['resource', 'id', 'data']);
  });
});

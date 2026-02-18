import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { SqliteStore } from '../src/storage/sqliteStore.js';

describe('http integration', () => {
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
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns collection list', async () => {
    const app = createApp(store);
    const res = await request(app).get('/posts').expect(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toMatchObject({ id: '1', title: 'hello' });
  });

  it('supports filtering and sorting', async () => {
    const app = createApp(store);
    const res = await request(app)
      .get('/posts')
      .query({ views_gte: '10', _sort: 'views', _order: 'desc' })
      .expect(200);

    expect(res.body.map((entry: { id: string }) => entry.id)).toEqual(['3', '1']);
  });

  it('supports pagination response', async () => {
    const app = createApp(store);
    const res = await request(app).get('/posts').query({ _page: 1, _per_page: 2 }).expect(200);

    expect(res.body).toMatchObject({
      first: 1,
      prev: null,
      next: 2,
      last: 2,
      pages: 2,
      items: 3
    });
    expect(res.body.data).toHaveLength(2);
  });

  it('creates, updates and deletes record', async () => {
    const app = createApp(store);

    const created = await request(app).post('/posts').send({ title: 'new', views: 1 }).expect(201);
    const id = created.body.id as string;

    await request(app).patch(`/posts/${id}`).send({ views: 2 }).expect(200);
    const updated = await request(app).get(`/posts/${id}`).expect(200);
    expect(updated.body.views).toBe(2);

    await request(app).delete(`/posts/${id}`).expect(200);
    await request(app).get(`/posts/${id}`).expect(404);
  });

  it('handles singular resources', async () => {
    const app = createApp(store);

    const getRes = await request(app).get('/profile').expect(200);
    expect(getRes.body).toEqual({ name: 'typicode' });

    const patched = await request(app).patch('/profile').send({ role: 'admin' }).expect(200);
    expect(patched.body).toEqual({ name: 'typicode', role: 'admin' });
  });
});

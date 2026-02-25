import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, RequestLogEntry } from '../src/http/app.js';
import { SqliteStore } from '../src/storage/sqliteStore.js';

describe('http integration', () => {
  let tempDir = '';
  let dbPath = '';
  let store: SqliteStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mocy-'));
    const fixture = path.resolve('fixtures/db.json');
    dbPath = path.join(tempDir, 'db.json');
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

  it('emits request log entries when logger is enabled', async () => {
    const logs: RequestLogEntry[] = [];
    const app = createApp(store, {
      requestLogger: (entry) => {
        logs.push(entry);
      }
    });

    await request(app).get('/posts?_page=1').expect(200);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      method: 'GET',
      path: '/posts?_page=1',
      status: 200
    });
    expect(logs[0]?.durationMs ?? -1).toBeGreaterThanOrEqual(0);
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

  it('preserves API-created records on merge import mode', async () => {
    const app = createApp(store);
    const created = await request(app).post('/posts').send({ title: 'api-created', views: 99 }).expect(201);
    const createdId = created.body.id as string;

    const snapshot = JSON.parse(await readFile(dbPath, 'utf8')) as {
      posts: Array<{ id: number; title: string; views: number; tags: string[] }>;
    };
    snapshot.posts = snapshot.posts.map((entry) =>
      entry.id === 1 ? { ...entry, title: 'hello from file update' } : entry
    );
    await writeFile(dbPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    await store.importFromJsonFile('merge');

    const existing = await request(app).get(`/posts/${createdId}`).expect(200);
    expect(existing.body).toMatchObject({ id: createdId, title: 'api-created', views: 99 });

    const fileUpdated = await request(app).get('/posts/1').expect(200);
    expect(fileUpdated.body.title).toBe('hello from file update');
  });

  it('allows explicit destructive replace import mode', async () => {
    const app = createApp(store);
    const created = await request(app).post('/posts').send({ title: 'ephemeral', views: 1 }).expect(201);
    const createdId = created.body.id as string;

    await store.importFromJsonFile('replace');

    await request(app).get(`/posts/${createdId}`).expect(404);
  });

  it('handles singular resources', async () => {
    const app = createApp(store);

    const getRes = await request(app).get('/profile').expect(200);
    expect(getRes.body).toEqual({ name: 'typicode' });

    const patched = await request(app).patch('/profile').send({ role: 'admin' }).expect(200);
    expect(patched.body).toEqual({ name: 'typicode', role: 'admin' });
  });

  it('returns deleted singular object on delete', async () => {
    const app = createApp(store);

    const removed = await request(app).delete('/profile').expect(200);
    expect(removed.body).toEqual({ name: 'typicode' });

    await request(app).delete('/profile').expect(404);
  });
});

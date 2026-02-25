import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Low, Memory } from 'lowdb';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp as createJsonServerApp } from 'json-server/lib/app.js';
import { DbSchema } from '../src/core/types.js';
import { createApp as createMocyApp } from '../src/http/app.js';
import { SqliteStore } from '../src/storage/sqliteStore.js';

interface Case {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
}

const cases: Case[] = [
  { method: 'get', path: '/posts' },
  { method: 'get', path: '/posts', query: { views_gte: 10, _sort: 'views', _page: 1, _per_page: 2 } },
  { method: 'get', path: '/posts/1' },
  { method: 'patch', path: '/posts/2', body: { views: 7 } },
  { method: 'post', path: '/comments', body: { body: 'third', postId: 1 } },
  { method: 'delete', path: '/comments/1' }
];

describe('compatibility harness', () => {
  it('matches core json-server behavior for common workflows', async () => {
    const fixturePath = path.resolve('fixtures/db.json');
    const fixtureRaw = await readFile(fixturePath, 'utf8');
    const fixture = JSON.parse(fixtureRaw) as DbSchema;

    const low = new Low<DbSchema>(new Memory<DbSchema>(), fixture);
    await low.read();
    low.data = JSON.parse(JSON.stringify(fixture)) as DbSchema;

    const jsonServerApp = createJsonServerApp(low);

    const tempSqlite = path.resolve('.mocy', `compat-${Date.now()}.sqlite`);
    const store = new SqliteStore({
      sourcePath: fixturePath,
      sqlitePath: tempSqlite,
      idMode: 'compat'
    });
    store.importData(JSON.parse(JSON.stringify(fixture)) as DbSchema);
    const mocyApp = createMocyApp(store);

    for (const entry of cases) {
      const [left, right] = await Promise.all([
        execute(jsonServerApp.handler.bind(jsonServerApp), entry),
        execute(mocyApp, entry)
      ]);

      expect(right.status).toBe(left.status);
      if (entry.method === 'post') {
        expect(right.body).toMatchObject({
          body: (left.body as { body: string }).body,
          postId: (left.body as { postId: number }).postId
        });
        expect((right.body as { id: string }).id).toMatch(/^[0-9a-f]{4}$/);
      } else {
        expect(right.body).toEqual(left.body);
      }
    }

    store.close();
  });
});

async function execute(
  app: Parameters<typeof request>[0],
  scenario: Case
): Promise<{ status: number; body: unknown; headers: Record<string, unknown> }> {
  let req = request(app)[scenario.method](scenario.path);

  if (scenario.query) {
    req = req.query(scenario.query);
  }

  if (scenario.body) {
    req = req.send(scenario.body);
  }

  const res = await req;

  return {
    status: res.status,
    body: res.body,
    headers: res.headers as Record<string, unknown>
  };
}

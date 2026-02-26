import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from 'mocy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/server.js';

describe('mocy-mcp server', () => {
  let tempDir = '';
  let store!: SqliteStore;
  let client!: Client;
  let server!: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mocy-mcp-'));
    const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/db.json');
    const dbPath = path.join(tempDir, 'db.json');
    await writeFile(dbPath, await readFile(fixturePath, 'utf8'), 'utf8');

    store = new SqliteStore({
      sourcePath: dbPath,
      sqlitePath: path.join(tempDir, '.mocy', 'mocy.sqlite')
    });
    await store.importFromJsonFile();

    server = createMcpServer(store, { name: 'mocy-mcp-test', version: '0.0.0-test' });
    client = new Client({ name: 'mocy-mcp-test-client', version: '0.0.0-test' }, { capabilities: {} });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    store.close();
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50
    });
  });

  it('exposes expected tools', async () => {
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'mocy_list_resources',
        'mocy_get_dataset_meta',
        'mocy_get_resource_item',
        'mocy_get_singular_resource',
        'mocy_query_collection'
      ])
    );
  });

  it('serves read-only resource operations', async () => {
    const listResult = await client.callTool({ name: 'mocy_list_resources', arguments: {} });
    const listPayload = listResult.structuredContent as { resources?: string[] };
    expect(listPayload.resources).toEqual(expect.arrayContaining(['posts', 'comments', 'profile']));

    const queryResult = await client.callTool({
      name: 'mocy_query_collection',
      arguments: {
        resource: 'posts',
        query: {
          views_gte: '10',
          _sort: 'views',
          _order: 'desc'
        }
      }
    });
    const queryPayload = queryResult.structuredContent as {
      data?: Array<{ id: string }>;
      total?: number;
    };
    expect(queryPayload.total).toBe(2);
    expect(queryPayload.data?.map((entry) => entry.id)).toEqual(['3', '1']);

    const singularResult = await client.callTool({
      name: 'mocy_get_singular_resource',
      arguments: {
        resource: 'profile'
      }
    });
    const singularPayload = singularResult.structuredContent as { value?: { name?: string } };
    expect(singularPayload.value?.name).toBe('typicode');
  });
});

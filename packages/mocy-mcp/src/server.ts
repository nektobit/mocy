import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import chokidar from 'chokidar';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseListQuery, SqliteStore } from 'mocy';
import { z } from 'zod';
import type { FSWatcher } from 'chokidar';

const MAX_FILTERS = 20;
const MAX_LIMIT = 200;

const QueryValueSchema = z.union([z.string(), z.array(z.string())]);
const QueryObjectSchema = z.record(z.string(), QueryValueSchema);

export interface McpServerOptions {
  name?: string;
  version?: string;
}

export type WatchSyncMode = 'safe' | 'replace';

export interface StartMcpServerOptions {
  dbPath: string;
  sqlitePath?: string;
  watch?: boolean;
  watchSyncMode?: WatchSyncMode;
  serverName?: string;
  serverVersion?: string;
}

export interface RunningMcpServer {
  close(): Promise<void>;
  store: SqliteStore;
  server: McpServer;
}

export function createMcpServer(store: SqliteStore, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? 'mocy-mcp',
    version: options.version ?? resolvePackageVersion()
  });

  server.registerTool(
    'mocy_list_resources',
    {
      title: 'List Resources',
      description: 'List all dataset resources available in mocy.',
      outputSchema: z.object({
        resources: z.array(z.string())
      })
    },
    () => {
      const resources = store.listResources();
      return successResult({ resources });
    }
  );

  server.registerTool(
    'mocy_get_dataset_meta',
    {
      title: 'Get Dataset Meta',
      description: 'Return resource names and their kind (collection/singular).',
      outputSchema: z.object({
        resources: z.array(
          z.object({
            name: z.string(),
            kind: z.enum(['collection', 'singular'])
          })
        )
      })
    },
    () => {
      const resources = store.listResources().map((name) => ({
        name,
        kind: store.hasCollection(name) ? 'collection' : 'singular'
      }));
      return successResult({ resources });
    }
  );

  server.registerTool(
    'mocy_get_resource_item',
    {
      title: 'Get Collection Item',
      description: 'Get one item by id from a collection resource.',
      inputSchema: z.object({
        resource: z.string().min(1),
        id: z.string().min(1)
      }),
      outputSchema: z.object({
        resource: z.string(),
        item: z.record(z.string(), z.unknown())
      })
    },
    ({ resource, id }) => {
      if (!store.hasCollection(resource)) {
        throw new Error(`Collection not found: ${resource}`);
      }

      const item = store.get(resource, id);
      if (!item) {
        throw new Error(`Item not found: ${resource}/${id}`);
      }

      return successResult({ resource, item });
    }
  );

  server.registerTool(
    'mocy_get_singular_resource',
    {
      title: 'Get Singular Resource',
      description: 'Get singular resource object by name.',
      inputSchema: z.object({
        resource: z.string().min(1)
      }),
      outputSchema: z.object({
        resource: z.string(),
        value: z.record(z.string(), z.unknown())
      })
    },
    ({ resource }) => {
      if (!store.hasSingular(resource)) {
        throw new Error(`Singular resource not found: ${resource}`);
      }

      const value = store.getSingular(resource);
      if (!value) {
        throw new Error(`Singular resource not found: ${resource}`);
      }

      return successResult({ resource, value });
    }
  );

  server.registerTool(
    'mocy_query_collection',
    {
      title: 'Query Collection',
      description: 'Run json-server style query params against a collection.',
      inputSchema: z.object({
        resource: z.string().min(1),
        query: QueryObjectSchema.optional()
      }),
      outputSchema: z.object({
        resource: z.string(),
        total: z.number(),
        data: z.array(z.record(z.string(), z.unknown())),
        page: z.number().optional(),
        perPage: z.number().optional()
      })
    },
    ({ resource, query }) => {
      if (!store.hasCollection(resource)) {
        throw new Error(`Collection not found: ${resource}`);
      }

      const listQuery = parseListQuery(normalizeQueryInput(query));
      validateQueryBudget(listQuery);

      const result = store.queryCollection(resource, listQuery);
      return successResult({
        resource,
        total: result.total,
        data: result.data,
        page: result.page,
        perPage: result.perPage
      });
    }
  );

  return server;
}

export async function startMcpServer(options: StartMcpServerOptions): Promise<RunningMcpServer> {
  const dbPath = path.resolve(options.dbPath);
  const sqlitePath = path.resolve(options.sqlitePath ?? path.join(path.dirname(dbPath), '.mocy', 'mocy.sqlite'));
  const watch = options.watch ?? true;
  const watchSyncMode = options.watchSyncMode ?? 'safe';

  const store = new SqliteStore({ sourcePath: dbPath, sqlitePath });
  await store.importFromJsonFile('replace');

  const serverOptions: McpServerOptions = {
    name: options.serverName ?? 'mocy-mcp'
  };
  if (options.serverVersion) {
    serverOptions.version = options.serverVersion;
  }
  const server = createMcpServer(store, serverOptions);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  let watcher: FSWatcher | undefined;
  if (watch) {
    watcher = chokidar.watch(dbPath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 50
      }
    });
    watcher.on('change', () => {
      void store.importFromJsonFile(watchSyncMode === 'replace' ? 'replace' : 'merge');
    });
  }

  return {
    store,
    server,
    async close() {
      if (watcher) {
        await watcher.close();
      }
      await server.close();
      store.close();
    }
  };
}

function normalizeQueryInput(
  query: Record<string, string | string[]> | undefined
): Record<string, string | string[] | undefined> {
  const normalized: Record<string, string | string[] | undefined> = {};
  if (!query) {
    return normalized;
  }

  Object.entries(query).forEach(([key, value]) => {
    normalized[key] = value;
  });
  return normalized;
}

function validateQueryBudget(query: ReturnType<typeof parseListQuery>): void {
  if (query.filters.length > MAX_FILTERS) {
    throw new Error(`Too many filters: ${query.filters.length} (max ${MAX_FILTERS})`);
  }

  if (query.limit !== undefined && query.limit > MAX_LIMIT) {
    throw new Error(`_limit ${query.limit} exceeds max ${MAX_LIMIT}`);
  }
  if (query.perPage !== undefined && query.perPage > MAX_LIMIT) {
    throw new Error(`_per_page ${query.perPage} exceeds max ${MAX_LIMIT}`);
  }
}

function successResult(payload: Record<string, unknown>) {
  return {
    structuredContent: payload,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload)
      }
    ]
  };
}

function resolvePackageVersion(): string {
  try {
    const packagePath = new URL('../package.json', import.meta.url);
    const raw = readFileSync(packagePath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

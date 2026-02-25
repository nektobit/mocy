import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, Server } from 'node:http';
import { createApp, RequestLogEntry } from './http/app.js';
import { RouteMap } from './http/rewrite.js';
import { IdGenerationMode, ImportMode, SqliteStore, StorageInit } from './storage/sqliteStore.js';
import { FileWatcher, watchFile } from './storage/watch.js';

export interface StartOptions {
  dbPath: string;
  sqlitePath?: string;
  idMode?: IdGenerationMode;
  watchSyncMode?: ImportMode;
  requestLogging?: boolean;
  host: string;
  port: number;
  staticDir?: string;
  routesPath?: string;
  watch: boolean;
}

export interface RunningServer {
  close(): Promise<void>;
  store: SqliteStore;
}

export async function startMocyServer(options: StartOptions): Promise<RunningServer> {
  const dbPath = path.resolve(options.dbPath);
  const sqlitePath = path.resolve(options.sqlitePath ?? path.join(path.dirname(dbPath), '.mocy', 'mocy.sqlite'));

  const storageInit: StorageInit = {
    sourcePath: dbPath,
    sqlitePath
  };
  if (options.idMode) {
    storageInit.idMode = options.idMode;
  }
  const store = new SqliteStore(storageInit);
  await store.importFromJsonFile('replace');

  const routeMap = loadRoutes(options.routesPath);

  const appOptions: {
    routeMap?: RouteMap;
    staticDir?: string;
    requestLogger?: (entry: RequestLogEntry) => void;
  } = {};
  if (routeMap) {
    appOptions.routeMap = routeMap;
  }
  if (options.staticDir) {
    appOptions.staticDir = options.staticDir;
  }
  if (options.requestLogging) {
    appOptions.requestLogger = (entry) => {
      process.stdout.write(
        `${entry.method} ${entry.path} ${entry.status} ${entry.durationMs.toFixed(1)}ms\n`
      );
    };
  }

  const app = createApp(store, appOptions);

  const httpServer = createServer(app);
  await listen(httpServer, options.host, options.port);

  let watcher: FileWatcher | undefined;
  if (options.watch) {
    watcher = watchFile(dbPath, async () => {
      await store.importFromJsonFile(options.watchSyncMode ?? 'merge');
    });
  }

  return {
    store,
    async close() {
      if (watcher) {
        await watcher.close();
      }

      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });

      store.close();
    }
  };
}

function loadRoutes(routesPath?: string): RouteMap | undefined {
  if (!routesPath) {
    return undefined;
  }

  const absolutePath = path.resolve(routesPath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }

  const content = readFileSync(absolutePath, 'utf8');
  return JSON.parse(content) as RouteMap;
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

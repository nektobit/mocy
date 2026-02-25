#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { IdGenerationMode, ImportMode, SqliteStore } from './storage/sqliteStore.js';
import { startMocyServer } from './server.js';

const program = new Command();
interface ServeOptions {
  port: string;
  host: string;
  static?: string;
  routes?: string;
  sqlite?: string;
  idMode: string;
  watchSync: string;
  watch: boolean;
}

interface ExportOptions {
  sqlite: string;
}

program
  .name('mocy')
  .description('Modern mock REST API server inspired by json-server')
  .argument('[db]', 'Path to db.json', 'db.json')
  .option('-p, --port <number>', 'Port number', '3000')
  .option('-H, --host <host>', 'Host address', 'localhost')
  .option('-s, --static <dir>', 'Static directory path')
  .option('-r, --routes <file>', 'Routes rewrite file path')
  .option('--sqlite <file>', 'SQLite file path')
  .option('--id-mode <mode>', 'ID generation mode: safe (default) or compat', 'safe')
  .option('--watch-sync <mode>', 'Watch sync mode: safe (default) or replace', 'safe')
  .option('--no-watch', 'Disable db.json file watching')
  .action(async (dbPath, options: ServeOptions) => {
    const dbInput = typeof dbPath === 'string' ? dbPath : 'db.json';
    const resolvedDb = path.resolve(dbInput);
    if (!existsSync(resolvedDb)) {
      process.stderr.write(`File not found: ${resolvedDb}\n`);
      process.exitCode = 1;
      return;
    }

    const port = Number.parseInt(options.port, 10);
    const host = options.host;
    const idMode = parseIdMode(options.idMode);
    if (!idMode) {
      process.stderr.write(`Invalid --id-mode value "${options.idMode}". Use "safe" or "compat".\n`);
      process.exitCode = 1;
      return;
    }
    const watchSyncMode = parseWatchSyncMode(options.watchSync);
    if (!watchSyncMode) {
      process.stderr.write(`Invalid --watch-sync value "${options.watchSync}". Use "safe" or "replace".\n`);
      process.exitCode = 1;
      return;
    }

    const startOptions = {
      dbPath: resolvedDb,
      host,
      port: Number.isFinite(port) ? port : 3000,
      idMode,
      watchSyncMode,
      watch: options.watch
    };

    if (options.sqlite) {
      Object.assign(startOptions, { sqlitePath: options.sqlite });
    }
    if (options.static) {
      Object.assign(startOptions, { staticDir: options.static });
    }
    if (options.routes) {
      Object.assign(startOptions, { routesPath: options.routes });
    }

    const running = await startMocyServer(startOptions);

    process.stdout.write(`mocy is running\n`);
    process.stdout.write(`Loading ${resolvedDb}\n`);
    process.stdout.write(`URL: http://${host}:${port}\n`);

    const shutdown = async () => {
      await running.close();
      process.exit(0);
    };

    process.on('SIGINT', () => {
      void shutdown();
    });
    process.on('SIGTERM', () => {
      void shutdown();
    });
  });

program
  .command('export')
  .description('Export the current SQLite state to db.json')
  .argument('[target]', 'Export target path', 'db.json')
  .option('--sqlite <file>', 'SQLite file path', '.mocy/mocy.sqlite')
  .action(async (target, options: ExportOptions) => {
    const targetPath = path.resolve(typeof target === 'string' ? target : 'db.json');
    const sqlitePath = path.resolve(options.sqlite);
    const source = targetPath;

    const store = new SqliteStore({
      sourcePath: source,
      sqlitePath
    });

    await store.exportToJsonFile(targetPath);
    store.close();
    process.stdout.write(`Exported data to ${targetPath}\n`);
  });

function parseIdMode(value: string): IdGenerationMode | null {
  if (value === 'safe' || value === 'compat') {
    return value;
  }
  return null;
}

function parseWatchSyncMode(value: string): ImportMode | null {
  if (value === 'safe') {
    return 'merge';
  }
  if (value === 'replace') {
    return 'replace';
  }
  return null;
}

void program.parseAsync(process.argv);

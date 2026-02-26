#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startMcpServer, WatchSyncMode } from './server.js';

interface CliOptions {
  sqlite?: string;
  watchSync: string;
  watch: boolean;
}

const program = new Command();

program
  .name('mocy-mcp')
  .description('Official MCP adapter for mocy (read-only stdio server)')
  .argument('[db]', 'Path to db.json', 'db.json')
  .option('--sqlite <file>', 'SQLite file path')
  .option('--watch-sync <mode>', 'Watch sync mode: safe (default) or replace', 'safe')
  .option('--no-watch', 'Disable db.json file watching')
  .action(async (dbPath, options: CliOptions) => {
    const dbInput = typeof dbPath === 'string' ? dbPath : 'db.json';
    const resolvedDb = path.resolve(dbInput);
    if (!existsSync(resolvedDb)) {
      process.stderr.write(`File not found: ${resolvedDb}\n`);
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
      watchSyncMode,
      watch: options.watch
    };
    if (options.sqlite) {
      Object.assign(startOptions, { sqlitePath: options.sqlite });
    }

    const running = await startMcpServer(startOptions);

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

function parseWatchSyncMode(value: string): WatchSyncMode | null {
  if (value === 'safe' || value === 'replace') {
    return value;
  }
  return null;
}

void program.parseAsync(process.argv);

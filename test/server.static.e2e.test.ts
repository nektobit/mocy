import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startMocyServer, type RunningServer } from '../src/server.js';

describe('static path resolution e2e', () => {
  let tempDir = '';
  let running: RunningServer | null = null;
  const originalCwd = process.cwd();

  afterEach(async () => {
    if (running) {
      await running.close();
      running = null;
    }

    process.chdir(originalCwd);

    if (tempDir) {
      await rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50
      });
      tempDir = '';
    }
  });

  it('resolves relative static paths from the db.json directory instead of process cwd', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mocy-static-e2e-'));

    const projectDir = path.join(tempDir, 'project');
    const staticDir = path.join(projectDir, 'public');
    const runnerDir = path.join(tempDir, 'runner');
    const runnerStaticDir = path.join(runnerDir, 'public');
    const dbPath = path.join(projectDir, 'db.json');

    await mkdir(staticDir, { recursive: true });
    await mkdir(runnerStaticDir, { recursive: true });

    await writeFile(
      dbPath,
      `${JSON.stringify({ posts: [{ id: 1, title: 'hello' }] }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(path.join(staticDir, 'hello.txt'), 'served-from-db-dir\n', 'utf8');
    await writeFile(path.join(runnerStaticDir, 'hello.txt'), 'served-from-cwd\n', 'utf8');

    process.chdir(runnerDir);

    running = await startMocyServer({
      dbPath: path.relative(runnerDir, dbPath),
      staticDir: 'public',
      host: '127.0.0.1',
      port: 0,
      playground: false,
      watch: false
    });

    expect(running.resolvedStaticDir).toBe(staticDir);

    const response = await fetch(new URL('/hello.txt', running.url));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('served-from-db-dir\n');
  });
});

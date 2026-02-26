import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeApiBaseUrl, startPlaygroundServer, type RunningPlaygroundServer } from '../src/server.js';

describe('mocy-playground server', () => {
  let running: RunningPlaygroundServer | null = null;

  afterEach(async () => {
    if (running) {
      await running.close();
      running = null;
    }
  });

  it('serves config.json and static index', async () => {
    running = await startPlaygroundServer({
      apiBaseUrl: 'http://localhost:3000/',
      host: '127.0.0.1',
      port: 0,
      publicDir: path.resolve('public')
    });

    const [configResponse, indexResponse] = await Promise.all([
      fetch(`${running.url}/config.json`),
      fetch(`${running.url}/`)
    ]);

    expect(configResponse.status).toBe(200);
    expect(await configResponse.json()).toEqual({ apiBaseUrl: 'http://localhost:3000' });

    expect(indexResponse.status).toBe(200);
    const html = await indexResponse.text();
    expect(html).toContain('mocy playground');
  });

  it('blocks path traversal attempts', async () => {
    running = await startPlaygroundServer({
      apiBaseUrl: 'http://localhost:3000',
      host: '127.0.0.1',
      port: 0,
      publicDir: path.resolve('public')
    });

    const response = await fetch(`${running.url}/..%2F..%2Fpackage.json`);
    expect(response.status).toBe(403);
  });
});

describe('normalizeApiBaseUrl', () => {
  it('normalizes valid URLs', () => {
    expect(normalizeApiBaseUrl('https://example.com/api/')).toBe('https://example.com/api');
  });

  it('throws for invalid protocol and query/hash', () => {
    expect(() => normalizeApiBaseUrl('ftp://example.com')).toThrow();
    expect(() => normalizeApiBaseUrl('http://example.com?x=1')).toThrow();
  });
});

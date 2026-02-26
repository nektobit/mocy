import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CreatePlaygroundServerOptions {
  apiBaseUrl: string;
  publicDir?: string;
}

export interface StartPlaygroundServerOptions extends CreatePlaygroundServerOptions {
  host?: string;
  port?: number;
}

export interface RunningPlaygroundServer {
  server: Server;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export const DEFAULT_PLAYGROUND_HOST = '127.0.0.1';
export const DEFAULT_PLAYGROUND_PORT = 4173;

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const MIME_BY_EXTENSION: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function createPlaygroundServer(options: CreatePlaygroundServerOptions): Server {
  const publicDir = resolve(options.publicDir ?? DEFAULT_PUBLIC_DIR);
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const configPayload = Buffer.from(JSON.stringify({ apiBaseUrl }), 'utf8');

  return createServer((request, response) => {
    void handleRequest(request, response, publicDir, configPayload);
  });
}

export async function startPlaygroundServer(
  options: StartPlaygroundServerOptions
): Promise<RunningPlaygroundServer> {
  const host = options.host ?? DEFAULT_PLAYGROUND_HOST;
  const port = options.port ?? DEFAULT_PLAYGROUND_PORT;
  const server = createPlaygroundServer(options);

  await listen(server, port, host);

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine playground server address');
  }

  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const url = `http://${displayHost}:${address.port}`;

  return {
    server,
    host,
    port: address.port,
    url,
    close: () => closeServer(server)
  };
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('API base URL is required');
  }

  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API base URL must start with http:// or https://');
  }

  if (url.search || url.hash) {
    throw new Error('API base URL must not include query string or hash');
  }

  const normalizedPathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/u, '');
  return `${url.protocol}//${url.host}${normalizedPathname}`;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  publicDir: string,
  configPayload: Buffer
): Promise<void> {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    writeText(response, 405, 'Method Not Allowed');
    return;
  }

  const requestUrl = request.url ?? '/';
  const parsed = new URL(requestUrl, 'http://localhost');

  if (parsed.pathname === '/config.json') {
    writeBuffer(response, method, 200, configPayload, JSON_CONTENT_TYPE);
    return;
  }

  const assetPath = resolveAssetPath(publicDir, parsed.pathname);
  if (!assetPath) {
    writeText(response, 403, 'Forbidden');
    return;
  }

  try {
    const content = await readFile(assetPath);
    const contentType = MIME_BY_EXTENSION[extname(assetPath)] ?? 'application/octet-stream';
    writeBuffer(response, method, 200, content, contentType);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      writeText(response, 404, 'Not Found');
      return;
    }

    writeText(response, 500, 'Internal Server Error');
  }
}

function resolveAssetPath(publicDir: string, pathname: string): string | null {
  const decodedPath = decodePath(pathname);
  if (!decodedPath) {
    return null;
  }

  let normalizedPath = decodedPath;
  if (normalizedPath === '/') {
    normalizedPath = '/index.html';
  }
  if (normalizedPath.endsWith('/')) {
    normalizedPath = `${normalizedPath}index.html`;
  }

  const rawSegments = normalizedPath.split(/[\\/]/u);
  if (rawSegments.some((segment) => segment === '..')) {
    return null;
  }

  const safeRelative = normalize(normalizedPath).replace(/^[/\\]+/u, '');
  const absolutePath = resolve(publicDir, safeRelative);
  const relation = relative(publicDir, absolutePath);

  if (relation.startsWith('..') || isAbsolute(relation)) {
    return null;
  }

  return absolutePath;
}

function decodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function writeBuffer(
  response: ServerResponse,
  method: string,
  statusCode: number,
  payload: Buffer,
  contentType: string
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', String(payload.length));

  if (method === 'HEAD') {
    response.end();
    return;
  }

  response.end(payload);
}

function writeText(response: ServerResponse, statusCode: number, message: string): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(message);
}

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      rejectPromise(error);
    };

    const onListening = (): void => {
      server.off('error', onError);
      resolvePromise();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}
